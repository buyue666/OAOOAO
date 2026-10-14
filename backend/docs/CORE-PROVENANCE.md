# Foundation implementation provenance

This module was written independently in the new repository from its AGENTS.md,
SPECIFICATION.md and the allowed OAOOAO frontend request/response contracts.
No archived derivative backend or restricted third-party server implementation
was read, copied, translated or refactored by this implementer.

Frontend contracts consulted only for interoperability:

- OAOOAO frontend repository / lib/studio/api.ts
- OAOOAO frontend repository / lib/studio/account-api.ts
- OAOOAO frontend repository / lib/studio/admin-api.ts
- OAOOAO frontend repository / lib/studio/admin-types.ts
- OAOOAO frontend repository / lib/studio/commerce-policy.ts (policy field and status contract only)

The 2026-10-14 policy compatibility repair independently maps the administrator's
flat `commercePolicy` PATCH field into canonical `site.commercePolicy`, and reads
that same canonical value back as the editor alias. Settings and purchases share
one local resolver. This used only this independent backend and the allowed
frontend field contract; no upstream server implementation was consulted.
Synthetic tests cover draft, publication, withdrawal, conflicting locations and
commerce/system permission separation without sending payments.

The coordinator subsequently authorized a focused, read-only frontend routing and
render-contract check. It inspected project page routing, admin overview display,
handoff association, local task placeholders and media-key parsing in:

- `app/projects/[projectId]/page.tsx`, `app/projects/[projectId]/[section]/page.tsx`
  and `app/canvas/[projectId]/page.tsx`.
- `components/studio/admin-overview.tsx`, `topbar.tsx` and the client creative
  project components (routing and ID references only).
- `lib/studio/admin-overview.ts`, `drama-link.ts`, `use-drama-project.ts`,
  `creative-project.ts`, `generation-store.tsx` and `reference-selection.ts`.

This supplied observable client requirements such as the `drama-` route prefix,
explicit source-handoff associations and Asia/Shanghai daily metric dates. No old
server file mentioned by a frontend comment was opened or reused.

Official documentation consulted on 2026-10-14:

- https://fastify.dev/docs/latest/ — route/plugin lifecycle and Fastify application setup.
- https://node-postgres.com/features/transactions — one connection per transaction.
- https://github.com/dcodeIO/bcrypt.js/ — bcrypt hashing and UTF-8 input length limit.
- https://nodemailer.com/smtp — SMTP transport, TLS and certificate hostname handling.
- https://docs.aws.amazon.com/AmazonS3/latest/API/API_HeadBucket.html — bucket-access verification.
- https://nodejs.org/api/crypto.html — standard PBKDF2-HMAC-SHA256 and timingSafeEqual APIs.
- Official npm registry metadata for all installed packages; package-lock.json pins versions.
- https://hub.docker.com/_/node/ — official Node 22 Bookworm slim image variant.
- https://packages.debian.org/bookworm/ffmpeg and
  https://packages.debian.org/bookworm/fonts-noto-cjk — packaged runtime dependencies.
- https://ffmpeg.org/legal.html — FFmpeg component license distinctions; the Debian
  CLI is not described as a wholly permissive dependency.

Primary dependencies: Fastify and pg (MIT), bcryptjs (BSD-3-Clause), Nodemailer
(MIT-0), AWS S3 SDK (Apache-2.0), ipaddr.js (MIT), Fastify cookie/multipart (MIT).
Development tooling TypeScript (Apache-2.0), tsx and type definitions (MIT).
The application was initially private and marked UNLICENSED. The owner later
authorized publication under AGPL-3.0-only; the root LICENSE governs the current
release. Retain all third-party package license notices with distributions.

Core operational boundaries:

