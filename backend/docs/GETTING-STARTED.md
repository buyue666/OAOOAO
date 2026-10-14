# Runtime and deployment reference

## Runtime

- Node.js 22 or newer; the container uses the official Node 22 Bookworm slim image.
- PostgreSQL with a dedicated application database and account. Schema migrations
  use ordinary tables, transactions and advisory locks; no extension is required.
- Durable writable media storage at `MEDIA_ROOT`, plus writable temporary storage
  for rendering. Database backups alone do not preserve media files.
- FFmpeg, FFprobe, the subtitles filter, H.264/AAC encoders and CJK fonts for
  rendering. The container installs Debian FFmpeg and Noto CJK fonts.

The container runs as the `node` user, listens on port 3001 and contains only
production npm dependencies, compiled application/transfer code and migration SQL.
`npm run build` copies SQL into `dist/migrations`; the compiled migration command
can therefore run without the source `migrations/` directory.

## Environment

Copy `.env.example` to a private `.env` file for local development. Environment
files are not loaded automatically: use Node's `--env-file` option, a container
environment file, or the deployment secret manager. Keep completed files out of
source control and the image build context.

| Variable | Meaning |
| --- | --- |
| `DATABASE_URL` | Required PostgreSQL connection URL. Use a dedicated destination database. |
| `ENCRYPTION_KEY` | Required base64 encoding of 32 random bytes; protects stored integration secrets and verification/link tokens. Preserve it with protected backups. |
| `NODE_ENV` | Set `production` for secure cookies and HTTPS enforcement. |
| `PUBLIC_ORIGIN` | Browser-facing origin only, such as `https://app.example.com`; HTTPS is required in production. |
| `ALLOWED_ORIGINS` | Additional comma-separated trusted request origins. The public origin is already included. A frontend proxy that substitutes its backend target origin requires that exact internal origin here. |
| `TRUSTED_PROXY_CIDRS` | Optional comma-separated explicit proxy IPs/CIDRs. Empty means forwarded client IPs are ignored. Never trust an unfiltered public forwarding chain. |
| `HOST` / `PORT` | Defaults `127.0.0.1` / `3001` outside Docker; the image binds `0.0.0.0:3001` internally. |
| `MEDIA_ROOT` | Defaults `./media`; the image uses `/app/media`. Mount persistent storage writable by container UID/GID 1000. |
| `WORKER_ENABLED` | Default `true`; set exactly `false` during imports and candidate inspection. The worker also runs commerce maintenance. |
| `FFMPEG_PATH` / `FFPROBE_PATH` | Optional executable paths; otherwise commands are located on `PATH`. |
| `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD` | Used only by the explicit initial-administrator command. Remove them afterward. |
| `TEST_DATABASE_URL` | Disposable PostgreSQL destination for automated integration tests; never point it at production. |

Generate the encryption key once and store the output in the secret manager:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Changing the key without re-encrypting stored secrets makes those integrations
unreadable and invalidates issued verification/link tokens.

## Local setup

Clone the shared application repository and enter its backend directory:

```sh
git clone https://github.com/buyue666/OAOOAO.git
cd OAOOAO/backend
```

The frontend lives at the repository root; see the [project README](../../README.md).
All backend commands below run from `backend/`, with its own dependency lockfile
and runtime. After configuring a private `.env` file and an empty development database:

```sh
npm ci
npm run typecheck
npm run build
node --env-file=.env dist/src/migrate.js
node --env-file=.env dist/src/server.js
```

For source development, use `node --env-file=.env --import tsx src/server.ts`.
For a brand-new installation with no imported administrator, inject the bootstrap
variables and run `node --env-file=.env dist/src/bootstrap.js`. The command refuses
to create another initial administrator when an active administrator exists.
Do not bootstrap before an initial data transfer: transfer requires empty
destination application tables.

Run `npm test` with `TEST_DATABASE_URL` injected. The development-only fallback
is `.private/test-db.json`; tests create unique disposable schemas and remove only
their own schema and temporary media directory. Tests use synthetic accounts and
provider responses, not live mail, payment or model calls. Rendering tests require
working FFmpeg/FFprobe. A passing suite does not certify external integrations.

