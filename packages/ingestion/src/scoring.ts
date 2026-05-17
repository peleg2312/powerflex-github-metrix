import semver from "semver";

export type ScoreInput = {
  version: string;
  releaseDate: Date;
  bugs: Array<{ severity: string }>;
  knownIssues: number;
  confidence: number;
  compatibilityCount: number;
};

export function riskScore(input: ScoreInput): number {
  const severityCost = input.bugs.reduce((sum, bug) => {
    if (bug.severity === "critical") return sum + 18;
    if (bug.severity === "high") return sum + 12;
    if (bug.severity === "medium") return sum + 7;
    if (bug.severity === "low") return sum + 3;
    return sum + 5;
  }, 0);
  const issueCost = input.knownIssues * 6;
  const unknownPenalty = Math.round((1 - input.confidence) * 20);
  const prereleasePenalty = semver.prerelease(input.version.replace(/^v/, "")) ? 20 : 0;
  return Math.min(100, Math.max(0, severityCost + issueCost + unknownPenalty + prereleasePenalty));
}

export function recommendationScore(input: ScoreInput): number {
  const ageDays = Math.max(0, (Date.now() - input.releaseDate.getTime()) / 86400000);
  const recency = ageDays < 45 ? 10 : ageDays < 240 ? 20 : 8;
  const compatibility = Math.min(25, input.compatibilityCount * 4);
  const patchBonus = /\d+\.\d+\.[1-9]\d*$/.test(input.version.replace(/^v/, "")) ? 10 : 4;
  return Math.max(0, Math.min(100, 100 - riskScore(input) + recency + compatibility + patchBonus - 25));
}