- Password import compatibility includes bcrypt and `pbkdf2_sha256$iterations$salt$digest`.
  The migration coordinator supplied the format: salt is its literal UTF-8 field,
  digest is a 32-byte PBKDF2-HMAC-SHA256 result encoded as unpadded base64url, and
  existing records use 210000 iterations. This implementation follows Node's public
  crypto APIs and was tested with newly generated synthetic vectors. No legacy
  password-verifier implementation was consulted. Stored hashes are not rewritten
  during sign-in. New passwords use bcrypt with an explicit 72-byte limit.

- SMTP acceptance is a real send through the configured server, with TLS required.
- Storage test performs actual S3 HeadBucket. It reports writeVerified=false.
- Model discovery implements an OpenAI-compatible /models catalog. Unsupported
  protocols return an explicit unavailable response.
- WeChat login was unavailable in the initial core version. The subsequent independently implemented Official Account integration is documented in [WECHAT-PROVENANCE.md](WECHAT-PROVENANCE.md); its default remains disabled until real configuration and acceptance.
- No MFA accounts were required by the normalized source inventory. TOTP enrollment
  and verification are not implemented; do not import MFA-enabled accounts as enabled
  until a compatible verifier has been implemented and tested.
- Launch readiness recognizes a committed initial-transfer record, which the importer
  writes atomically with field-level account, balance, project and history reconciliation.
  It does not certify subsequent live changes or external payment acceptance; payment
  acceptance remains an explicit error for paid/production profiles.
- Forwarded client IPs are ignored by default. TRUSTED_PROXY_CIDRS accepts only explicit
  IP addresses or bounded CIDRs; configure the actual trusted proxy and have that proxy
  overwrite client-supplied forwarding headers before enabling forwarded-IP rate limits.
- Tests use a unique disposable PostgreSQL schema and synthetic accounts. They do not
  send mail, call model providers, process payments or use production user data.

This is implementation provenance, not a formal clean-room certification or legal
opinion. The coordinating audit had previous upstream exposure.

## Announcement banner appearance, 2026-10-14

The coordinator supplied an owner-requested contract for managed announcements:
`bannerTone` accepts `promo`, `info`, `warning`, `violet`, `rose`, or `slate`;
`bannerEffect` accepts `none`, `glow`, or `shimmer`. Missing fields retain the
compatible `promo` / `glow` defaults. The optional settings fallback uses `tone`
and `effect` with the same allowed values. Inputs consulted for this amendment
were this independent repository, the owner's requested appearance choices, and
the existing frontend API type/call contracts in `lib/studio/admin-types.ts` and
`lib/studio/admin-api.ts`. No upstream server, proprietary asset, or dependency
implementation was read or reused.

Migration `007-announcement-banner-style.sql` adds two constrained text columns;
it does not alter content, display flags, time windows, or creation/update times.
Tests use only disposable schemas in the isolated synthetic PostgreSQL database
and cover previous-schema upgrade, constraints, API persistence/defaults,
partial saves, permission separation, invalid choices, and expired notices.

## Announcement navigation target, 2026-10-14

The owner requested a configurable announcement button destination. The coordinator
specified optional `actionUrl`: a site-relative path or a complete HTTP/HTTPS URL,
trimmed and limited to 2048 characters, with no network-relative paths, backslashes,
control characters, or URL user information. Empty strings and null remove the link;
an omitted PATCH field keeps it. This amendment used this independent repository,
the coordinator's requirements, and the frontend API types in
`lib/studio/admin-types.ts` for interoperability. No restricted server code,
third-party implementation, or proprietary asset was consulted or reused.

Migration `008-announcement-action-url.sql` adds a nullable text column with a
length constraint; existing content, style, dates, and previous migrations remain
unchanged. The implementation validates without fetching the configured URL.
Tests use disposable schemas and synthetic accounts in the isolated PostgreSQL
database, covering upgrade preservation, old INSERT compatibility, URL validation,
API/database persistence, omission versus clearing, authorization, audit continuity,
and expired announcements remaining hidden.

## Account export label, footer settings and check-in integration, 2026-10-14

