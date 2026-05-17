CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE "SourceKind" AS ENUM ('github', 'docs', 'legacy');
CREATE TYPE "CompatibilityStatus" AS ENUM ('supported', 'unsupported', 'inferred', 'unknown');
CREATE TYPE "Severity" AS ENUM ('critical', 'high', 'medium', 'low', 'unknown');
CREATE TYPE "SyncStatus" AS ENUM ('running', 'success', 'failed');

CREATE TABLE "Vendor" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "name" TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Product" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "vendorId" TEXT NOT NULL REFERENCES "Vendor"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL UNIQUE,
  "kind" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "Repository" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "productId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "owner" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "url" TEXT NOT NULL UNIQUE,
  "sourceKind" "SourceKind" NOT NULL DEFAULT 'github',
  "primaryBranch" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("owner", "name")
);

CREATE TABLE "Release" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "productId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "repositoryId" TEXT REFERENCES "Repository"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "version" TEXT NOT NULL,
  "normalized" TEXT NOT NULL,
  "title" TEXT,
  "body" TEXT,
  "url" TEXT,
  "tagName" TEXT NOT NULL,
  "commitSha" TEXT,
  "releaseDate" TIMESTAMP(3) NOT NULL,
  "isPrerelease" BOOLEAN NOT NULL DEFAULT false,
  "isDraft" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("productId", "version")
);

CREATE TABLE "ReleaseArtifact" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "releaseId" TEXT NOT NULL REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "name" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "contentType" TEXT,
  "sizeBytes" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "CompatibilityEdge" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "sourceProductId" TEXT,
  "sourceVersion" TEXT NOT NULL,
  "targetKind" TEXT NOT NULL,
  "targetVersion" TEXT NOT NULL,
  "status" "CompatibilityStatus" NOT NULL DEFAULT 'unknown',
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "sourceUrl" TEXT,
  "evidenceText" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("sourceVersion", "targetKind", "targetVersion")
);

CREATE TABLE "PullRequest" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "repositoryId" TEXT NOT NULL REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "number" INTEGER NOT NULL,
  "title" TEXT NOT NULL,
  "body" TEXT,
  "state" TEXT NOT NULL,
  "mergedAt" TIMESTAMP(3),
  "mergeCommit" TEXT,
  "url" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("repositoryId", "number")
);

CREATE TABLE "Bug" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "externalId" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "severity" "Severity" NOT NULL DEFAULT 'unknown',
  "fixedInVersion" TEXT NOT NULL,
  "commitSha" TEXT,
  "sourceUrl" TEXT,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "releaseId" TEXT REFERENCES "Release"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "pullRequestId" TEXT REFERENCES "PullRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("fixedInVersion", "title", "sourceUrl")
);

CREATE TABLE "KnownIssue" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "releaseId" TEXT REFERENCES "Release"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "version" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "workaround" TEXT,
  "sourceUrl" TEXT,
  "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("version", "description")
);

CREATE TABLE "Commit" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "repositoryId" TEXT NOT NULL REFERENCES "Repository"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "sha" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "authorName" TEXT,
  "authorEmail" TEXT,
  "committedAt" TIMESTAMP(3),
  "url" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("repositoryId", "sha")
);

CREATE TABLE "SourceEvidence" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "sourceKind" "SourceKind" NOT NULL,
  "sourceUrl" TEXT NOT NULL,
  "selector" TEXT,
  "rawText" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  "releaseId" TEXT REFERENCES "Release"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("sourceUrl", "checksum")
);

CREATE TABLE "SyncRun" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "source" TEXT NOT NULL,
  "status" "SyncStatus" NOT NULL DEFAULT 'running',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "message" TEXT,
  "recordsSeen" INTEGER NOT NULL DEFAULT 0,
  "recordsUpserted" INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX "Product_vendorId_idx" ON "Product"("vendorId");
CREATE INDEX "Repository_productId_idx" ON "Repository"("productId");
CREATE INDEX "Release_repositoryId_idx" ON "Release"("repositoryId");
CREATE INDEX "Release_releaseDate_idx" ON "Release"("releaseDate");
CREATE INDEX "CompatibilityEdge_targetKind_targetVersion_idx" ON "CompatibilityEdge"("targetKind", "targetVersion");
CREATE INDEX "Bug_fixedInVersion_idx" ON "Bug"("fixedInVersion");
CREATE INDEX "Bug_severity_idx" ON "Bug"("severity");
CREATE INDEX "KnownIssue_version_idx" ON "KnownIssue"("version");
CREATE INDEX "Commit_committedAt_idx" ON "Commit"("committedAt");
CREATE INDEX "PullRequest_mergedAt_idx" ON "PullRequest"("mergedAt");
CREATE INDEX "SourceEvidence_sourceKind_idx" ON "SourceEvidence"("sourceKind");

CREATE INDEX "Bug_search_idx" ON "Bug" USING gin (
  to_tsvector('english', coalesce("title", '') || ' ' || coalesce("description", '') || ' ' || coalesce("externalId", ''))
);
CREATE INDEX "Release_search_idx" ON "Release" USING gin (
  to_tsvector('english', coalesce("title", '') || ' ' || coalesce("body", '') || ' ' || coalesce("version", ''))
);
CREATE INDEX "PullRequest_search_idx" ON "PullRequest" USING gin (
  to_tsvector('english', coalesce("title", '') || ' ' || coalesce("body", ''))
);
CREATE INDEX "Commit_search_idx" ON "Commit" USING gin (
  to_tsvector('english', coalesce("message", ''))
);
