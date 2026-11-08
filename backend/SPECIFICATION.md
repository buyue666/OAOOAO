# Independent implementation requirements

Video capability, quote, reference and pricing contracts are documented in [VIDEO_CAPABILITIES.md](VIDEO_CAPABILITIES.md).

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

## Team workspace contract

Agent run views additionally return `summary`, `planningPoints`,
`planApproval.executionEstimatedPoints`, and `outputs`. Planning cost is the
current non-refunded planner job; the execution estimate covers the proposed
child steps. These are distinct from the cumulative `pointsCost` already charged.
Outputs use the library-asset view, preserve step/result order, and include only
the run owner's assets explicitly recorded on its steps. Deleted outputs are
omitted. Reading a run does not generate media or create child jobs; explicit
plan approval remains required.

- `/api/teams/:teamId/projects/:projectId/canvas` reads and writes the project's
  `document` as a canvas. Reads return `{data:{project,workspace}}` with current
  reviewer/download permissions and the team's allowed model IDs. PATCH accepts
  `{expectedVersion,expectedUpdatedAt,project:{title,nodes,connections,viewport}}`, locks the team,
  validates project access and every media/task reference, and returns an
  acknowledged timestamp. It increments the same optimistic project version used
  by settings; stale saves return 409 without overwriting either editor's data.
  Documents are limited to 3 MiB, 2,000 nodes and 6,000 edges. Media must already be
  stored in the same project; personal, external and inline URLs are rejected.
  Reviewer viewport/selection changes remain local. This is shared persistent
  project content, with conflict detection, rather than realtime collaboration.
- Team canvas generation uses the existing team quote/create/cancel APIs and
  scoped GET `/generations/:id`. A stable team-wide request ID can be reconciled
  by another authorized project member without creating a second debit; a changed
  project or payload still conflicts. The canvas persists the immutable request
  and approved cost before creating any paid task. Media and generated text are
  stored in the original project, using team capacity even after the author leaves.
  Personal Agent runs and personal skills are unavailable in team canvas.
- Team asset lists accept `keyword` and `kind=text|image|video|audio|media` in
  addition to project and pagination filters. `media` excludes text before
  pagination and counting; every filter retains current project ACL enforcement.

- Additive migration `016-team-workspaces.sql` leaves historical personal rows in
  the personal scope. Teams have independent membership, project ACLs, storage,
  credit batches, budgets and audit events; site-admin roles never grant ordinary
  team membership. Apply the migration with the matching backend release before
  serving team requests. No production migration is performed by development tests.
- `/api/teams` creates and lists real spaces. Invitations reserve creator/reviewer
  capacity under a team row lock, expire after seven days, store only token hashes,
  and are one use. Targeted email invitations require the verified matching email.
  Creating an invitation returns a shareable link; it does not claim email delivery.
- Projects default to restricted visibility. Owner/admin governance access is
  explicit; other access requires current membership and a project assignment or
  team visibility. Removing a member also removes project assignments. Ownership
  transfer needs the target creator/admin to accept within 24 hours.
- Team assets are separate physical copies, not references to a departing member's
  personal files. Reads always check current membership/project access; a download
  additionally checks reviewer permission. Preview access is not DRM and cannot
  prevent screenshots or saving bytes already received. The worker retries failed
  upload/deletion cleanup; pending files still consume team quota.
- Team jobs bind actor, team, project and server price before enqueueing. The same
  transaction checks subscription, allowed models, concurrency, task ceiling,
  member UTC-calendar-month budget and available team batches. No personal-wallet
  fallback exists. Personal task/history APIs exclude team jobs. A worker uses the
  original team context even after the submitting member leaves.
- Team debit/refund operations are idempotent. Expiring batches are spent first;
  refunds restore original, still-valid allocations and the original budget month.
  Expired credits never become permanent or extend their expiration.
- Two team plan drafts are seeded without prices and disabled. Administrators with
  commerce permission configure seat bounds, credits, total storage, concurrency,
  model scope and task ceilings. Billing permission separately controls audited,
  idempotent manual 30-day entitlement grants and credit adjustments. An active
  period cannot be re-granted to farm full-period credits. Manual grants are not
  payment confirmations and create no successful payment records.
- Online team checkout, recurring billing, prorated seat increases, scheduled seat
  reductions, shared canvas editing and comments are not exposed in this increment.
  Public team plans explicitly report `purchaseEnabled: false`. Existing personal
  checkout and generation remain unchanged. Production cutover still requires
  migration, real auth/storage/provider checks and a review of configured prices.
- Team and project detail routes expose role-scoped project, membership, usage,
  asset and generation controls. Account-menu space switching follows the URL;
  it does not convert personal resources or grant site administrators membership.
  Administrator team listings support keyword search and scoped pagination.
