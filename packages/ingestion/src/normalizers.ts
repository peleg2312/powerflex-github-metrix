import crypto from "node:crypto";
import semver from "semver";
import type { GithubCommit, GithubPullRequest, GithubRelease } from "./github.js";

export function normalizeVersion(tag: string): string {
  const cleaned = tag.trim().replace(/^release[-/]/i, "").replace(/^v/i, "");
  return semver.valid(cleaned) ?? cleaned;
}

export function checksum(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function inferSeverity(text: string): "critical" | "high" | "medium" | "low" | "unknown" {
  const value = text.toLowerCase();
  if (/\bcve-\d{4}-\d+\b|critical|rce|privilege escalation/.test(value)) return "critical";
  if (/security|panic|crash|data loss|corruption|bypass|fails to start/.test(value)) return "high";
  if (/bug|fix|incorrect|missing|broken|error|failing|issue|problem/.test(value)) return "medium";
  if (/cleanup|readme|docs|typo|format|lint/.test(value)) return "low";
  return "unknown";
}

export function isBugLike(text: string): boolean {
  return /\bbug\b|\bfix(e[ds])?\b|\bresolve[sd]?\b|\bissue\b|\bincorrect\b|\bbroken\b|\bfail(s|ed|ing)?\b|\bcrash\b|\bcve-\d{4}-\d+\b/i.test(text);
}

export function extractIssueId(text: string): string | undefined {
  const cve = text.match(/\bCVE-\d{4}-\d+\b/i)?.[0];
  if (cve) return cve.toUpperCase();
  const bug = text.match(/\bbug[-_\s:]?(\d+)\b/i)?.[1];
  if (bug) return `bug-${bug}`;
  const issue = text.match(/#(\d+)/)?.[1];
  return issue ? `#${issue}` : undefined;
}

export function releaseBugCandidates(release: GithubRelease): Array<{
  externalId?: string;
  title: string;
  description: string;
  sourceUrl: string;
  confidence: number;
  commitSha?: string;
}> {
  const body = release.body ?? "";
  const lines = body
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean);

  return lines
    .filter((line) => isBugLike(line))
    .map((line) => ({
      externalId: extractIssueId(line),
      title: line.slice(0, 240),
      description: line,
      sourceUrl: release.html_url,
      confidence: line.includes("[BUG]") || /\bbug\b/i.test(line) ? 0.9 : 0.7
    }));
}

export function knownIssuesFromRelease(release: GithubRelease): string[] {
  const body = release.body ?? "";
  const match = body.match(/#+\s*Known Issues([\s\S]*?)(?:\n#+\s|$)/i);
  if (!match) return [];
  return match[1]
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-*|]\s*/, "").trim())
    .filter((line) => line && !/^[-:| ]+$/.test(line))
    .slice(0, 30);
}

export function bugCandidateFromPullRequest(pr: GithubPullRequest): {
  externalId?: string;
  title: string;
  description: string;
  sourceUrl: string;
  confidence: number;
  commitSha?: string | null;
} | null {
  // Exclude bot-generated PRs (dependency bumps, CSM sync bots)
  if (/\bbump\b|dependabot|csmbot|renovate|@csmbot/i.test(pr.title)) return null;
  const text = `${pr.title}\n${pr.body ?? ""}`;
  if (!isBugLike(text)) return null;
  // Use title-only for confidence: body text from bots often contains "bug"/"fix" noise
  return {
    externalId: extractIssueId(text),
    title: pr.title.slice(0, 240),
    description: pr.body || pr.title,
    sourceUrl: pr.html_url,
    confidence: /\[bug|bug[-_\s:]|\bfix(es|ed)?\b/i.test(pr.title) ? 0.85 : 0.65,
    commitSha: pr.merge_commit_sha
  };
}

export function bugCandidateFromCommit(commit: GithubCommit): {
  externalId?: string;
  title: string;
  description: string;
  sourceUrl: string;
  confidence: number;
  commitSha: string;
} | null {
  if (!isBugLike(commit.commit.message)) return null;
  const firstLine = commit.commit.message.split(/\r?\n/)[0] ?? commit.sha;
  return {
    externalId: extractIssueId(commit.commit.message),
    title: firstLine.slice(0, 240),
    description: commit.commit.message,
    sourceUrl: commit.html_url,
    confidence: 0.55,
    commitSha: commit.sha
  };
}

export function extractVersionMentions(text: string): string[] {
  return Array.from(new Set(text.match(/\b\d+\.\d+(?:\.\d+)?(?:\.x)?\b/g) ?? []));
}

export function parseTridentConfigGo(source: string): { kubernetes: string[]; openshift: string[] } | null {
  // Each Trident release tag has authoritative constants in config/config.go:
  //   KubernetesVersionMin = "v1.27"
  //   KubernetesVersionMax = "v1.35"
  const minMatch = source.match(/KubernetesVersionMin\s*=\s*"v?(\d+\.\d+)"/);
  const maxMatch = source.match(/KubernetesVersionMax\s*=\s*"v?(\d+\.\d+)"/);
  if (!minMatch || !maxMatch) return null;

  const [minMaj, minMin] = minMatch[1].split(".").map(Number);
  const [, maxMin] = maxMatch[1].split(".").map(Number);

  const kubernetes: string[] = [];
  const openshift: string[] = [];
  for (let minor = minMin; minor <= maxMin; minor++) {
    kubernetes.push(`${minMaj}.${minor}`);
    // OCP 4.x ships K8s 1.(x+13), so K8s 1.minor → OCP 4.(minor-13)
    const ocpMinor = minor - 13;
    if (ocpMinor >= 10) openshift.push(`4.${ocpMinor}`);
  }
  return { kubernetes, openshift };
}

export function parseVerifyScript(script: string): { kubernetes: string[]; openshift: string[] } {
  const k8sMatch = script.match(/verify_k8s_versions\s+"(\d+\.\d+)"\s+"(\d+\.\d+)"/);
  const ocpMatch = script.match(/verify_openshift_versions\s+"(\d+\.\d+)"\s+"(\d+\.\d+)"/);

  function range(min: string, max: string): string[] {
    const [minMaj, minMin] = min.split(".").map(Number);
    const [maxMaj, maxMin] = max.split(".").map(Number);
    const versions: string[] = [];
    for (let minor = minMin; minor <= maxMin; minor++) {
      versions.push(`${minMaj}.${minor}`);
    }
    return versions;
  }

  return {
    kubernetes: k8sMatch ? range(k8sMatch[1], k8sMatch[2]) : [],
    openshift: ocpMatch ? range(ocpMatch[1], ocpMatch[2]) : []
  };
}
