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
| WeChat official login sessions and consumption | auth/wechat | Browser-bound parameter QR, signed AES callback, one-time transactional consumption and password-verified existing-account binding. Requires real provider configuration and verification. |
| Public products and purchase access/policy | commerce | Persisted enabled catalog with purchase gates and provider readiness; no configured payment channel is invented. |
| Owned order create/list/detail/cancel/checkout | commerce | Owner-scoped, transactional, idempotent create and settlement. Manual and EPay (V1 MD5 / V2 RSA) are opt-in; browser returns cannot settle orders. |
| Points records and referral center | commerce/wallet | Exact persisted balances, owned ledger, retained transfer descriptions/types/times; invitation uses `/register?ref=`. |
| Admin users/settings/storage/mail/models/readiness/audit | auth/settings | All reviewed methods/paths registered. Actual integration prerequisites still apply. |
| Admin products/orders/finance/payment config | commerce | Dynamic, masked provider configuration. Manual and verified EPay payments support external refunds: reserve credits, refund via original channel, then explicitly confirm the reservation. Canceling requires a no-transfer attestation; no automatic outgoing transfer. |
| Promotions and coupons | commerce | Admin template/create/update/grant calls registered and persisted; coupon reservations release on close/expiry. |
| Admin referral program/relationships/rewards | commerce | Persisted settings and records; delayed rewards settle transactionally. |
| Canvas/drama projects | creative | Create/list/read/save/delete contracts registered; ownership and version conflicts enforced. |
| Library assets and reference uploads | creative/media | All reviewed calls registered; owned media validation applies. |
| Generation tasks/history | creative | Image/text/audio create; video create alias; read/cancel/recover for every client task prefix; persisted history. `allowedGenerationKinds` is enforced before provider selection and debit, including Agent-created tasks and rendering. |
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
- Public gallery and approved-version media routes are implemented. The gallery
  only exposes reviewed public versions; private user assets do not become public
  merely because a submission exists. Author actions and publication helpers must
  retain their ownership and review rules; admin registration alone is not evidence
  of a complete public publication flow.
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
- WeChat adds `GET /api/account/wechat-official`, password-verified
  `POST /api/account/wechat-official/bind-sessions` and the fixed provider callback
  `/api/integrations/wechat-official/callback`. Email-required registration cannot
  be bypassed through a QR login. Existing account bindings are never guessed.
- EPay uses the fixed `/api/billing/webhooks/epay` notification and
  `/api/billing/epay/return` browser return. Notifications require a matching signed
  merchant/order/amount/currency/transaction and an encrypted checkout snapshot.
  Expired or canceled payments require manual reconciliation, not automatic crediting.
- This inventory found no remaining missing method/path in the reviewed wrappers
  after content registration. It does not claim that unavailable third-party
  integrations are operational or replace full frontend/browser verification.
