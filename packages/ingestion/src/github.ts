import type { GithubSource } from "./config.js";

export type GithubRelease = {
  id: number;
  tag_name: string;
  name: string | null;
  body: string | null;
  html_url: string;
  draft: boolean;
  prerelease: boolean;
  published_at: string | null;
  created_at: string;
  target_commitish: string;
  assets: Array<{
    name: string;
    browser_download_url: string;
    content_type: string | null;
    size: number;
  }>;
};

export type GithubPullRequest = {
  number: number;
  title: string;
  body: string | null;
  state: string;
  html_url: string;
  merged_at: string | null;
  merge_commit_sha: string | null;
};

export type GithubCommit = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author?: {
      name?: string;
      email?: string;
      date?: string;
    };
  };
};

export type GithubTag = {
  name: string;
  zipball_url: string;
  tarball_url: string;
  commit: {
    sha: string;
    url: string;
  };
};

const apiBase = "https://api.github.com";

function githubHeaders(token?: string): HeadersInit {
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

async function getJson<T>(url: string, token?: string): Promise<T> {
  const response = await fetch(url, { headers: githubHeaders(token) });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub request failed ${response.status} for ${url}: ${body.slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

export class GithubAdapter {
  constructor(private readonly token = process.env.GITHUB_TOKEN || undefined) {}

  async releases(source: GithubSource, perPage = 100): Promise<GithubRelease[]> {
    const url = `${apiBase}/repos/${source.owner}/${source.repo}/releases?per_page=${perPage}`;
    return getJson<GithubRelease[]>(url, this.token);
  }

  async tags(source: GithubSource, perPage = 100): Promise<GithubTag[]> {
    const url = `${apiBase}/repos/${source.owner}/${source.repo}/tags?per_page=${perPage}`;
    return getJson<GithubTag[]>(url, this.token);
  }

  async pullRequests(source: GithubSource, perPage = 100): Promise<GithubPullRequest[]> {
    const url = `${apiBase}/repos/${source.owner}/${source.repo}/pulls?state=closed&sort=updated&direction=desc&per_page=${perPage}`;
    return getJson<GithubPullRequest[]>(url, this.token);
  }

  async commits(source: GithubSource, since?: Date, perPage = 100): Promise<GithubCommit[]> {
    const params = new URLSearchParams({ per_page: String(perPage) });
    if (since) params.set("since", since.toISOString());
    const url = `${apiBase}/repos/${source.owner}/${source.repo}/commits?${params.toString()}`;
    return getJson<GithubCommit[]>(url, this.token);
  }
}
