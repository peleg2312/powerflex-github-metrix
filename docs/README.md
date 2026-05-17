# PowerFlex CSI/CSM Version Intelligence

## Architecture

This repository is a TypeScript monorepo:

- `apps/api`: NestJS REST API with GitHub webhook verification.
- `apps/worker`: BullMQ worker that performs startup sync, scheduled polling, and webhook-triggered sync fallback.
- `apps/web`: Vite React dashboard with timeline, matrix, bug tracker, recommender, and upgrade path views.
- `packages/ingestion`: GitHub and Dell docs adapters, bug extraction, compatibility graph building, and scoring.
- `packages/db`: Prisma schema and migrations for PostgreSQL.
- `packages/shared-schema`: Zod DTOs and shared frontend/backend types.

The active product axis is Dell CSM Operator. PowerFlex CSI driver versions are discovered from `dell/csi-powerflex`; the archived `dell/dell-csi-operator` repository is ingested as legacy evidence only.

## Local Run

```bash
cp .env.example .env
docker-compose up --build
```

Open:

- API: `http://localhost:3000/health`
- UI: `http://localhost:5173`

The worker starts one sync at boot and repeats every `SYNC_INTERVAL_MINUTES` minutes. Add `GITHUB_TOKEN` to avoid low unauthenticated GitHub API rate limits.

## Developer Mode

```bash
npm install
npm run db:generate
npm run db:dev
npm run dev
```

Run a one-time ingestion:

```bash
npm run sync:once
```

Run tests:

```bash
npm test
```

## API

- `GET /versions`: normalized version projection with bug fixes, known issues, support signals, risk score, and confidence.
- `GET /compatibility`: raw compatibility graph edges.
- `GET /matrix`: compact matrix rows for UI tables.
- `GET /bugs`: searchable bug fixes from releases, PRs, and commits.
- `GET /bugs/:version`: bug fixes for one operator version.
- `GET /recommendations`: ranked stable version candidates.
- `GET /upgrade-path?from=vA&to=vB`: safest known intermediate path.
- `POST /webhooks/github`: GitHub webhook endpoint with `X-Hub-Signature-256` validation.

Common filters: `q`, `operatorVersion`, `csiDriverVersion`, `kubernetes`, `openshift`, `powerflexBackend`, `severity`, `source`, `from`, `to`.

## Data Rules

- No hardcoded version lists or manual compatibility tables.
- Source definitions are configuration; releases and compatibility rows are discovered dynamically.
- Compatibility is stored as graph edges with `supported`, `unsupported`, `inferred`, or `unknown` status.
- Missing source data is persisted as `unknown` and rendered without breaking the UI.
- Bug fixes are sourced from GitHub release notes, closed PRs, and commit messages, with source URLs and confidence scores.

## Remote Deployment

Set these environment variables in the target platform:

```bash
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
GITHUB_TOKEN=...
GITHUB_WEBHOOK_SECRET=...
API_BASE_URL=https://api.example.com
VITE_API_BASE_URL=https://api.example.com
SYNC_INTERVAL_MINUTES=15
SOURCE_CONFIG_PATH=
```

Deploy API and worker as separate processes. Run `npm run db:migrate` before starting API/worker. Point GitHub webhooks for release, push, pull request, and tag events to `/webhooks/github`.

## Extending Sources

Add a new vendor/product by extending `defaultSourceConfig` in `packages/ingestion/src/config.ts` or by pointing `SOURCE_CONFIG_PATH` at a JSON file with the same shape. The database schema already separates vendors, products, repositories, releases, evidence, and compatibility edges so additional Dell CSI drivers or future vendors can reuse the same ingestion pipeline.
