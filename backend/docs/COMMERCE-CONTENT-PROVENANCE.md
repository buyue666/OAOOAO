# Commerce and content implementation provenance

Implementation date: 2026-10-14. Files covered: `src/commerce.ts`, `src/wallet.ts`,
`src/content.ts`, migrations `002-commerce.sql`, `005-content.sql`,
`006-refund-reservations.sql`, and their tests.

These modules were authored in this new private repository from the owner's
functional requirements, `AGENTS.md`, `SPECIFICATION.md`, and client contracts.
No archived or upstream backend implementation was read, copied, translated, or
loaded by this module implementer. This records the inputs used; it is not a legal
clean-room certification of the wider project.

Consulted frontend interoperability sources, under `OAOOAO-icon-fix/lib/studio`:

- `api.ts`: session, product, order, checkout, canvas and drama HTTP envelopes.
- `admin-api.ts` and `admin-types.ts`: admin request methods, paths, DTO fields,
  promotion/coupon/referral operations, finance, and work moderation metadata.
- `account-api.ts`: profile, ledger, referral center, owned orders and library calls.
- `commerce-policy.ts`: public purchase-policy fields and readiness expectations.
- `ledger.ts`: exported point-record shape and consumer classification contract.
- `creative-api.ts` and `generation-api.ts`: method/path inventory only, including
  render, version history, task aliases, agent control and event streams.

The coordinator supplied these compatibility facts: registration uses
`/register?ref=<code>` while the register request body uses `referralCode`; the old
reason-only refund action must not attest to a completed cash refund; legacy plan
labels and already-converted balances must not grant credits or revive plans.
The coordinator confirmed there is no actual client call to `/api/create/overview`.

On 2026-10-14, the coordinator made a later browser-discovered purchase-policy
contract correction in the new implementation. Its stated inputs were the
frontend settings/API contract and this independent repository: policy saved
through the site settings request is read from `site.commercePolicy`. That field
is authoritative even when explicitly draft, cleared, or invalid; the older
top-level field is a compatibility fallback only when the site field is absent.
The shared resolver now supplies catalog policy/readiness, order readiness, and
the order's policy-version snapshot. The relevant public client definitions are
`admin-api.ts` (`updateSiteSettings`), `admin-types.ts` (`SiteSettings` and
`AdminSettings`), and `api.ts` (the billing-products response).
This correction records an interoperability input, not reuse of a prior server
implementation. The coordinator's previously disclosed upstream exposure still
applies; the original module implementer's source restrictions must not be read
as a claim that the coordinator had no historical exposure.

Cross-module integration used only new repository sources and the documented
Context, settings, user, project and migration interfaces. Fastify's installed
public type declarations were consulted for route lookup in the contract test.
The initial commerce contribution did not implement an external payment provider. The later V1/V2 EPay implementation and its consulted official sources are documented in [EPAY-PROVENANCE.md](EPAY-PROVENANCE.md); synthetic regression coverage does not establish live merchant acceptance.

Verification uses synthetic users and disposable PostgreSQL schemas. The wallet
suite verifies precision, contention, rollback, idempotency, expiry and imports;
commerce HTTP tests verify real database effects and response contracts; regression
tests cover allowance revoke/reassign and lock ordering; content tests cover
authorization, persisted records, version conflicts, races, audit rollback and
retained governance evidence. The assembled route-contract test requires neither
database access nor external integration calls.

## Explicit operating boundaries

- Credits use four-place fixed precision and database transactions. Permanent and
  daily balances remain separate. Refunds reference the original debit and cannot
  turn expired daily credits into permanent credits.
- A manual payment confirmation records verified external receipt. Manual refunds
  have a mandatory durable preparation phase: reserve purchased permanent credits
  and settled referral rewards before sending any money externally. Insufficient
  balance fails atomically at preparation. Prepared orders use `refunding` and
  expose the reservation identifier in order metadata so operators can resume
  after refresh. No reservation expires automatically. Confirming requires that
  exact identifier and `confirmExternalRefund: true`; no second wallet debit occurs.
  Canceling requires `confirmExternalRefundNotSent: true` and returns the original
  held amounts exactly once. Pending referral rewards do not settle while prepared.
  Plan access is revoked only when the refund is confirmed. Administrators must
  still verify external facts: no route sends cash or reverses an external transfer,
  and a transfer in progress or of uncertain outcome must not be canceled.
- Alipay, WeChat Pay and Stripe configuration is retained with encrypted secrets,
  but these provider protocols remain unavailable. Historical provider names are
  retained in imported financial records. No generic unverified webhook exists.
- Plan sales require enabled entitlements and a matching enabled plan definition.
  Imported conflicting catalog records remain preserved and cannot bypass this gate.
- Risk auto-freezing requires a real scoring implementation. Imported enabled
  settings conservatively freeze qualification; configuring new auto-freezing is
  rejected with a clear availability response. No fabricated click events exist.
- Work moderation stores actual metadata in dedicated tables. Internal
  `submitWorkVersion` and `openWorkCase` provide ingestion boundaries for real future
  submissions/reports; no public author submission HTTP contract was present in the
  consulted client. An empty database therefore yields a real empty query result.
- Approving a current work version publishes it unless a separate takedown exists.
  New versions require review again; featuring requires approved and published
  state. Deletion hides work while retaining versions, cases and audit evidence.
  Resolving a governance case records the decision; publication state changes use
  the explicit review/takedown operations. No automatic reinstatement is invented.

The coordinator authorized frontend changes to `lib/studio/admin-api.ts` and the
refund controls in `components/studio/admin-commerce.tsx` for this new two-phase
contract. The frontend project's AGENTS.md, bundled Next.js server/client guide,
and the installed React best-practices skill were consulted. These are frontend
integration edits; no prior backend implementation was used.

## Later public-gallery amendment

The public gallery and version-bound public media routes added to `src/content.ts`
on 2026-10-14 have a separate input record in
[`PUBLIC-GALLERY-PROVENANCE.md`](PUBLIC-GALLERY-PROVENANCE.md). That contributor
previously inspected historical sources in a separate audit. The original
module author's no-upstream-exposure statement above therefore applies to that
author's original work, not to the later contributor. This amendment used the
current independent repository and the authorized frontend gallery contract;
it does not assert formal clean-room certification or legal clearance.
