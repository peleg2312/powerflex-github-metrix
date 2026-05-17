import type { VersionProjection } from "@powerflex/shared-schema";

const baseUrl = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3000";

export type MatrixRow = {
  operator_version: string;   // CSI PowerFlex version (primary)
  csi_driver_version: string; // CSM Operator version (secondary)
  kubernetes: string[];
  openshift: string[];
  powerflex_backend: string[];
};

export type BugRow = {
  id: string;
  externalId?: string | null;
  title: string;
  description: string;
  severity: string;
  fixedInVersion: string;
  commitSha?: string | null;
  sourceUrl?: string | null;
  confidence: number;
};

async function getJson<T>(path: string, params: Record<string, string | undefined> = {}): Promise<T> {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

export type KnownIssueRow = {
  id: string;
  version: string;
  description: string;
  workaround?: string | null;
  sourceUrl?: string | null;
};

export type ChangeEntry = {
  title: string;
  type: "feature" | "fix" | "chore";
  author: string;
  pr_url: string;
};

export type FeatureRow = {
  version: string;
  release_date: string;
  release_url: string | null;
  changes: ChangeEntry[];
};

export const api = {
  versions: (params: Record<string, string | undefined>) => getJson<VersionProjection[]>("/versions", params),
  matrix: (params: Record<string, string | undefined>) => getJson<{ generated_at: string; rows: MatrixRow[] }>("/matrix", params),
  bugs: (params: Record<string, string | undefined>) => getJson<BugRow[]>("/bugs", params),
  knownIssues: (params: Record<string, string | undefined>) => getJson<KnownIssueRow[]>("/known-issues", params),
  features: (params: Record<string, string | undefined>) => getJson<FeatureRow[]>("/features", params)
};
