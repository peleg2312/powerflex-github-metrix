import crypto from "node:crypto";
import { Injectable } from "@nestjs/common";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import semver from "semver";
import { prisma } from "@powerflex/db";
import { recommendationScore, riskScore } from "@powerflex/ingestion";
import type { BugFix, CompatibilityCell, Recommendation, UpgradeStep, VersionProjection } from "@powerflex/shared-schema";

type Query = Record<string, string | undefined>;

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

function cleanVersion(version: string): string {
  return version.replace(/^v/i, "");
}

function minor(version: string): string | null {
  const parsed = semver.parse(cleanVersion(version));
  return parsed ? String(parsed.minor) : version.match(/\d+\.(\d+)/)?.[1] ?? null;
}

@Injectable()
export class AppService {
  private readonly redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  private readonly queue = new Queue("sync", {
    connection: this.redis
  });

  async versions(query: Query): Promise<VersionProjection[]> {
    const cacheKey = `versions:${JSON.stringify(query)}`;
    const cached = await this.cacheGet<VersionProjection[]>(cacheKey);
    if (cached) return cached;

    const slug = query.product ?? "csi-powerflex";
    const releases = await prisma.release.findMany({
      where: {
        product: { slug },
        isDraft: false,
        ...(query.operatorVersion ? { version: cleanVersion(query.operatorVersion) } : {})
      },
      include: { fixedBugs: true, knownIssues: true },
      orderBy: { releaseDate: "desc" }
    });

    // Load all edges keyed by sourceVersion for direct CSI lookups (from verify script)
    const allEdges = await prisma.compatibilityEdge.findMany();
    const edgesBySource = new Map<string, typeof allEdges>();
    for (const edge of allEdges) {
      const list = edgesBySource.get(edge.sourceVersion) ?? [];
      list.push(edge);
      edgesBySource.set(edge.sourceVersion, list);
    }
    // CSM edges for operator version lookup (for display only, not compatibility)
    const csmEdges = allEdges.filter((e) => e.targetKind === "csm");

    const projections = releases.map((release) => {
      // Direct lookup: per-CSI-version edges from verify-csi-vxflexos.sh (confidence 0.98)
      const directEdges = edgesBySource.get(release.version) ?? [];

      // CSM operator version for display (bridge: CSI 2.X minor → CSM 1.X minor → operator)
      const csiMinor = minor(release.version);
      const csmEdge = csiMinor ? csmEdges.find((e) => minor(e.targetVersion) === csiMinor) : null;
      const operatorVersion = csmEdge?.sourceVersion ?? null;

      const backendVersions = this.edgeVersions(directEdges, "powerflex_backend");

      const bugs = release.fixedBugs.map<BugFix>((bug) => ({
        id: bug.externalId ?? bug.id,
        description: bug.description,
        fixed_in_version: bug.fixedInVersion,
        commit_sha: bug.commitSha,
        severity: bug.severity,
        source_url: bug.sourceUrl ?? undefined,
        confidence: bug.confidence
      }));
      const confidence = directEdges.length ? this.average(directEdges.map((e) => e.confidence), 0.5) : 0.5;
      const compatibilityCount = directEdges.filter((e) => e.status === "supported").length;
      return {
        // operator_version field repurposed: holds the CSI PowerFlex version (primary)
        operator_version: release.version,
        // csi_driver_version field repurposed: holds the associated CSM Operator version
        csi_driver_version: operatorVersion,
        kubernetes_supported: this.edgeVersions(directEdges, "kubernetes"),
        openshift_supported: this.edgeVersions(directEdges, "openshift"),
        powerflex_backend_version: backendVersions,
        bugs_fixed: bugs,
        known_issues: release.knownIssues.map((issue) => issue.description),
        release_date: release.releaseDate.toISOString(),
        risk_score: riskScore({
          version: release.version,
          releaseDate: release.releaseDate,
          bugs: release.fixedBugs,
          knownIssues: release.knownIssues.length,
          confidence,
          compatibilityCount
        }),
        confidence
      } satisfies VersionProjection;
    });

    const filtered = projections.filter((projection) => {
      if (query.kubernetes && !projection.kubernetes_supported.includes(query.kubernetes)) return false;
      if (query.openshift && !projection.openshift_supported.includes(query.openshift)) return false;
      if (query.q) {
        const haystack = JSON.stringify(projection).toLowerCase();
        if (!haystack.includes(query.q.toLowerCase())) return false;
      }
      return true;
    });
    await this.cacheSet(cacheKey, filtered);
    return filtered;
  }

