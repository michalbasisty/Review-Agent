# MCP Review Agent

An MCP (Model Context Protocol) server + LangChain agent for automated PR code review.

## Features

- **MCP Server** — Exposes tools for PR review via stdio transport
- **ReAct Agent** — AI-powered review agent using LangGraph + Groq
- **LangSmith** — Built-in tracing and monitoring
- **Security** — Prompt injection guard

## Prerequisites

- Node.js 18+
- [Groq API key](https://console.groq.com) (free)
- [LangSmith API key](https://smith.langchain.com) (free)

## Setup

```bash
npm install
```

## Configuration

Copy `.env.example` to `.env` and fill in your keys:

```env
GROQ_API_KEY=your_groq_api_key
LANGSMITH_TRACING=true
LANGSMITH_ENDPOINT=https://api.smith.langchain.com
LANGSMITH_API_KEY=your_langsmith_api_key
LANGSMITH_PROJECT=mcp-review-agent
```

## Usage

### MCP Server

Starts the MCP server on stdio (for use with MCP clients like Claude Desktop, Cursor, etc.):

```bash
npm run start:server
```

#### Available Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `get_diff` | Get the diff for a PR URL | `pr_url` (string) |
| `post_comment` | Post a comment on a PR | `pr_url` (string), `body` (string), `line` (number, optional) |
| `get_context` | Get file context | `file_path` (string) |

#### MCP Client Configuration

Add to your MCP client config (e.g., Claude Desktop):

```json
{
  "mcpServers": {
    "review-agent": {
      "command": "npx",
      "args": ["tsx", "G:/Projects/Review Agent/mcp-review-agent/src/mcp-server.ts"],
      "env": {
        "GROQ_API_KEY": "your_key",
        "LANGSMITH_API_KEY": "your_key"
      }
    }
  }
}
```

### ReAct Agent

Runs the standalone review agent:

```bash
npm run start:agent
```

By default reviews a sample PR. To review a specific PR:

```bash
# Windows
set PR_URL=https://github.com/your/repo/pull/1 && npm run start:agent

# Linux/Mac
PR_URL=https://github.com/your/repo/pull/1 npm run start:agent
```

## LangSmith

All agent runs are traced to LangSmith. View traces at:
https://smith.langchain.com → Select your project

You'll see:
- LLM calls (inputs/outputs)
- Tool invocations
- Agent execution flow
- Latency metrics

## Project Structure

```
mcp-review-agent/
├── src/
│   ├── mcp-server.ts    # MCP server with tools
│   └── agent.ts          # ReAct review agent
├── .env                  # Environment variables (gitignored)
├── .env.example          # Example env file
├── .gitignore            # Git ignore rules
├── package.json
├── tsconfig.json
└── README.md
```

## Extending

### Add GitHub API Integration

Replace mock data in `mcp-server.ts` and `agent.ts` with actual GitHub API calls:

```typescript
import { Octokit } from "@octokit/rest";

const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });

// In get_diff tool:
const { data } = await octokit.pulls.get({
  owner: "owner",
  repo: "repo",
  pull_number: prNumber,
  mediaType: { format: "diff" }
});
```

### Add More Tools

In `mcp-server.ts`:

```typescript
server.tool(
  "tool_name",
  "Tool description",
  { param: z.string().describe("Param description") },
  async ({ param }) => {
    // Implementation
    return { content: [{ type: "text", text: "result" }] };
  }
);
```

### Change AI Model

In `agent.ts`:

```typescript
// Groq (current)
import { ChatGroq } from "@langchain/groq";
const llm = new ChatGroq({ model: "llama-3.3-70b-versatile" });

// Or Anthropic
import { ChatAnthropic } from "@langchain/anthropic";
const llm = new ChatAnthropic({ model: "claude-3-5-sonnet-20241022" });

// Or Ollama (local)
import { ChatOllama } from "@langchain/ollama";
const llm = new ChatOllama({ model: "llama3.1" });
```

## Security Notes

- `.env` is gitignored — never commit API keys
- Prompt injection guard blocks common attack patterns
- All external inputs should be validated before use

## License

ISC
