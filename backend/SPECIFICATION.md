# Independent implementation requirements

## Goal

Replace the derivative business backend while preserving the OAOOAO frontend's
observable APIs and the user's accounts, permanent credits, projects and history.
Do not reuse upstream implementation. This is not a claim of formal legal
clean-room certification: the coordinating audit has seen upstream code; module
implementers receive only requirements and client contracts.

## Integration architecture

- Node.js >=22, TypeScript, Fastify, PostgreSQL. ESM imports with .js suffixes.
- src/core.ts exports Context, AppUser, httpError. Context: db (pg.Pool), config,
  requireUser(request, permission?) -> Promise<AppUser>, audit(record) -> Promise<void>,
  encrypt(plaintext): string and decrypt(ciphertext): string for server secrets.
- AppUser: id, username, email, displayName, role, adminPermissions, enabled.
- Every module exports async registerX(app: FastifyInstance, ctx: Context).
- Foundation owns app.ts/server.ts/core.ts/auth.ts/settings.ts, migrations/001-core.sql.
- Commerce owns commerce.ts/wallet.ts, migrations/002-commerce.sql.
- Creative owns creative.ts/providers.ts/worker.ts/media.ts, migrations/003-creative.sql.
- Tests belong under tests/ with a module prefix. Each module may have its own folder
  for helpers. No implementation reads from outside this new repository at runtime.
- Foundation app.ts imports registerCommerce and registerCreative. Their entry modules
  are allowed to arrive asynchronously from teammates; do not create placeholder copies.
- Wallet contract: adjustWallet(ctx, userId, operationId, delta, metadata?, client?)
  returns balances. Negative insufficient balance throws 402. Repeated operationId
  cannot change balances again. Optional pg.PoolClient participates in caller transaction.
- Foundation session can call getWallet(ctx,userId). Wallet exports getWallet.
- Dedicated OAOOAO tables, no reuse of legacy service libraries or database functions.
  New schema source is owned by this implementation; legacy data is imported through
  an explicit normalized transfer format, not by executing legacy application code.

## Security and reliability requirements

- Server-side opaque session cookies, hashed session tokens, secure production cookie,
  CSRF origin checks for authenticated writes, authorization on every resource.
- Password hashing uses bcryptjs; import existing bcrypt hashes without publishing them.
- Public session never exposes channel keys, SMTP passwords, payment secrets or hashes.
- Enforce granular administrator permissions and audit material administrator changes.
- Fixed precision credits; transactional debit/refund and idempotent order settlement.
- Generation cancellation/failure refunds exactly once after confirmed failure, never
  after an indeterminate upstream result. Durable jobs survive process restarts.
- Cross-user reads/writes, repeated callbacks, concurrent saves and requests must have tests.
- Project saves use updatedAt conflict checks; create retries honor sourceHandoffId.
- Asset paths prevent traversal; upstream calls defend against private-network SSRF.
- PostgreSQL queries use parameters, scoped pagination and conditional atomic updates.
- No real model calls, payments, email or personal data during automated tests.

## Functional scope and evidence

Read the frontend API contracts to enumerate endpoints and exact envelopes. Cover:
session/login/logout/register/profile/password/email codes; permanent and daily credits;
admin users/permissions/settings/models/storage/mail/audit; products/order checkout/
manual completion/refunds/promotions/coupons/referrals and finance; canvas and drama
projects; asset upload/library/history; image/text/video/audio jobs; Agent runs, events,
retry/cancel/pause/resume; rendering only with an actually available encoder.

Use official provider protocols and dependency documentation. An unconfigured optional
integration may return a clear non-success availability response; do not substitute fake
work or silently remove previously configured capabilities. Inventory all gaps explicitly.

Acceptance requires typecheck, meaningful unit and isolated PostgreSQL integration tests,
frontend compatibility tests and migration reconciliation before any production cutover.

## Manual check-in validity and plan rules

- `checkIn` settings contain `enabled`, integer `rewardPoints` (1..1000000),
  integer `validityDays` (0..3650), and `planRewards` (at most 100 unique
  `{planId,rewardPoints,validityDays}` records). Missing validity/rules mean 0/[];
  zero days means permanent, positive days mean exactly N times 24 hours after
  claim. Plan IDs must exist in the entitlement definitions. Arrays replace,
  including an empty array to remove overrides. Existing disabled settings and
  historical permanent credits must not be changed by migration.
- Under the configuration share lock and the account's common wallet/user lock,
  capture server time, Shanghai claim date and active plan eligibility. Active
  enabled administrative assignment wins; otherwise the latest active,
  unrevoked purchased grant wins (starts_at, then id descending). A historical
  users.plan_id label alone is not eligibility. No matching override uses the
  base rule. There is still at most one claim per user per Shanghai day, even
  after an upgrade, downgrade or configuration change.
- `/api/account/check-in` GET/POST return the current effective rule fields
  `rewardPoints`, `validityDays`, `rulePlanId`, `rulePlanName`, and the separate
  immutable claimed snapshot `claimedRewardPoints`, `claimedValidityDays`,
  `claimedPlanId`, `claimedPlanName`, `expiresAt`. Unclaimed snapshots are null;
  old claims have 0 days and null expiry/plan. POST balance is total available.
- Additive migration 012 stores independently auditable expiring reward batches
  and signed per-operation batch allocations; old ledger fields are preserved,
  with new timed_delta/timed_after defaulting to zero. Reads and debits settle
  due remaining rewards once under the wallet lock. Bounded worker maintenance
  uses the same path. Only remaining value expires. No permanent balance is
  reduced to simulate expiry, and no imported credits are moved to timed batches.
- Debits merge daily allowance and batches by expiry ascending, then use
  permanent balance. Permanent-only cash-refund reservations and administrative
  permanent balance changes do not spend timed credits. Confirmed task failure
  restores the original allocation once; expired portions are not restored or
  converted to permanent credit, and expiry is never extended.
- Wallet/session totals include available timed balance, with separate
  `timedPointsBalance`, nearest nonempty `timedPointsExpiresAt`, and exact decimal
  strings. Ledger amount/balanceAfter include all three buckets, with separate
  `timedAmount`, `timedBalanceAfter`, optional expiry and `expiredRefundPoints`.
  The last field reports the requested refund portion that did not become
  available again. Account summaries count only unexpired batch remainders.
- **Rollback boundary:** the old application ignores batch allocations and
  cannot safely process financial activity once timed credits exist. Returning
  to an old image is allowed only before any batch/allocation exists and while
  every timed_delta/timed_after is zero. After adoption, preserve the schema and
  ledger and use maintenance plus a forward fix; do not silently switch to the
  old refund code. A schema-compatible read is not proof of financial rollback
  compatibility.
- Simultaneous batch and daily expiries settle batches against the original
  daily balance before refreshing the daily bucket. Every operation's bucket
  snapshots must equal the previous snapshot plus its signed deltas. Ledger
  times are monotonic per account under the wallet lock, including multiple
  entries in one transaction; transaction-start `now()` must not reorder a
  subsequent debit before the expirations that preceded it.