  async compatibility(query: Query): Promise<CompatibilityCell[]> {
    const edges = await prisma.compatibilityEdge.findMany({
      where: {
        ...(query.version ? { sourceVersion: cleanVersion(query.version) } : {}),
        ...(query.kubernetes ? { targetKind: "kubernetes", targetVersion: query.kubernetes } : {}),
        ...(query.openshift ? { targetKind: "openshift", targetVersion: query.openshift } : {}),
        ...(query.powerflexBackend ? { targetKind: "powerflex_backend", targetVersion: query.powerflexBackend } : {})
      },
      orderBy: [{ sourceVersion: "desc" }, { targetKind: "asc" }]
    });
    return edges.map((edge) => ({
      operator_version: edge.sourceVersion,
      csi_driver_version: null,
      target_kind: edge.targetKind as CompatibilityCell["target_kind"],
      target_version: edge.targetVersion,
      status: edge.status,
      confidence: edge.confidence,
      source_url: edge.sourceUrl ?? undefined
    }));
  }

  async matrix(query: Query) {
    const cacheKey = `matrix:${JSON.stringify(query)}`;
    const cached = await this.cacheGet<{ generated_at: string; rows: any[] }>(cacheKey);
    if (cached) return cached;

    const versions = await this.versions(query);
    const rows = versions.map((version) => ({
      operator_version: version.operator_version,
      csi_driver_version: version.csi_driver_version ?? "unknown",
      kubernetes: version.kubernetes_supported.length ? version.kubernetes_supported : [],
      openshift: version.openshift_supported.length ? version.openshift_supported : [],
      powerflex_backend: version.powerflex_backend_version.length ? version.powerflex_backend_version : []
    }));
    const result = { generated_at: new Date().toISOString(), rows };
    await this.cacheSet(cacheKey, result);
    return result;
  }

  async bugs(query: Query) {
    const q = query.q?.trim();
    const take = Math.min(Number(query.limit ?? 100), 250);
    // Default minimum confidence: 0.7 (release-note quality). Drops low-signal commit/PR noise.
    const minConf = parseFloat(query.minConfidence ?? "0.7");

    // Match all patch releases in the same minor version (e.g. "2.16" matches 2.16.0, 2.16.1, ...)
    const versionPrefix = query.version ? (() => {
      const v = cleanVersion(query.version);
      const parsed = semver.parse(v);
      return parsed ? `${parsed.major}.${parsed.minor}` : v.split(".").slice(0, 2).join(".");
    })() : null;

    if (q) {
      const confClause = `AND "confidence" >= ${minConf}`;
      const sql = versionPrefix
        ? `
          SELECT *
          FROM "Bug"
          WHERE to_tsvector('english', coalesce("title", '') || ' ' || coalesce("description", '') || ' ' || coalesce("externalId", ''))
            @@ plainto_tsquery('english', $1)
            AND "fixedInVersion" LIKE $2
            ${confClause}
          ORDER BY "confidence" DESC, "updatedAt" DESC
          LIMIT ${take}
        `
        : `
          SELECT *
          FROM "Bug"
          WHERE to_tsvector('english', coalesce("title", '') || ' ' || coalesce("description", '') || ' ' || coalesce("externalId", ''))
            @@ plainto_tsquery('english', $1)
            ${confClause}
          ORDER BY "confidence" DESC, "updatedAt" DESC
          LIMIT ${take}
        `;
      const rows = versionPrefix
        ? await prisma.$queryRawUnsafe(sql, q, `${versionPrefix}%`)
        : await prisma.$queryRawUnsafe(sql, q);
      return rows;
    }
    return prisma.bug.findMany({
      where: {
        ...(versionPrefix ? { fixedInVersion: { startsWith: versionPrefix } } : {}),
        ...(query.severity ? { severity: query.severity as any } : {}),
        ...(query.source ? { sourceUrl: { contains: query.source } } : {}),
        confidence: { gte: minConf }
      },
      orderBy: [{ confidence: "desc" }, { updatedAt: "desc" }],
      take
    });
  }