## Container packaging

```sh
docker build --pull -t oaooao-backend:reviewed .
```

For release, resolve and record an approved digest for `node:22-bookworm-slim` and
pass it using `--build-arg NODE_IMAGE=node:22-bookworm-slim@sha256:...`. Record the
resulting application image digest as well. `.dockerignore` allowlists build inputs
and excludes private files, environment files, test customer material, media,
database backups and local test fixtures. No secrets belong in build arguments.

Run schema migration as a separate, reviewed one-shot command against the intended
destination before starting the API. These examples assume an already provisioned
private Docker network and private environment file:

The container environment must set `NODE_ENV=production`, an HTTPS
`PUBLIC_ORIGIN`, `HOST=0.0.0.0` and `MEDIA_ROOT=/app/media`. The local development
template's host and media path should not override these container values.

```sh
docker run --rm --network oaooao-private --env-file /secure/candidate.env oaooao-backend:reviewed node dist/src/migrate.js
docker run --name oaooao-backend --init --network oaooao-private --env-file /secure/candidate.env --mount type=volume,src=oaooao-media,dst=/app/media -p 127.0.0.1:3001:3001 oaooao-backend:reviewed
```

Set `WORKER_ENABLED=false` in the candidate environment until its acceptance gate
is complete. Keep the backend on a private network or loopback publication behind
the approved frontend/reverse proxy. The image does not migrate automatically on
startup. `/health` and `/api/health/live` check the process; `/ready` and
`/api/health/ready` check the complete packaged migration/checksum manifest and
core table access. Missing, partial or mismatched schema returns HTTP 503. Neither
endpoint proves provider, payment, email or migration acceptance.

## Functional boundaries

[Client API coverage](CLIENT-API-COVERAGE.md) lists the reviewed routes.
Opaque sessions, granular administration, wallets/orders, projects/history,
durable generation/Agent jobs and moderation metadata use PostgreSQL persistence.
External operations run only through implemented, configured adapters.

EPay V1/V2 and WeChat Official Account login are implemented but require real credentials,
provider permissions and live acceptance; their default configuration is disabled.
Currently unavailable capabilities include MFA enrollment/verification,
Alipay/WeChat Pay/Stripe execution, custom executable Agent skills, vision chat,
non-OpenAI generation protocols, creative object-storage persistence and Jianying
export. The S3 configuration test performs a real `HeadBucket`, not a write test.
Enabling object storage blocks unsupported creative media operations before charge.
Manual payment/refund records require verified external action and are not money
transfers. Manual refunds reserve purchased credits and settled referral rewards
before reimbursement, then require the reservation ID and explicit confirmation
to finish. Cancellation requires confirmation that no reimbursement was sent;
reservations do not expire automatically. Internal work ingestion helpers do not
imply a public author submission flow. The public gallery exposes only server-approved
published versions; it is documented in [PUBLIC-GALLERY-PROVENANCE.md](PUBLIC-GALLERY-PROVENANCE.md).

Follow [the deployment and rollback procedure](DEPLOYMENT.md) before any
production cutover. Source records and balances must be reconciled; an existing
plan label must never trigger an additional conversion into permanent credits.

## Third-party notices

The AGPL-3.0 application license does not replace third-party licenses. Retain
[dependency notices](../THIRD_PARTY_DEPENDENCY_NOTICES.txt), package license files and
the operating-system copyright files in the image. Debian's FFmpeg build contains
GPL components and runs as a separate CLI process. Do not describe the entire
container or all runtime dependencies as permissively licensed. Container/image
redistribution requires reviewing the actual included package licenses and their
source/notice obligations.

Packaging references: [official Node image](https://hub.docker.com/_/node/),
[Debian FFmpeg](https://packages.debian.org/bookworm/ffmpeg),
[Debian Noto CJK fonts](https://packages.debian.org/bookworm/fonts-noto-cjk) and
[FFmpeg licensing information](https://ffmpeg.org/legal.html).
