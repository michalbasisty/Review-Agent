import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { octokit, parsePrUrl } from "./github.js";

const server = new McpServer({
  name: "code-review",
  version: "1.0.0",
});

server.tool(
  "get_diff",
  "Get the diff for a given PR URL",
  { pr_url: z.string().describe("The PR URL to get diff for") },
  async ({ pr_url }) => {
    const parsed = parsePrUrl(pr_url);
    if (!parsed) {
      return {
        content: [{ type: "text", text: `Invalid PR URL format: ${pr_url}` }],
        isError: true,
      };
    }

    console.error(`[MCP] Getting diff for: ${pr_url}`);

    // Get PR files changed
    const { data: files } = await octokit.pulls.listFiles({
      owner: parsed.owner,
      repo: parsed.repo,
      pull_number: parsed.pull_number,
    });

    if (files.length === 0) {
      return {
        content: [{ type: "text", text: "No files changed in this PR." }],
      };
    }

    // Get raw diff
    const diffResponse = await octokit.pulls.get({
      owner: parsed.owner,
      repo: parsed.repo,
      pull_number: parsed.pull_number,
      mediaType: { format: "diff" },
    });

    const summary = files
      .map((f) => `${f.status}: ${f.filename} (+${f.additions}/-${f.deletions})`)
      .join("\n");

    // Truncate diff to stay under token limits
    const MAX_DIFF_CHARS = 40000;
    const fullDiff = String(diffResponse.data);
    let diff = fullDiff;
    let truncated = false;

    if (diff.length > MAX_DIFF_CHARS) {
      diff = diff.substring(0, MAX_DIFF_CHARS);
      truncated = true;
      const lastHunk = diff.lastIndexOf("\n@@");
      if (lastHunk > MAX_DIFF_CHARS * 0.8) {
        diff = diff.substring(0, lastHunk);
      }
      diff += `\n\n[... diff truncated ...]`;
    }

    return {
      content: [
        {
          type: "text",
          text: `Files changed (${files.length}):\n${summary}\n${truncated ? "(Diff truncated)\n" : ""}\n--- DIFF ---\n\n${diff}`,
        },
      ],
    };
  }
);

server.tool(
  "post_comment",
  "Post a comment on a PR",
  {
    pr_url: z.string().describe("The PR URL to comment on"),
    body: z.string().describe("The comment body"),
    line: z.number().optional().describe("Line number for inline comment"),
    path: z.string().optional().describe("File path for inline comment"),
  },
  async ({ pr_url, body, line, path }) => {
    const parsed = parsePrUrl(pr_url);
    if (!parsed) {
      return {
        content: [{ type: "text", text: `Invalid PR URL format: ${pr_url}` }],
        isError: true,
      };
    }

    console.error(`[MCP] Posting comment to ${pr_url}${line ? `:${line}` : ""}`);

    if (line && path) {
      // Inline comment on a specific line
      // Get the PR commits to find the right commit_id
      const { data: commits } = await octokit.pulls.listCommits({
        owner: parsed.owner,
        repo: parsed.repo,
        pull_number: parsed.pull_number,
      });

      const latestCommit = commits[0]?.sha;
      if (!latestCommit) {
        return {
          content: [{ type: "text", text: "Could not find commit for this PR." }],
          isError: true,
        };
      }

      await octokit.pulls.createReview({
        owner: parsed.owner,
        repo: parsed.repo,
        pull_number: parsed.pull_number,
        event: "COMMENT",
        comments: [
          {
            path,
            position: line,
            body,
          },
        ],
      });

      return {
        content: [{ type: "text", text: `Inline comment posted on ${path}:${line}` }],
      };
    } else {
      // General PR comment
      await octokit.issues.createComment({
        owner: parsed.owner,
        repo: parsed.repo,
        issue_number: parsed.pull_number,
        body,
      });

      return {
        content: [{ type: "text", text: "Comment posted." }],
      };
    }
  }
);

server.tool(
  "get_context",
  "Get file content from a PR",
  {
    pr_url: z.string().describe("The PR URL"),
    file_path: z.string().describe("The file path to get content for"),
    ref: z.string().optional().describe("Git ref (branch/commit sha)"),
  },
  async ({ pr_url, file_path, ref }) => {
    const parsed = parsePrUrl(pr_url);
    if (!parsed) {
      return {
        content: [{ type: "text", text: `Invalid PR URL format: ${pr_url}` }],
        isError: true,
      };
    }

    console.error(`[MCP] Getting context for: ${file_path}`);

    // Get PR head ref if not provided
    let useRef = ref;
    if (!useRef) {
      const { data: pr } = await octokit.pulls.get({
        owner: parsed.owner,
        repo: parsed.repo,
        pull_number: parsed.pull_number,
      });
      useRef = pr.head.sha;
    }

    const { data } = await octokit.repos.getContent({
      owner: parsed.owner,
      repo: parsed.repo,
      path: file_path,
      ref: useRef,
    });

    if ("content" in data) {
      const content = Buffer.from(data.content, "base64").toString("utf-8");
      return {
        content: [{ type: "text", text: `// ${file_path} (@${useRef})\n\n${content}` }],
      };
    }

    return {
      content: [{ type: "text", text: `File not found: ${file_path}` }],
      isError: true,
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Code Review Server running on stdio");
}

main().catch(console.error);
