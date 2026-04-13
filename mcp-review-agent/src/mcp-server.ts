import "dotenv/config";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "code-review",
  version: "1.0.0",
});

server.tool(
  "get_diff",
  "Get the diff for a given PR URL",
  { pr_url: z.string().describe("The PR URL to get diff for") },
  async ({ pr_url }) => {
    // TODO: Replace with actual GitHub API call
    console.error(`[MCP] Getting diff for: ${pr_url}`);
    return {
      content: [
        {
          type: "text",
          text: `diff --git a/src/index.ts b/src/index.ts\n+console.log("hello")`,
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
  },
  async ({ pr_url, body, line }) => {
    // TODO: Replace with actual GitHub API call
    console.error(`[MCP] Posting comment to ${pr_url}${line ? `:${line}` : ""}`);
    return {
      content: [
        {
          type: "text",
          text: `Comment posted${line ? ` on line ${line}` : ""}.`,
        },
      ],
    };
  }
);

server.tool(
  "get_context",
  "Get file context for a given file path",
  { file_path: z.string().describe("The file path to get context for") },
  async ({ file_path }) => {
    // TODO: Replace with actual file read or GitHub API call
    console.error(`[MCP] Getting context for: ${file_path}`);
    return {
      content: [
        {
          type: "text",
          text: `// Context for ${file_path}\n// TODO: Implement actual file context retrieval`,
        },
      ],
    };
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Code Review Server running on stdio");
}

main().catch(console.error);