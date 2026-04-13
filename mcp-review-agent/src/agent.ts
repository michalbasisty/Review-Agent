import "dotenv/config";
import { ChatGroq } from "@langchain/groq";
import { ChatOllama } from "@langchain/ollama";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { LangChainTracer } from "@langchain/core/tracers/tracer_langchain";

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
  // Primary: Groq (fast, free tier)
  const groq = new ChatGroq({
    model: "llama-3.3-70b-versatile",
    temperature: 0.2,
  });

  // Fallback: Ollama (local, always available)
  const ollama = new ChatOllama({
    model: "llama3.1",
    temperature: 0.2,
  });

  try {
    // Test Groq with a simple call
    await groq.invoke([{ role: "user", content: "test" }]);
    console.error("[LLM] Using Groq (primary)");
    return groq;
  } catch (error: any) {
    console.error(`[LLM] Groq failed (${error.message}), falling back to Ollama`);
    return ollama;
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
    // TODO: Replace with actual GitHub API call
    return `diff --git a/src/index.ts b/src/index.ts\n+console.log("debug")`;
  },
  {
    name: "get_diff",
    description: "Get PR diff",
    schema: z.object({ pr_url: z.string() }),
  }
);

const postComment = tool(
  async ({ pr_url, body }) => {
    // TODO: Replace with actual GitHub API call
    console.error(`[Agent] Posting comment to ${pr_url}: ${body}`);
    return `Comment posted: ${body}`;
  },
  {
    name: "post_comment",
    description: "Post review comment",
    schema: z.object({ pr_url: z.string(), body: z.string() }),
  }
);

async function runAgent(prUrl: string): Promise<void> {
  guardInjection(prUrl);

  const llm = await createLLMWithFallback();

  const agent = createReactAgent({
    llm,
    tools: [getDiff, postComment],
  });

  const result = await retryWithBackoff(async () =>
    agent.invoke(
      {
        messages: [
          {
            role: "user",
            content: `Review this PR and leave comments: ${prUrl}`,
          },
        ],
      },
      {
        configurable: {
          thread_id: `review-${Date.now()}`,
        },
        callbacks: [tracer],
      }
    )
  );

  console.log(result.messages.at(-1)?.content);
}

// Main execution
const PR_URL = process.env.PR_URL || "https://github.com/example/repo/pull/1";
runAgent(PR_URL).catch(console.error);