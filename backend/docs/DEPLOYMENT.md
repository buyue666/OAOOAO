# Controlled deployment, transfer and rollback

This is an operator procedure. Application source is available under AGPL-3.0-only;
keep credentials, customer records, normalized transfer data and operational
backups private. Publish only reviewed source and sanitized documentation.
The public source must correspond to the running frontend and backend revisions;
retain an accessible source link and all third-party notices. Distribution of
images/binaries also requires satisfying their included dependencies' licenses.
A production switch needs an authorized, reviewed candidate, reconciliation
evidence and a rollback plan. This document does not itself modify production.

## 1. Prepare an isolated candidate

Clone the shared repository at the approved revision, then work from `backend/`:

```sh
git clone https://github.com/buyue666/OAOOAO.git
cd OAOOAO
git checkout <reviewed-commit>
cd backend
```

The [frontend deployment procedure](../../DEPLOYMENT.md) belongs to the same
source commit. Frontend and backend retain separate dependencies, build contexts
and processes; build this backend with `backend/` as its Docker context. Do not
include the repository's Git history, private files or application data in images.

1. Select and record the reviewed source revision, npm lockfile, approved Node image
   digest, completed test results and final application image digest. Retain all
   application/dependency notices and Debian package copyright files. The image's
   FFmpeg CLI includes GPL components; packaging is not a claim of an entirely
   permissive runtime.
2. Provision a dedicated candidate PostgreSQL database, private network, persistent
   media volume and protected environment file/secret entries. Keep access separate
   from the source system. Give the normal runtime account only its required
   application database access; use the authorized migration account for DDL if
   operational roles are separated.
3. Set `NODE_ENV=production`, the real HTTPS `PUBLIC_ORIGIN`, durable `MEDIA_ROOT`
   and the candidate's 32-byte `ENCRYPTION_KEY`. Inside this container use
   `HOST=0.0.0.0` and `MEDIA_ROOT=/app/media`; restrict exposure at the host/network.
   Set `WORKER_ENABLED=false` and
   restrict candidate access to the acceptance team. This flag stops the background
   worker, not HTTP writes: network isolation is still required during verification.
4. Preserve the key outside the image alongside protected database/media backups.
   Encrypt normalized integration secrets for this candidate key. The importer
   inserts normalized values; it does not convert plaintext provider passwords
   into ciphertext for you.
5. Verify a restore of the source database and separately inventory historical
   media files/URLs. The JSON transfer copies database records and archive data,
   not media file bytes. Retain the original media store or perform a separately
   verified copy and URL mapping. Test representative historical image/video/audio
   reads before authorizing a switch.

## 2. Rehearse migration and reconciliation

Run every database command against the explicitly selected candidate. Confirm the
host/database identity without printing credentials. Take the candidate offline
from ordinary users and workers during the initial transfer.

From a compiled checkout with a private environment file:

```sh
node --env-file=/secure/candidate.env dist/src/migrate.js
node --env-file=/secure/candidate.env dist/scripts/transfer.js import /private/normalized-transfer.json
node --env-file=/secure/candidate.env dist/scripts/transfer.js verify /private/normalized-transfer.json
```

In a container, use the same compiled commands, inject the candidate environment,
and mount the private normalized file read-only. Never copy that file into the
image or place it in build context. Do not run the bootstrap-administrator command
before transferring existing users.

The importer accepts an explicit table/column allowlist and requires fresh
destination application tables. One transaction inserts the records, private
archive and transfer marker, then reconciles every supplied field before commit.
It preserves manifest identity/digests and prevents a replay from granting credits
again. Timestamp values are normalized to milliseconds for the project save
contract; their original archive documents remain unchanged. A failed import must
leave no partial transfer marker or partial data.

