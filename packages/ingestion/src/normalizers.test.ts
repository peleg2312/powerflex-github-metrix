import { describe, expect, it } from "vitest";
import {
  bugCandidateFromCommit,
  bugCandidateFromPullRequest,
  inferSeverity,
  knownIssuesFromRelease,
  normalizeVersion,
  releaseBugCandidates
} from "./normalizers.js";

describe("normalizers", () => {
  it("normalizes release tags without hardcoded version lists", () => {
    expect(normalizeVersion("v1.16.3")).toBe("1.16.3");
    expect(normalizeVersion("release-v2.12.0")).toBe("2.12.0");
  });

  it("extracts bug fixes from GitHub release notes", () => {
    const bugs = releaseBugCandidates({
      id: 1,
      tag_name: "v1.0.1",
      name: "v1.0.1",
      body: "- Fixed controller crash when secret is missing\n- Added docs",
      html_url: "https://github.com/dell/csm-operator/releases/tag/v1.0.1",
      draft: false,
      prerelease: false,
      published_at: "2026-01-01T00:00:00Z",
      created_at: "2026-01-01T00:00:00Z",
      target_commitish: "main",
      assets: []
    });
    expect(bugs).toHaveLength(1);
    expect(bugs[0].description).toContain("crash");
  });

  it("extracts known issues from release sections", () => {
    const issues = knownIssuesFromRelease({
      id: 1,
      tag_name: "v1.0.1",
      name: "v1.0.1",
      body: "## Known Issues\n- Upgrade can take longer on large clusters\n## Fixes\n- Fixed bug",
      html_url: "https://example.test",
      draft: false,
      prerelease: false,
      published_at: "2026-01-01T00:00:00Z",
      created_at: "2026-01-01T00:00:00Z",
      target_commitish: "main",
      assets: []
    });
    expect(issues).toEqual(["Upgrade can take longer on large clusters"]);
  });

  it("infers severity from security and crash language", () => {
    expect(inferSeverity("Fix CVE-2026-1234")).toBe("critical");
    expect(inferSeverity("Fix crash during reconcile")).toBe("high");
  });

  it("extracts bug candidates from PRs and commits", () => {
    expect(
      bugCandidateFromPullRequest({
        number: 42,
        title: "Fix mount failure",
        body: "Resolves #41",
        state: "closed",
        html_url: "https://github.test/pr/42",
        merged_at: "2026-01-01T00:00:00Z",
        merge_commit_sha: "abc"
      })
    )?.toMatchObject({ externalId: "#41" });
    expect(
      bugCandidateFromCommit({
        sha: "abc",
        html_url: "https://github.test/commit/abc",
        commit: { message: "fix: broken node registration" }
      })
    )?.toMatchObject({ commitSha: "abc" });
  });
});