The owner commissioned an account-level, default-on AI export label with an
acknowledged opt-out. Sources used were this independent repository, the owner's
requirements, and the OAOOAO frontend API field contracts under `lib/studio`.
The coordinator supplied the current `ai-watermark-v1` acknowledgement contract
and the six-month opt-out evidence requirement from Article 9 of the official
CAC publication: https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm . This is
an implementation record, not a certification of regulatory compliance.
No restricted upstream implementation or proprietary asset was consulted.

`010-account-watermark.sql` adds preferences and a dedicated evidence table.
Absent preferences and outdated acknowledgements are treated as enabled. Disabled
preferences and generated-media exports without our visible label are recorded
with user, media, policy version and time; the minimum retention date is six
calendar months and is independent of ordinary audit-log cleanup. No historical
file or user balance is rewritten. Existing migrations remain unchanged.

The exporter uses the already-distributed FFmpeg/FFprobe executables. It only
operates on an authenticated owner's local media and establishes AI provenance
from successful server jobs or trusted imported history. Rendering is traced
through its source shots, so editing ordinary uploaded clips does not classify
them as AI-generated. Ordinary uploads and acknowledged opt-out exports retain
their exact original bytes. Enabled image/video exports create a disposable
derivative with a separate AI label strip; source pixels are not intentionally
covered or cropped, but output dimensions increase. Signed C2PA/JUMBF content,
unsupported formats, insufficient dimensions and unavailable encoders fail
explicitly instead of returning an unlabeled success.

PNG text/EXIF/ICC chunks, JPEG application metadata, and WebP EXIF/XMP/ICC chunks
are retained where supported; EXIF display orientation is normalized after the
corresponding pixel transform. Video metadata is mapped by FFmpeg, and original
files are always retained. Re-encoding cannot promise preservation of every
provider's undocumented steganographic mark or every container metadata field.
The implementation does not deliberately remove an upstream visible watermark
or an AI provenance marker. Unsupported signed provenance remains in the source
file and is rejected for modified export.

Synthetic PostgreSQL and actual FFmpeg tests verify account isolation, required
version acknowledgement, log retention constraints and transactional rollback,
real label pixels, original PNG pixels and source bytes, video audio/duration and
upstream comment metadata, orientation, minimum dimensions, source attribution,
and honest failures. Tests do not use production accounts or media.

`site.footer` follows the frontend's bounded plain-text/link contract and exposes
only normalized public settings. The retired `site.announcementBar` is omitted
from reads and rejected on writes. The independent check-in module's settings
and routes are registered with its own `commerce.manage` validation; its schema
and transactional tests are documented in the check-in module's provenance.

## 2026-10-14 — independently implemented check-in credit batches

Sources were the owner's task and the independent repository's wallet,
check-in, settings, commerce and worker contracts. The frontend collaborator
confirmed the response names for effective reward rules, claimed snapshots,
timed balance and ledger breakdown. No restricted third-party server
implementation, templates or private assets were consulted or copied.

Migration 012 adds batch/allocation storage and default-zero ledger columns,
plus claim validity and matched-rule snapshots. It does not alter migrations
001 through 011, historical claim dates/rewards, account balances or imported
economic history. Decimal arithmetic, transaction participation, user locking,
and unique operation/refund keys extend the existing independent wallet.

Expiry is based on a server instant captured after account locking. Each batch
keeps its own remaining amount and original expiry; spending uses earliest
expiry before permanent credit. Refunding a confirmed failed task restores
only unexpired original allocations and records any expired portion without
renewing it. Plan eligibility shares the independent plan summary's active
assignment/purchase semantics and excludes historical labels. Claims preserve
their actual reward rule even after configuration/plan changes.

Tests use disposable synthetic PostgreSQL schemas, including additive migration
and old-SQL compatibility, exact expiry boundaries, concurrent claims/spends,
mixed-bucket refunds, failure rollback, plan selection and lock timing, HTTP
permissions, real total/ledger fields and preservation of permanent imports.
Post-adoption rollback to pre-batch wallet code is explicitly prohibited in
SPECIFICATION.md because old refunds cannot interpret the new allocations.
