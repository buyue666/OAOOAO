# EPay payment adapter

This implementation was authored independently for OAOOAO. Only this repository,
the OAOOAO client request/response contracts, Node's crypto API, and published
payment wire-protocol documentation were consulted. No third-party SDK, server
implementation, or template was downloaded or copied.

Protocol references consulted on 2026-10-14:

- https://pay.v8jisu.cn/doc/index.html/ and
  https://pay.v8jisu.cn/doc/sign_note.html — indexed provider documentation for
  V1/V2 and RSA signing. Direct requests returned 404 during this review; these
  pages alone were not treated as evidence of a live merchant integration.
- https://mazhifupay.com/28/6/568.html — provider-published V2 reference, fetched
  directly in full: page-submit endpoint, signed notification parameters and
  responses, RSA-SHA256 and optional cashier selection. Its actual gateway host
  is an example in the reference, never a configured default in OAOOAO.
- https://pay.senhuo.cn/doc.html — provider-published V1/V2 page-submit reference.
- https://pay.xr876.cn/doc/v1_legacy_api.html — published V1 compatibility
  reference for MD5 and notifications. This does not establish that every
  EPay-branded gateway implements identical behavior.
- https://nodejs.org/api/crypto.html — Node built-in RSA/MD5 operations.

Configuration uses an administrator-supplied HTTPS gateway, merchant ID and
explicit protocol selection. No merchant credentials, destination or enabled
payment channel is seeded. Completeness is not proof that a real merchant account
can collect money; deployment still requires the owner's provider-specific test.

The client receives a structured POST form, never provider HTML. Only the
server-to-server notification route may settle an EPay order. Browser returns
redirect to the account page and have no financial effect. Signed callbacks bind
merchant, local order, provider transaction, CNY amount and success status. The
existing order/payment uniqueness and wallet transaction enforce single crediting.
Unknown signed scalar extension fields participate in signature verification;
duplicates, arrays, control characters and ambiguous embedded ampersands fail.

Migration 013 adds a private, encrypted per-order configuration snapshot. This
keeps in-flight orders bound to their original merchant/protocol after a settings
change. The snapshot is never returned through public/admin order responses.
Disabling the channel prevents checkout; it does not discard a previously issued
order's valid payment notification. Checkout signs the original bound configuration
for retries. AES-GCM remains provided by the existing application encryption key.

V2 notifications require a signed, seconds-based timestamp. A local five-minute
clock-skew allowance prevents future timestamps and timestamps preceding checkout.
It is an OAOOAO safeguard, not a claim that every provider mandates that window.
Delayed, authenticated retries of already recorded payments remain idempotent.
Pending orders still have their existing local expiration deadline. Notifications
for expired/canceled orders are rejected for manual reconciliation; they never
silently reactivate an expired purchase or grant credits.

This adapter does not send refunds or transfers, query an external provider, or
execute arbitrary callback URLs. Verified EPay payments can use the existing
external-refund ledger workflow: reserve recoverable credits first, refund and
verify the money in the provider's console, then explicitly confirm the matching
reservation in OAOOAO. Canceling requires an attestation that no money was sent.
Insufficient recoverable credits block preparation; no external refund is sent by
the application. Duplicate verified payment notifications after refund do not
reissue credits. Late payments require operator reconciliation.
Tests use synthetic keys and disposable PostgreSQL schemas, without a real gateway
request, production mutation or credential. No automatic-payment acceptance is
claimed from those tests.
