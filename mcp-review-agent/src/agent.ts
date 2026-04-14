import "dotenv/config";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatGroq } from "@langchain/groq";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";
import { octokit, parsePrUrl } from "./github.js";

const tracer = new LangChainTracer({
  projectName: process.env.LANGSMITH_PROJECT || "mcp-review-agent",
});

// --- Retry with exponential backoff ---
async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const isLastAttempt = attempt === maxRetries - 1;
      if (isLastAttempt) throw error;

      const delay = baseDelay * Math.pow(2, attempt);
      console.error(`[Retry] Attempt ${attempt + 1} failed: ${error.message}. Retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("Retry logic error"); // Should never reach
}

// --- LLM with fallback ---
async function createLLMWithFallback(): Promise<BaseChatModel> {
  // Primary: Gemini (free tier, generous limits)
  const gemini = new ChatGoogleGenerativeAI({
    model: "gemini-2.5-flash",
    temperature: 0.2,
  });

  // Fallback: Groq
  const groq = new ChatGroq({
    model: "llama-3.3-70b-versatile",
    temperature: 0.2,
  });

  try {
    // Test Gemini with a simple call
    await gemini.invoke([{ role: "user", content: "test" }]);
    console.error("[LLM] Using Gemini (primary)");
    return gemini;
  } catch (error: any) {
    console.error(`[LLM] Gemini failed (${error.message}), falling back to Groq`);
    return groq;
  }
}

// Security check — protects against prompt injection
function guardInjection(input: string): void {
  const patterns = [/ignore previous/i, /system prompt/i, /jailbreak/i];
  if (patterns.some(p => p.test(input))) {
    throw new Error("Prompt injection detected");
  }
}

const getDiff = tool(
  async ({ pr_url }) => {
    const parsed = parsePrUrl(pr_url);
    if (!parsed) throw new Error(`Invalid PR URL: ${pr_url}`);

    // Get PR files changed
    const { data: files } = await octokit.pulls.listFiles({
      owner: parsed.owner,
      repo: parsed.repo,
      pull_number: parsed.pull_number,
    });

    if (files.length === 0) return "No files changed in this PR.";

    // Summary of all files (small)
    const summary = files
      .map((f) => `${f.status}: ${f.filename} (+${f.additions}/-${f.deletions})`)
      .join("\n");

    // Get raw diff
    const diffResponse = await octokit.pulls.get({
      owner: parsed.owner,
      repo: parsed.repo,
      pull_number: parsed.pull_number,
      mediaType: { format: "diff" },
    });

    const fullDiff = String(diffResponse.data);

    // Truncate diff to ~8K tokens (stays well under 12K limit with prompt overhead)
    const MAX_DIFF_CHARS = 40000; // ~10K tokens
    let diff = fullDiff;
    let truncated = false;

    if (diff.length > MAX_DIFF_CHARS) {
      diff = diff.substring(0, MAX_DIFF_CHARS);
      truncated = true;

      // Find last complete hunk boundary
      const lastHunk = diff.lastIndexOf("\n@@");
      if (lastHunk > MAX_DIFF_CHARS * 0.8) {
        diff = diff.substring(0, lastHunk);
      }

      // Add truncation note
      diff += `\n\n[... diff truncated, ${fullDiff.length - diff.length} more characters omitted ...]`;
    }

    return `Files changed (${files.length}):\n${summary}\n${truncated ? `(Diff truncated to first ${MAX_DIFF_CHARS} chars)\n` : ""}\n--- DIFF ---\n\n${diff}`;
  },
  {
    name: "get_diff",
    description: "Get the diff and changed files for a PR",
    schema: z.object({ pr_url: z.string() }),
  }
);

const postComment = tool(
  async ({ pr_url, body }) => {
    const parsed = parsePrUrl(pr_url);
    if (!parsed) throw new Error(`Invalid PR URL: ${pr_url}`);

    console.error(`[Agent] Posting comment to ${pr_url}: ${body}`);

    await octokit.issues.createComment({
      owner: parsed.owner,
      repo: parsed.repo,
      issue_number: parsed.pull_number,
      body,
    });

    return `Comment posted on ${pr_url}`;
  },
  {
    name: "post_comment",
    description: "Post a review comment on a PR",
    schema: z.object({ pr_url: z.string(), body: z.string() }),
  }
);

async function runAgent(prUrl: string): Promise<void> {
  guardInjection(prUrl);

  const parsed = parsePrUrl(prUrl);
  if (!parsed) {
    console.error(`Invalid PR URL format: ${prUrl}`);
    console.error("Example: https://github.com/owner/repo/pull/123");
    return;
  }

  const llm = await createLLMWithFallback();

  const agent = createReactAgent({
    llm,
    tools: [getDiff, postComment],
  });

  const result = await retryWithBackoff(
    async () =>
      agent.invoke(
        {
          messages: [
            {
              role: "user",
              content: `Review this PR: ${prUrl}\n\n1. Get diff with get_diff\n2. Review for: correctness, security, quality, performance\n3. Post comments with post_comment\n4. Summarize findings`,
            },
          ],
        },
        {
          configurable: {
            thread_id: `review-${parsed.owner}-${parsed.repo}-${parsed.pull_number}`,
          },
          callbacks: [tracer],
        }
      ),
    2, // max 2 attempts
    2000 // 2s base delay
  );

  console.log(result.messages.at(-1)?.content);
}

// Main execution
const PR_URL = process.env.PR_URL;
if (!PR_URL) {
  console.error("Usage: set PR_URL environment variable");
  console.error("Example: set PR_URL=https://github.com/owner/repo/pull/123");
  process.exit(1);
}

runAgent(PR_URL).catch(console.error);
