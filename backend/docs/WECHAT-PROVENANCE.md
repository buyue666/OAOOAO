# WeChat Official Account authentication

This integration was independently implemented from OAOOAO's client contracts,
Node.js cryptography APIs, and the official WeChat protocol documentation below.
No archived application or third-party authentication implementation was reused.

## Protocol references

Consulted on 2026-10-14, including the provider's published AES test vector:

- [Stable access token](https://developers.weixin.qq.com/doc/service/api/base/api_getstableaccesstoken.html)
- [Temporary parameterized QR codes](https://developers.weixin.qq.com/doc/service/api/qrcode/qrcodes/api_createqrcode.html)
- [Server configuration and URL verification](https://developers.weixin.qq.com/doc/service/guide/dev/push/)
- [Encrypted message format](https://developers.weixin.qq.com/doc/service/guide/dev/push/encryption.html)
- [Subscription and scan events](https://developers.weixin.qq.com/doc/service/guide/product/message/Receiving_event_pushes.html)

The QR API requires an authenticated service account with the relevant provider
permission. Configure the server IP allowlist and message server URL in WeChat.
This implementation accepts XML in safe (AES) mode; plaintext message POSTs and
compatibility mode are rejected. Standard signed URL verification and encrypted
URL challenges are supported. This is the Official Account flow, not the separate
WeChat Open Platform website OAuth product.

## Account and security boundaries

- The feature and automatic registration default to off. Saving complete values
  means configuration is present; it does not prove a successful live provider test.
- AppSecret, verification token and AES key are encrypted at rest. Read APIs return
  only presence flags. Empty secret fields preserve saved values; explicit clear
  flags remove them. AppID changes require new secrets and are blocked while an
  identity binding exists. Secret rotation invalidates outstanding QR sessions.
- Creation, polling and consumption are tied to an HttpOnly browser cookie. The
  signed AES event authorizes a five-minute QR session; it does not issue a browser
  login cookie. Consumption is transactional, and concurrent/retried requests from
  the same browser return the same encrypted-at-rest opaque login cookie.
- Existing accounts bind only after current-password verification. Consumption
  rechecks the original authenticated session, password and enabled account.
  OpenID is scoped to AppID. Another account's binding is rejected, never merged.
  Nicknames, avatars, email addresses and UnionID do not establish account ownership.
- New accounts require the site's registration switch, the separate WeChat
  automatic-registration switch, and explicit terms/privacy acceptance before
  issuing the QR. If verified-email registration is required, users register and
  verify email first, then bind WeChat. Existing bindings can still sign in.
- Unfollowing revokes short-lived QR authorizations and the login tokens recorded
  with them. It does not replace or delete account ownership, purchased credits or
  projects. Re-subscribing continues to resolve to the original account. The
  integration does not fetch or store WeChat profile names or avatars.
- URL redirects are restricted to unambiguous local paths. XML is bounded, flat,
  and rejects DTDs, entities, attributes, duplicates and nested nodes. Signatures
  are checked before AES decryption; padding, length, UTF-8 and AppID are checked.

## Validation boundary

`tests/wechat.test.ts` uses disposable PostgreSQL schemas, synthetic accounts and
an injected QR provider. It verifies the official crypto vector, HTTP signatures,
browser isolation, password binding, concurrent consumption, account states,
registration policy, configuration redaction and transactional audit failure.
These tests do not claim a real WeChat account, credential or callback was tested.
Production enablement still requires the operator's real provider configuration
and a successful end-to-end scan on that account.

Migration `014-wechat-official-login.sql` only adds authentication tables. It does
not infer or create existing-user bindings. Any later import of external identity
records needs an explicit mapping and duplicate/ownership reconciliation.