  async knownIssues(query: Query) {
    return prisma.knownIssue.findMany({
      where: {
        ...(query.version ? { version: cleanVersion(query.version) } : {})
      },
      orderBy: { version: "desc" },
      take: 100
    });
  }

  async recommendations(query: Query): Promise<Recommendation[]> {
    const versions = await this.versions(query);
    return versions
      .map((version) => {
        const scoreInput = {
          version: version.operator_version,
          releaseDate: new Date(version.release_date),
          bugs: version.bugs_fixed.map((bug) => ({ severity: bug.severity })),
          knownIssues: version.known_issues.length,
          confidence: version.confidence,
          compatibilityCount:
            version.kubernetes_supported.length + version.openshift_supported.length + version.powerflex_backend_version.length
        };
        const score = recommendationScore(scoreInput);
        const reasons = [
          `${version.kubernetes_supported.length || "unknown"} Kubernetes support signals`,
          `${version.openshift_supported.length || "unknown"} OpenShift support signals`,
          `${version.bugs_fixed.length} fixed bug records`,
          `${version.known_issues.length} known issues`
        ];
        return {
          operator_version: version.operator_version,
          csi_driver_version: version.csi_driver_version,
          score,
          risk_score: version.risk_score,
          reasons
        };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);
  }

  async upgradePath(from?: string, to?: string): Promise<UpgradeStep[]> {
    if (!from || !to) return [];
    const versions = await this.versions({});
    const sorted = versions
      .filter((version) => semver.valid(cleanVersion(version.operator_version)))
      .sort((a, b) => semver.compare(cleanVersion(a.operator_version), cleanVersion(b.operator_version)));
    const fromIndex = sorted.findIndex((version) => cleanVersion(version.operator_version) === cleanVersion(from));
    const toIndex = sorted.findIndex((version) => cleanVersion(version.operator_version) === cleanVersion(to));
    if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return [];
    const slice = fromIndex < toIndex ? sorted.slice(fromIndex, toIndex + 1) : sorted.slice(toIndex, fromIndex + 1).reverse();
    return slice.slice(1).map<UpgradeStep>((version, index) => ({
      from_version: slice[index].operator_version,
      to_version: version.operator_version,
      risk_score: version.risk_score,
      notes: [
        version.csi_driver_version ? `PowerFlex CSI driver candidate ${version.csi_driver_version}` : "CSI driver version unknown",
        version.confidence < 0.6 ? "Compatibility data is incomplete; validate against source links." : "Compatibility evidence is available."
      ]
    }));
  }

  async features(query: Query): Promise<Array<{
    version: string;
    release_date: string;
    release_url: string | null;
    changes: Array<{ title: string; type: "feature" | "fix" | "chore"; author: string; pr_url: string }>;
  }>> {
    const versionPrefix = query.version ? (() => {
      const v = cleanVersion(query.version);
      const parsed = semver.parse(v);
      return parsed ? `${parsed.major}.${parsed.minor}` : v.split(".").slice(0, 2).join(".");
    })() : null;

    const slug = query.product ?? "csi-powerflex";
    const releases = await prisma.release.findMany({
      where: {
        product: { slug },
        isDraft: false,
        ...(versionPrefix ? { version: { startsWith: versionPrefix } } : {})
      },
      orderBy: { releaseDate: "desc" },
      select: { version: true, releaseDate: true, body: true, url: true }
    });

    const PR_LINE = /^\*\s+(.+?)\s+by\s+(@\S+)\s+in\s+(https:\/\/\S+)/;
    const BOT = /dependabot|csmbot|renovate|@csm-release|@csmbot/i;
    const BUMP = /^bump\b|^update\s+(go\s+version|dell\s+lib|actions|k8s.*version|ocp.*version|dependabot\s+config|reusable|workflow)/i;
    const INFRA = /codeowners|oneclick|one.?click\s+action|image\s+version\s+update|release\s+action|makefile|preflight.*label|driver\s+version\s+bump|version\s+bump|version\s+update|reusable\s+workflows?|updated?\s+go\.mod/i;
    const FIX = /\bfix(e[sd])?\b|\bresolve[sd]?\b|\bbug\b|\bcrash\b|\bcve-\d{4}-\d+/i;
    const FEAT = /\badd(ed|ing)?\b|\bsupport\b|\bimplement\b|\bintroduce\b|\benable[sd]?\b|\bdisabl(e[sd]?|ing)\b|\bexpose\b|\bnew\s+\w|\ballow\b|\bextend\b|\bmulti-|\baz\s+support|\bzone\s+support|\bprovisioning\b|\bcapabilit/i;

    return releases.map((release) => {
      const lines = (release.body ?? "").split(/\r?\n/);
      const changes: Array<{ title: string; type: "feature" | "fix" | "chore"; author: string; pr_url: string }> = [];

      for (const line of lines) {
        const m = line.match(PR_LINE);
        if (!m) continue;
        const [, rawTitle, author, prUrl] = m;
        const title = rawTitle.trim();
        if (BOT.test(author) || BOT.test(title)) continue;
        if (BUMP.test(title) || INFRA.test(title)) continue;
        const q = query.q?.toLowerCase();
        if (q && !title.toLowerCase().includes(q)) continue;
        const type: "feature" | "fix" | "chore" = FIX.test(title) ? "fix" : FEAT.test(title) ? "feature" : "chore";
        if (query.type && query.type !== type) continue;
        changes.push({ title, type, author, pr_url: prUrl });
      }

      return { version: release.version, release_date: release.releaseDate.toISOString(), release_url: release.url, changes };
    }).filter((r) => r.changes.length > 0 || !!versionPrefix);
  }

  async driverVersions(product: string): Promise<string[]> {
    const releases = await prisma.release.findMany({
      where: { product: { slug: product } },
      orderBy: { releaseDate: "desc" },
      select: { version: true }
    });
    return releases.map((r) => r.version);
  }

  async products(): Promise<Array<{ slug: string; name: string }>> {
    return prisma.product.findMany({
      where: { kind: "csi_driver", releases: { some: {} } },
      select: { slug: true, name: true },
      orderBy: { name: "asc" }
    });
  }

  verifyGithubSignature(rawBody: Buffer, signature?: string): boolean {
    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) return process.env.NODE_ENV !== "production";
    if (!signature?.startsWith("sha256=")) return false;
    const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
    const actual = Buffer.from(signature);
    const wanted = Buffer.from(expected);
    return actual.length === wanted.length && crypto.timingSafeEqual(actual, wanted);
  }

  async enqueueGithubWebhook(event: string, body: unknown) {
    await this.queue.add("github-webhook", { event, body }, { attempts: 3, backoff: { type: "exponential", delay: 5000 } });
    return { queued: true, event };
  }

  private edgeVersions(edges: Array<{ targetKind: string; targetVersion: string; status: string }>, kind: string): string[] {
    return Array.from(
      new Set(edges.filter((edge) => edge.targetKind === kind && edge.status !== "unsupported").map((edge) => edge.targetVersion))
    ).sort((a, b) => {
      if (semver.valid(a) && semver.valid(b)) return semver.compare(a, b);
      return a.localeCompare(b);
    });
  }

  private average(values: number[], fallback: number): number {
    if (!values.length) return fallback;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
  }

  private async cacheGet<T>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.get(key);
      return value ? (JSON.parse(value) as T) : null;
    } catch {
      return null;
    }
  }

  private async cacheSet(key: string, value: unknown): Promise<void> {
    try {
      await this.redis.set(key, JSON.stringify(value), "EX", 60);
    } catch {
      // API correctness wins over cache availability.
    }
  }
}
