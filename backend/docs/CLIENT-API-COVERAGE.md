# Reviewed client API coverage

Scope: HTTP call contracts in `lib/studio/api.ts`, `account-api.ts`, `admin-api.ts`,
`creative-api.ts`, and `generation-api.ts` of the OAOOAO frontend. Compared only
against the independently authored backend. The executable registration snapshot
is `tests/content-contract-routes.test.ts`; it expands dynamic task kinds, project
kinds, and agent actions, and verifies the assembled app without making requests.
Route registration is only one check; state, ownership and financial behavior are
covered by the module integration suites.

| Client capability | New module | Coverage / availability |
| --- | --- | --- |
| Session, login/logout, register, profile, password, reset and email codes | auth | All reviewed methods/paths registered. Unconfigured mail returns an explicit availability error. |
| WeChat official login sessions and consumption | auth | All three paths registered; unavailable until a real provider integration is implemented/configured. |
| Public products and purchase access/policy | commerce | Persisted enabled catalog with purchase gates and provider readiness; no configured payment channel is invented. |
| Owned order create/list/detail/cancel/checkout | commerce | Owner-scoped, transactional, idempotent create and settlement; manual checkout is opt-in. |
| Points records and referral center | commerce/wallet | Exact persisted balances, owned ledger, retained transfer descriptions/types/times; invitation uses `/register?ref=`. |
| Admin users/settings/storage/mail/models/readiness/audit | auth/settings | All reviewed methods/paths registered. Actual integration prerequisites still apply. |
| Admin products/orders/finance/payment config | commerce | All reviewed methods/paths registered. Manual refunds require preparation, then explicit confirmation with the reservation identifier; canceling requires an explicit no-transfer attestation. |
| Promotions and coupons | commerce | Admin template/create/update/grant calls registered and persisted; coupon reservations release on close/expiry. |
| Admin referral program/relationships/rewards | commerce | Persisted settings and records; delayed rewards settle transactionally. |
| Canvas/drama projects | creative | Create/list/read/save/delete contracts registered; ownership and version conflicts enforced. |
| Library assets and reference uploads | creative/media | All reviewed calls registered; owned media validation applies. |
| Generation tasks/history | creative | Image/text/audio create; video create alias; read/cancel/recover for every client task prefix; persisted history. |
| Agent runs/actions/events/retry | agents | All reviewed paths registered; durable job and event behavior is tested separately. |
| Drama render/capability/versions | creative | All reviewed paths registered; rendering requires actual encoder capability. |
| Jianying export | creative | Path registered; explicit unavailable response, no fabricated export. |
| Admin generation operations/review/overview | creative | All reviewed methods/paths registered. |
| Admin announcements | settings | Persisted list/create/update/delete; public `/api/announcements` also exists. |
| Admin works/work-cases | content | The seven missing calls were added with dedicated persistent work/version/case tables, permissions, transactions and audits. |

## Focused findings

- `/api/create/overview`: no call exists in the reviewed API wrappers. The
  coordinator checked broader frontend call sites and found only an unused proxy
  test reference. No endpoint was invented for that reference.
- The work contract comprises `GET /api/admin/works`, `POST` review, take-down and
  feature actions, `DELETE /api/admin/works/:id`, `GET /api/admin/work-cases`, and
  `POST /api/admin/work-cases/:id/resolve`. List envelopes contain real `items`,
  `total`, `page`, and `pageSize`; far-past-last-page requests retain the total count.
- No public works feed, author publication, report or appeal HTTP call exists in
  the consulted wrappers. Internal ingestion helpers exist; connecting future
  author/public routes requires their actual request, ownership and visibility
  contracts. No public-serving capability is claimed.
- Coupons are private user entitlements. The reviewed wrappers call admin coupon
  template/grant routes; the backend additionally exposes authenticated
  `GET /api/billing/coupons`. No anonymous coupon ownership list is provided.
- The updated admin refund client adds `POST /api/admin/billing/orders/:id/refund/prepare`
  and `/refund/cancel`. Preparation secures credits before any external cash transfer;
  original `/refund` confirmation requires the active reservation ID. Refreshing
  a `refunding` order restores its controls from `metadata.refundReservation`.
- Public session remains `GET /api/auth/session`; public product access is
  `GET /api/billing/products`. No additional `/api/public/*` prefix is called by the
  reviewed wrappers. These public routes must not expose integration secrets.
- This inventory found no remaining missing method/path in the reviewed wrappers
  after content registration. It does not claim that unavailable third-party
  integrations are operational or replace full frontend/browser verification.
