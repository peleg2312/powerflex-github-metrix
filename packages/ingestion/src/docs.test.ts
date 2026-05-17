import { describe, expect, it, vi } from "vitest";
import { DocsAdapter } from "./docs.js";

describe("DocsAdapter", () => {
  it("marks docs as unknown when no parseable compatibility table exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        text: async () => "<main><h1>PowerFlex</h1><p>No table here.</p></main>"
      }))
    );
    const result = await new DocsAdapter().scrape({
      kind: "docs",
      name: "test",
      url: "https://docs.test",
      productSlug: "csi-powerflex"
    });
    expect(result.edges[0].status).toBe("unknown");
    vi.unstubAllGlobals();
  });
});
