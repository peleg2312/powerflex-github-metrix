import { load } from "cheerio";
import type { DocsSource } from "./config.js";
import { checksum, extractVersionMentions } from "./normalizers.js";

export type DocsCompatibilityResult = {
  sourceUrl: string;
  sourceName: string;
  evidence: Array<{ selector: string; rawText: string; checksum: string }>;
  edges: Array<{
    sourceVersion: string;
    targetKind: "kubernetes" | "openshift" | "powerflex_backend" | "csm" | "csi_driver";
    targetVersion: string;
    status: "supported" | "unsupported" | "inferred" | "unknown";
    confidence: number;
    evidenceText: string;
  }>;
};

type EdgeKind = DocsCompatibilityResult["edges"][number]["targetKind"];

export class DocsAdapter {
  async scrape(source: DocsSource): Promise<DocsCompatibilityResult> {
    const response = await fetch(source.url);
    if (!response.ok) {
      throw new Error(`Docs request failed ${response.status} for ${source.url}`);
    }
    const html = await response.text();
    const $ = load(html);
    const text = $("main").text().replace(/\s+/g, " ").trim() || $("body").text().replace(/\s+/g, " ").trim();
    const evidence = [{ selector: "main", rawText: text.slice(0, 30000), checksum: checksum(text) }];
    const edges: DocsCompatibilityResult["edges"] = [];
    let versionEdgesFound = 0;

    const pushEdge = (sourceVersion: string, targetKind: EdgeKind, targetVersion: string, confidence: number, evidenceText: string) => {
      if (!targetVersion || !sourceVersion) return;
      edges.push({ sourceVersion, targetKind, targetVersion, status: "supported", confidence, evidenceText });
    };

    // Collect K8s versions from Platform/Version table to cross-assign to operators.
    const pageK8sVersions: string[] = [];

    $("table").each((_, table) => {
      const allRows: string[][] = [];
      $(table)
        .find("tr")
        .each((_, row) => {
          const cells = $(row)
            .find("th, td")
            .map((_, cell) => $(cell).text().replace(/\s+/g, " ").trim())
            .get();
          if (cells.length) allRows.push(cells);
        });

      if (!allRows.length) return;

      const headers = allRows[0].map((h) => h.toLowerCase());
      const dataRows = allRows.slice(1);

      // ── Table type A: "OpenShift Version | Operator / CSM Combination" ─────────
      // Key table mapping each OpenShift version to operator+CSM combinations.
      // We invert it to get per-operator edges, and also derive K8s versions
      // using the known OCP minor → K8s minor formula: K8s 1.(ocpMinor+13)
      const osVersionColIdx = headers.findIndex((h) => h.includes("openshift") && h.includes("version"));
      const operatorComboColIdx = headers.findIndex((h) => h.includes("operator") && (h.includes("csm") || h.includes("combination")));
      if (osVersionColIdx >= 0 && operatorComboColIdx >= 0) {
        for (const row of dataRows) {
          const openshift = row[osVersionColIdx]?.trim();
          const combos = row[operatorComboColIdx] ?? "";
          if (!openshift || !combos) continue;
          // Each pair looks like "1.6.1 / 1.11.1" (operator / csm)
          const pairMatches = combos.matchAll(/(\d+\.\d+(?:\.\d+)?)\s*\/\s*(\d+\.\d+(?:\.\d+)?)/g);
          for (const [rawPair, operator, csm] of pairMatches) {
            pushEdge(operator, "openshift", openshift, 0.95, `${openshift}: ${rawPair}`);
            pushEdge(operator, "csm", csm, 0.95, `${openshift}: ${rawPair}`);
            // Derive K8s version from OpenShift version (OCP 4.x → K8s 1.(x+13))
            const ocpMinor = parseInt(openshift.split(".")[1] ?? "");
            if (!isNaN(ocpMinor) && ocpMinor > 0) {
              const k8sVersion = `1.${ocpMinor + 13}`;
              pushEdge(operator, "kubernetes", k8sVersion, 0.75, `K8s ${k8sVersion} derived from OpenShift ${openshift}`);
            }
            versionEdgesFound++;
          }
        }
        return; // done with this table
      }

      // ── Table type B: "Platform | Version" ───────────────────────────────────
      // Generic current-platform support table. Stored as current-docs.
      // Also accumulate K8s versions for cross-assignment to operators on this page.
      const platformColIdx = headers.findIndex((h) => h === "platform");
      const versionColIdx = headers.findIndex((h) => h === "version");
      if (platformColIdx >= 0 && versionColIdx >= 0) {
        for (const row of dataRows) {
          const platform = row[platformColIdx]?.toLowerCase() ?? "";
          const versions = extractVersionMentions(row[versionColIdx] ?? "");
          if (platform.includes("kubernetes")) {
            versions.forEach((v) => {
              pageK8sVersions.push(v);
              pushEdge("current-docs", "kubernetes", v, 0.8, row.join(" | "));
            });
          } else if (platform.includes("openshift")) {
            versions.forEach((v) => pushEdge("current-docs", "openshift", v, 0.8, row.join(" | ")));
          }
        }
        return;
      }

      // ── Table type C: Prerequisites table with product columns ────────────────
      // "Prerequisites | PowerStore | PowerScale | PowerFlex | PowerMax | ..."
      const pfxColIdx = headers.findIndex((h) => h.includes("powerflex") && !h.includes("version"));
      const prereqColIdx = headers.findIndex((h) => h.includes("prerequisites") || h.includes("driver") || h === "");
      if (pfxColIdx >= 0 && prereqColIdx >= 0) {
        for (const row of dataRows) {
          const rowLabel = row[prereqColIdx]?.toLowerCase() ?? "";
          if (rowLabel.includes("version")) {
            const versions = extractVersionMentions(row[pfxColIdx] ?? "");
            versions.forEach((v) => pushEdge("current-docs", "powerflex_backend", v, 0.8, row.join(" | ")));
          }
        }
      }
    });

    // ── Fallback: regex on raw text when no structured tables matched ─────────
    if (edges.length === 0) {
      const storageMatch = text.match(/PowerFlex\s+((?:\d+\.\d+(?:\.x)?(?:,\s*)?)+)/i);
      if (storageMatch) {
        extractVersionMentions(storageMatch[1]).forEach((v) => pushEdge("current-docs", "powerflex_backend", v, 0.6, storageMatch[0]));
      }
      const k8sMatch = text.match(/Kubernetes\s+((?:\d+\.\d+(?:,\s*)?)+)/i);
      if (k8sMatch) {
        extractVersionMentions(k8sMatch[1]).forEach((v) => pushEdge("current-docs", "kubernetes", v, 0.6, k8sMatch[0]));
      }
      const osMatch = text.match(/Red Hat OpenShift\s+((?:\d+\.\d+(?:,\s*)?)+)/i);
      if (osMatch) {
        extractVersionMentions(osMatch[1]).forEach((v) => pushEdge("current-docs", "openshift", v, 0.6, osMatch[0]));
      }
    }

    if (edges.length === 0) {
      edges.push({
        sourceVersion: "current-docs",
        targetKind: "csi_driver",
        targetVersion: "unknown",
        status: "unknown",
        confidence: 0.2,
        evidenceText: "No machine-readable compatibility table was detected."
      });
    }

    return { sourceUrl: source.url, sourceName: source.name, evidence, edges };
  }
}
