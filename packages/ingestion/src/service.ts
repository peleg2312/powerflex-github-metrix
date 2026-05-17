import { prisma as defaultPrisma, type PrismaClient } from "@powerflex/db";
import type { CompatibilityStatus, Severity } from "@prisma/client";
import { loadSourceConfig, type GithubSource, type SourceConfig } from "./config.js";
import { DocsAdapter } from "./docs.js";
import { GithubAdapter, type GithubRelease } from "./github.js";
import {
  bugCandidateFromCommit,
  bugCandidateFromPullRequest,
  checksum,
  inferSeverity,
  knownIssuesFromRelease,
  normalizeVersion,
  parseVerifyScript,
  releaseBugCandidates
} from "./normalizers.js";

function stripV(version: string): string {
  return version.replace(/^v/i, "");
}

export class IngestionService {
  private readonly github = new GithubAdapter();
  private readonly docs = new DocsAdapter();

  constructor(
    private readonly db: PrismaClient = defaultPrisma,
    private readonly config: SourceConfig = loadSourceConfig()
  ) {}

  async syncAll(): Promise<{ recordsSeen: number; recordsUpserted: number }> {
    let recordsSeen = 0;
    let recordsUpserted = 0;
    const run = await this.db.syncRun.create({
      data: { source: "all", status: "running" }
    });

    const errors: string[] = [];
    try {
      for (const source of this.config.github) {
        try {
          const result = await this.syncGithubSource(source);
          recordsSeen += result.recordsSeen;
          recordsUpserted += result.recordsUpserted;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[sync] GitHub source ${source.repo} failed (skipping): ${msg.slice(0, 120)}`);
          errors.push(msg.slice(0, 120));
        }
      }
      for (const source of this.config.docs) {
        try {
          const result = await this.syncDocsSource(source);
          recordsSeen += result.recordsSeen;
          recordsUpserted += result.recordsUpserted;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[sync] Docs source ${source.url} failed (skipping): ${msg.slice(0, 120)}`);
          errors.push(msg.slice(0, 120));
        }
      }
      await this.db.syncRun.update({
        where: { id: run.id },
        data: {
          status: errors.length ? "failed" : "success",
          finishedAt: new Date(),
          recordsSeen,
          recordsUpserted,
          ...(errors.length ? { message: errors.join("; ") } : {})
        }
      });
      return { recordsSeen, recordsUpserted };
    } catch (error) {
      await this.db.syncRun.update({
        where: { id: run.id },
        data: {
          status: "failed",
          finishedAt: new Date(),
          recordsSeen,
          recordsUpserted,
          message: error instanceof Error ? error.message : String(error)
        }
      });
      throw error;
    }
  }

  async syncGithubSource(source: GithubSource): Promise<{ recordsSeen: number; recordsUpserted: number }> {
    const { product, repository } = await this.ensureProductAndRepository(source);
    const releases = await this.github.releases(source);
    const tags = await this.github.tags(source);
    const prs = await this.github.pullRequests(source);
    const commits = await this.github.commits(source, new Date(Date.now() - 1000 * 60 * 60 * 24 * 365));
    let recordsUpserted = 0;

    for (const release of releases) {
      const dbRelease = await this.upsertRelease(product.id, repository.id, release);
      recordsUpserted++;

      await this.db.sourceEvidence.upsert({
        where: { sourceUrl_checksum: { sourceUrl: release.html_url, checksum: checksum(release.body ?? release.tag_name) } },
        create: {
          sourceKind: source.legacy ? "legacy" : "github",
          sourceUrl: release.html_url,
          selector: "release.body",
          rawText: release.body ?? "",
          checksum: checksum(release.body ?? release.tag_name),
          releaseId: dbRelease.id
        },
        update: { rawText: release.body ?? "", releaseId: dbRelease.id }
      });

      for (const bug of releaseBugCandidates(release)) {
        await this.db.bug.upsert({
          where: {
            fixedInVersion_title_sourceUrl: {
              fixedInVersion: stripV(release.tag_name),
              title: bug.title,
              sourceUrl: bug.sourceUrl
            }
          },
          create: {
            externalId: bug.externalId,
            title: bug.title,
            description: bug.description,
            severity: inferSeverity(bug.description) as Severity,
            fixedInVersion: stripV(release.tag_name),
            commitSha: bug.commitSha,
            sourceUrl: bug.sourceUrl,
            confidence: bug.confidence,
            releaseId: dbRelease.id
          },
          update: {
            description: bug.description,
            severity: inferSeverity(bug.description) as Severity,
            confidence: bug.confidence,
            releaseId: dbRelease.id
          }
        });
        recordsUpserted++;
      }

      for (const issue of knownIssuesFromRelease(release)) {
        await this.db.knownIssue.upsert({
          where: { version_description: { version: stripV(release.tag_name), description: issue } },
          create: {
            version: stripV(release.tag_name),
            description: issue,
            sourceUrl: release.html_url,
            confidence: 0.8,
            releaseId: dbRelease.id
          },
          update: { sourceUrl: release.html_url, releaseId: dbRelease.id }
        });
      }

      // Fetch authoritative K8s/OCP compatibility from verify script in each tagged release
      if (source.productSlug === "csi-powerflex") {
        await this.syncVerifyScript(source, release.tag_name, stripV(release.tag_name));
      }
    }

    const releasedTags = new Set(releases.map((release) => release.tag_name));
    for (const tag of tags.filter((item) => !releasedTags.has(item.name))) {
      await this.upsertRelease(product.id, repository.id, {
        id: 0,
        tag_name: tag.name,
        name: tag.name,
        body: "Tag discovered without a GitHub Release body. Compatibility and bug metadata are unknown until source evidence appears.",
        html_url: `https://github.com/${source.owner}/${source.repo}/releases/tag/${tag.name}`,
        draft: false,
        prerelease: /alpha|beta|rc/i.test(tag.name),
        published_at: null,
        created_at: new Date().toISOString(),
        target_commitish: tag.commit.sha,
        assets: []
      });
      recordsUpserted++;
    }

    const latestVersion = releases[0]?.tag_name ? stripV(releases[0].tag_name) : "unknown";

    for (const pr of prs) {
      const saved = await this.db.pullRequest.upsert({
        where: { repositoryId_number: { repositoryId: repository.id, number: pr.number } },
        create: {
          repositoryId: repository.id,
          number: pr.number,
          title: pr.title,
          body: pr.body,
          state: pr.state,
          mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
          mergeCommit: pr.merge_commit_sha,
          url: pr.html_url
        },
        update: {
          title: pr.title,
          body: pr.body,
          state: pr.state,
          mergedAt: pr.merged_at ? new Date(pr.merged_at) : null,
          mergeCommit: pr.merge_commit_sha,
          url: pr.html_url
        }
      });
      const bug = bugCandidateFromPullRequest(pr);
      if (bug) {
        await this.db.bug.upsert({
          where: { fixedInVersion_title_sourceUrl: { fixedInVersion: latestVersion, title: bug.title, sourceUrl: bug.sourceUrl } },
          create: {
            externalId: bug.externalId,
            title: bug.title,
            description: bug.description,
            severity: inferSeverity(bug.description) as Severity,
            fixedInVersion: latestVersion,
            commitSha: bug.commitSha ?? undefined,
            sourceUrl: bug.sourceUrl,
            confidence: bug.confidence,
            pullRequestId: saved.id
          },
          update: {
            description: bug.description,
            severity: inferSeverity(bug.description) as Severity,
            commitSha: bug.commitSha ?? undefined,
            confidence: bug.confidence,
            pullRequestId: saved.id
          }
        });
      }
    }

    for (const commit of commits) {
      await this.db.commit.upsert({
        where: { repositoryId_sha: { repositoryId: repository.id, sha: commit.sha } },
        create: {
          repositoryId: repository.id,
          sha: commit.sha,
          message: commit.commit.message,
          authorName: commit.commit.author?.name,
          authorEmail: commit.commit.author?.email,
          committedAt: commit.commit.author?.date ? new Date(commit.commit.author.date) : null,
          url: commit.html_url
        },
        update: {
          message: commit.commit.message,
          authorName: commit.commit.author?.name,
          authorEmail: commit.commit.author?.email,
          committedAt: commit.commit.author?.date ? new Date(commit.commit.author.date) : null,
          url: commit.html_url
        }
      });
      const bug = bugCandidateFromCommit(commit);
      if (bug) {
        await this.db.bug.upsert({
          where: { fixedInVersion_title_sourceUrl: { fixedInVersion: latestVersion, title: bug.title, sourceUrl: bug.sourceUrl } },
          create: {
            externalId: bug.externalId,
            title: bug.title,
            description: bug.description,
            severity: inferSeverity(bug.description) as Severity,
            fixedInVersion: latestVersion,
            commitSha: bug.commitSha,
            sourceUrl: bug.sourceUrl,
            confidence: bug.confidence
          },
          update: {
            description: bug.description,
            severity: inferSeverity(bug.description) as Severity,
            commitSha: bug.commitSha,
            confidence: bug.confidence
          }
        });
      }
    }

    return { recordsSeen: releases.length + tags.length + prs.length + commits.length, recordsUpserted };
  }

  async syncDocsSource(source = this.config.docs[0]): Promise<{ recordsSeen: number; recordsUpserted: number }> {
    const result = await this.docs.scrape(source);
    let recordsUpserted = 0;
    for (const evidence of result.evidence) {
      await this.db.sourceEvidence.upsert({
        where: { sourceUrl_checksum: { sourceUrl: result.sourceUrl, checksum: evidence.checksum } },
        create: {
          sourceKind: "docs",
          sourceUrl: result.sourceUrl,
          selector: evidence.selector,
          rawText: evidence.rawText,
          checksum: evidence.checksum
        },
        update: { rawText: evidence.rawText, selector: evidence.selector }
      });
      recordsUpserted++;
    }
    for (const edge of result.edges) {
      await this.db.compatibilityEdge.upsert({
        where: {
          sourceVersion_targetKind_targetVersion: {
            sourceVersion: edge.sourceVersion,
            targetKind: edge.targetKind,
            targetVersion: edge.targetVersion
          }
        },
        create: {
          sourceVersion: edge.sourceVersion,
          targetKind: edge.targetKind,
          targetVersion: edge.targetVersion,
          status: edge.status as CompatibilityStatus,
          confidence: edge.confidence,
          sourceUrl: result.sourceUrl,
          evidenceText: edge.evidenceText
        },
        update: {
          status: edge.status as CompatibilityStatus,
          confidence: edge.confidence,
          sourceUrl: result.sourceUrl,
          evidenceText: edge.evidenceText
        }
      });
      recordsUpserted++;
    }
    return { recordsSeen: result.edges.length + result.evidence.length, recordsUpserted };
  }

  private async syncVerifyScript(source: GithubSource, tag: string, version: string): Promise<void> {
    const url = `https://raw.githubusercontent.com/${source.owner}/${source.repo}/${tag}/dell-csi-helm-installer/verify-csi-vxflexos.sh`;
    try {
      const res = await fetch(url);
      if (!res.ok) return;
      const script = await res.text();
      const { kubernetes, openshift } = parseVerifyScript(script);
      for (const k8sVersion of kubernetes) {
        await this.db.compatibilityEdge.upsert({
          where: { sourceVersion_targetKind_targetVersion: { sourceVersion: version, targetKind: "kubernetes", targetVersion: k8sVersion } },
          create: { sourceVersion: version, targetKind: "kubernetes", targetVersion: k8sVersion, status: "supported", confidence: 0.98, sourceUrl: url, evidenceText: `K8s ${k8sVersion} from verify script at ${tag}` },
          update: { status: "supported", confidence: 0.98, sourceUrl: url }
        });
      }
      for (const ocpVersion of openshift) {
        await this.db.compatibilityEdge.upsert({
          where: { sourceVersion_targetKind_targetVersion: { sourceVersion: version, targetKind: "openshift", targetVersion: ocpVersion } },
          create: { sourceVersion: version, targetKind: "openshift", targetVersion: ocpVersion, status: "supported", confidence: 0.98, sourceUrl: url, evidenceText: `OCP ${ocpVersion} from verify script at ${tag}` },
          update: { status: "supported", confidence: 0.98, sourceUrl: url }
        });
      }
    } catch {
      // Non-fatal: verify script may not exist for older tags
    }
  }

  private async ensureProductAndRepository(source: GithubSource) {
    const vendor = await this.db.vendor.upsert({
      where: { name: this.config.vendor },
      create: { name: this.config.vendor },
      update: {}
    });
    const product = await this.db.product.upsert({
      where: { slug: source.productSlug },
      create: {
        vendorId: vendor.id,
        name: source.productName,
        slug: source.productSlug,
        kind: source.productKind
      },
      update: {
        name: source.productName,
        kind: source.productKind
      }
    });
    const repository = await this.db.repository.upsert({
      where: { owner_name: { owner: source.owner, name: source.repo } },
      create: {
        productId: product.id,
        owner: source.owner,
        name: source.repo,
        url: `https://github.com/${source.owner}/${source.repo}`,
        sourceKind: source.legacy ? "legacy" : "github"
      },
      update: {
        productId: product.id,
        sourceKind: source.legacy ? "legacy" : "github"
      }
    });
    return { vendor, product, repository };
  }

  private async upsertRelease(productId: string, repositoryId: string, release: GithubRelease) {
    const version = stripV(release.tag_name);
    const normalized = normalizeVersion(release.tag_name);
    return this.db.release.upsert({
      where: { productId_version: { productId, version } },
      create: {
        productId,
        repositoryId,
        version,
        normalized,
        title: release.name,
        body: release.body,
        url: release.html_url,
        tagName: release.tag_name,
        commitSha: release.target_commitish,
        releaseDate: new Date(release.published_at ?? release.created_at),
        isPrerelease: release.prerelease,
        isDraft: release.draft,
        artifacts: {
          create: release.assets.map((asset) => ({
            name: asset.name,
            url: asset.browser_download_url,
            contentType: asset.content_type,
            sizeBytes: asset.size
          }))
        }
      },
      update: {
        title: release.name,
        body: release.body,
        url: release.html_url,
        tagName: release.tag_name,
        commitSha: release.target_commitish,
        isPrerelease: release.prerelease,
        isDraft: release.draft
      }
    });
  }
}