- All binary provider results, including speech and video-content downloads,
  pass through the workspace-aware generated-media writer. Workers retain the
  job's original team/project context when an actor leaves. Team storage exhaustion
  never falls back to a personal quota. Video-content downloads use the video
  byte ceiling. Personal jobs retain their existing storage ownership.
- Team generation requires a server quote and explicit approval. A pending
  submission snapshot is scoped to account/team/project in session storage;
  unknown responses can be retried after a remount with the original idempotency
  key and approved input. Quotes never create jobs or debit credits.
- Migration `017-team-plan-display.sql` adds an optional team-plan `display`
  object with `tone`, `badge` and `benefits`. These fields affect presentation
  only; seats, storage, concurrency and model permissions remain authoritative
  resource fields. Team and personal cards share twelve named color themes,
  including four gradients. Existing automatic assignments retain their order.

## Personal plan model access

- An enabled entitlement plan may set `allowedModelIds` to canonical logical
  model IDs. Omitting the field preserves access to all available models;
  an explicit empty array denies model generation. Invalid, blank or duplicate
  IDs are rejected. Disabled or unconfigured provider routes remain unavailable.
- The active administrative or purchased entitlement determines access; users
  without an active plan use the default entitlement. The restriction is enforced
  on quotes, new generation jobs and Agent steps before debit or provider calls.
  Aliases share the canonical model's permissions. Completed or already accepted
  idempotent requests keep their original response after a plan change.
- Session settings expose `personalModelIds` separately from the sanitized model
  catalog so independent team scopes can use the catalog. Personal selectors and
  default-model settings filter the personal scope; existing saved preferences
  are retained for a later plan upgrade. Team model permissions and wallet use
  remain independent of the user's personal plan.

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

Video resolution pricing
- Bindings can configure `videoPricing.resolutionPricing[quality]`. Its
  `generationRate` follows `videoBillingUnit`; `generationDurationRates` maps
  exact output seconds to a complete generation price for duration billing.
- `referencePrices` applies to the output resolution, using extra image/video/
  audio count prices and optional reference video/audio per-second prices.
  Ordered `referenceDurationTiers` select a complete reference price map by
  output duration (`maxSeconds` inclusive). Explicit tiers replace legacy
  reference multipliers. They must cover each billable request's output duration.
- Existing resolution/duration tables and binding/model fallback prices remain
  compatible. A present `generationRate: null` explicitly removes its fallback;
  an empty `referencePrices` map explicitly clears inherited reference prices.
  Missing required prices block a quote/submission; explicit zero is free.
- Quotes and submissions use the same resolution and duration rules, probe input
  media durations, and calculate in wallet precision. Quotes create no paid jobs
  or wallet operations. Bulk resolution edits copy only selected targets and
  intersect the source duration rule with each target's native limits.
- `videoPricingTemplate: reference-video-output` selects between ordinary
  generation and `referenceVideoGenerationRate` using verified reference video
  presence. Both rates apply to output seconds for per-second billing. Video
  input duration/count prices are ignored in this template, including free-count
  settings; duration and count limits still apply. Exact-duration billing uses
  `referenceVideoGenerationDurationRates`. Missing or cleared conditional prices
  block quotes, while explicit zero is free. Older input-video rates are read as
  the conditional output rate without rewriting saved settings.
- Provider adapters may pass a server-verified `billableSeconds` to the shared
  per-second calculator. Output seconds still select duration prices, output
  limits and duration bands; billable seconds only multiply the selected rate.
  Fractional seconds use milliseconds, rounding the final debit up to the
  wallet's four-decimal precision. Request/duration billing stays unchanged.
- `videoReferenceTotalLimit` is an optional integer 0–1000 shared by image,
  video and audio references, including uploads and library selections. Zero
  adds no administrative restriction. A positive value intersects with the
  native `maxReferences` ceiling; per-type count and duration rules still apply.
- Within a logical model, accounts using the same normalized provider URL,
  protocol and case-sensitive upstream model share base/video prices and free
  reference quotas. Routing writes reject conflicting prices atomically. The
  editor can explicitly unify existing differences from a selected account and
  synchronizes subsequent price edits. Account routing, concurrency, capability
  switches, enabled qualities, duration rules and reference limits stay local.
  Configuration reads and deployments never rewrite prices automatically.
- `frameReferenceTypes` lists optional ordinary references allowed alongside
  first/last frames: `image` and/or `audio`. Frame-role items must be images;
  a tail requires a first frame. Video references are rejected with frame roles,
  even when the provider supports video in ordinary multi-reference mode. Counts
  and total ceilings include the frame images. An absent list permits only
  frame-role images. UI mode `frames` combines first frame, optional last frame
  and supported ordinary references; requests still use explicit frame roles.