Record the verified counts, exact permanent/daily credit totals, historical ledger
and financial totals, preserved account IDs/password formats, projects/history,
archive completeness and any deliberately unavailable capabilities. Keep private
data out of public logs/reports. Preserve historical plan labels and original
conversion evidence; never create new grants solely from a legacy plan label.
Conflicting plan products must remain blocked until entitlements are explicitly
configured. Do not silently alter prices or enable a previously disabled feature.

The transfer marker used by launch readiness certifies the atomic initial import.
It does not certify changes made after that import. Run standalone verification
before candidate users or workers mutate the transferred baseline; a later balance
or project change is expected to make a baseline comparison differ.

## 3. Accept the candidate end to end

- Run typechecking, build and the complete isolated PostgreSQL tests. Verify the
  built image contains `dist/migrations/*.sql`, starts as the non-root `node` user,
  and can write its media volume and temporary directory.
- Check FFmpeg/FFprobe, `libx264`, AAC, the subtitles filter and Chinese caption
  rendering using synthetic owned clips. Verify source audio, voiceover and mute
  behavior, output duration and actual playable bytes.
- Exercise browser login for each supported imported password format, granular
  admin denial, public session secret masking, profile changes and session
  revocation. Expect users to sign in again; old bearer/session tokens are not
  transferred into the new opaque-session store.
- Exercise project reads and optimistic saves, including an imported timestamp,
  historical ledger/history display and representative historical media access.
- With synthetic accounts and approved test integrations, verify generation
  debit, confirmed-failure refund, duplicate requests, cancellation and manual
  review. A lost upstream submission is an unknown result, not proof of failure:
  never force an automatic refund or resubmit it without checking the provider.
- Verify real email acceptance, provider output and any intended external payment
  behavior in their appropriate test environment. Unit-test mocks and configured
  credentials are not external acceptance evidence. Unimplemented payment channels
  stay disabled. Manual confirmations/refunds must represent independently verified
  external action. Test the refund prepare/complete/cancel sequence below before
  public use of a manual channel.
- Inspect admin launch readiness and resolve actual blockers. Its payment warning/
  error is deliberately not replaced by invented acceptance. Record residual gaps
  and obtain owner acceptance of any reduced scope before a live switch.

For a manual refund, call `POST /api/admin/billing/orders/:id/refund/prepare` with the
reason first. It atomically reserves the order's purchased permanent credits and
settled referral rewards, or fails without a partial reservation. Only a successful
reservation authorizes moving to the external reimbursement step; it does not
itself transfer money. Persist the returned `reservation.id` (also recorded in
`order.metadata.refundReservation.id`) and
the external reimbursement evidence. Complete through `POST /api/admin/billing/orders/:id/refund`
with `reason`, `confirmExternalRefund: true` and that `reservationId`.

If no reimbursement was sent, `POST /api/admin/billing/orders/:id/refund/cancel` requires the
matching `reservationId`, `reason` and `confirmExternalRefundNotSent: true` to
return the exact reserved balances. Never cancel after an actual reimbursement.
Reservations do not release automatically on a timer; keep unresolved reservations
in operational reconciliation. Plan entitlement revocation occurs on confirmed
refund completion, and pending referral rewards are held while the order refunds.

## 4. Verify the proxy and cookie boundary

Keep the public HTTPS origin in `PUBLIC_ORIGIN`. The frontend proxy verifies the
browser origin before forwarding authenticated writes. If it replaces `Origin`
with its internal backend target origin, add that exact trusted target origin to
`ALLOWED_ORIGINS`; do not disable CSRF enforcement to make requests pass.

Only set `TRUSTED_PROXY_CIDRS` to the immediate trusted proxy addresses/ranges.
The edge proxy must overwrite client-supplied forwarding headers. Enable the
frontend's trusted forwarding behavior only after proving that its incoming
client-IP header came from that edge. Verify both a legitimate client's rate-limit
identity and a spoofed forwarding header. Leaving backend proxy trust empty is
safe but aggregates rate limits at the proxy address and may block normal traffic.

