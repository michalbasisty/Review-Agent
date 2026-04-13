import { Octokit } from "@octokit/rest";

if (!process.env.GITHUB_TOKEN) {
  console.error("[GitHub] WARNING: GITHUB_TOKEN not set — GitHub API calls will fail");
}

export const octokit: Octokit = new Octokit({
  auth: process.env.GITHUB_TOKEN || "dummy",
});

// Parse PR URL to extract owner, repo, pull_number
export function parsePrUrl(url: string): { owner: string; repo: string; pull_number: number } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  return {
    owner: match[1]!,
    repo: match[2]!,
    pull_number: parseInt(match[3]!, 10),
  };
}
