import { describe, expect, it } from "vitest";
import { recommendationScore, riskScore } from "./scoring.js";

describe("scoring", () => {
  it("raises risk for severe bugs and known issues", () => {
    const score = riskScore({
      version: "1.0.0",
      releaseDate: new Date(),
      bugs: [{ severity: "critical" }, { severity: "high" }],
      knownIssues: 2,
      confidence: 0.5,
      compatibilityCount: 1
    });
    expect(score).toBeGreaterThan(35);
  });

  it("rewards compatibility evidence in recommendations", () => {
    const score = recommendationScore({
      version: "1.2.3",
      releaseDate: new Date(),
      bugs: [],
      knownIssues: 0,
      confidence: 0.9,
      compatibilityCount: 5
    });
    expect(score).toBeGreaterThan(80);
  });
});