Preserve `Cookie` and `Set-Cookie` through the frontend proxy. Production cookies
are secure, HTTP-only, same-site and host scoped. Do not expose the backend or its
database directly to the public network as a way to bypass the frontend boundary.

## 5. Final cutover with one active writer

The data-only adapter `scripts/normalize-legacy-transfer.py` accepts a read-only
`oaooao-database-transfer-v1` JSONL snapshot and an output path:

```sh
python scripts/normalize-legacy-transfer.py /private/source.jsonl /private/normalized.json
```

Both files contain confidential account data. Keep them outside source control.
The adapter is deliberately limited to the reviewed inventory. It refuses new
nonempty unmapped entities, active future entitlements, integration credentials,
avatars or media needing a transfer, rather than silently archiving operational
data that should remain usable. This adapter is coordinator-authored from database
fields and requirements, not imported legacy application code. Obtain the source
snapshot in one repeatable-read, read-only database transaction; never use a
moving series of independent table exports for financial reconciliation.

1. Obtain approval for the reviewed candidate and scheduled switch. Record source
   and destination identifiers, responsible operators, stop conditions, backups
   and the selected rollback path. Verify restore access before the window begins.
2. Put the source into a genuine write freeze and stop its background writers. Drain
   or explicitly reconcile outstanding payments, callbacks, model submissions and
   jobs. Avoid a state where two backends can settle the same money or work item.
3. Capture the final database/media baseline and normalize it into a new private
   transfer bundle. A rehearsal database is not the final destination: create a
   fresh final destination and repeat the proven migration/import/verification.
   Do not wipe a populated database or bypass the fresh-destination check.
4. Recheck critical account, permanent-credit, project/history and media samples.
   Ensure intended external integrations and callbacks target only the selected
   service. Preserve legacy financial records without replaying their grants.
5. Switch the frontend/backend target while traffic is still restricted. Perform
   the approved smoke checks. Enable the new worker and public writes only after
   the baseline is accepted; retain a single active writer throughout.
6. Monitor authentication failures, permission denials, balances, order/payment
   reconciliation, queue/review states, database errors, media failures and disk
   pressure. Record the first new write so rollback decisions use the correct path.

Neither `/ready` nor a successful import alone is approval to perform these steps.

## 6. Rollback without losing or duplicating writes

**Before new destination writes:** stop the candidate worker and traffic, preserve
the candidate for diagnosis, verify that no new orders, wallet changes, provider
submissions or project edits occurred, then return routing to the verified source
baseline. Restore the source's writers only once the candidate cannot write.

**After new destination writes:** freeze both sides first. Do not simply point the
frontend at the stale source or replay the original bundle. Inventory and reconcile
all destination-only users, orders/payments/refunds, wallet operations, coupons,
referral rewards, projects, generated assets and in-flight provider submissions.
Prefer fixing the accepted destination when that preserves consistency. Any return
to the source requires an explicitly reviewed reverse transfer or restore plus
delta reconciliation and fresh financial/media acceptance; this repository does
not provide an automatic reverse migration tool.

Preserve database snapshots, media versions, the matching encryption key, transfer
digests and audit records during the incident. Do not delete the old database or
media store until the owner-approved retention and reconciliation period ends.
Do not edit applied migration SQL to force a rollback: checksum verification is
intentional, and no automatic destructive down-migration is supplied.

### Check-in credit validity (migration 012)

Migration `012-check-in-credit-validity.sql` adds reward batches, allocation rows
and timed-credit ledger fields. Existing permanent and daily balances are not
converted. Compare all original fields before and after migration, then separately
verify that the new fields have their documented zero/null defaults and that the
new tables are initially empty.

The previous wallet implementation cannot account for timed credits or restore
their original allocations during refunds. Returning to that image is allowed
only while both new tables are empty and every `timed_delta` / `timed_after` is
zero. After any timed-credit use, retain maintenance mode and fix forward with a
compatible wallet implementation. A passing old `/ready` response is insufficient:
schema-read compatibility does not establish financial rollback compatibility.
