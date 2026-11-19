# New API balance integration

The OAO owner commissioned an independent client for the existing LunAPI cashier protocol. The cashier authenticates the paying LunAPI user and authorizes the debit; OAO does not receive that user's credentials or initiate debits itself. OAO and LunAPI accounts need not share an email or identifier.

Checkout fields use a versioned HMAC-SHA256 canonical sequence. The first checkout stores an encrypted provider/nonce snapshot in the payment attempt. Payment callbacks and signed service-side queries must agree with the immutable OAO order identity, amount and currency. Configuration changes cannot invalidate an already initiated order's valid receipt. Order locks and unique transaction identifiers prevent duplicate fulfillment.

Refunding first reserves refundable OAO points. The outbound request is recorded before it is sent, and only an authoritative matching receipt completes the refund. A timeout is uncertain, not a failed refund: its points stay reserved and cancellation is blocked until the same idempotent refund can be verified.

Provider configuration contains an HTTPS gateway origin, merchant identifier and encrypted signing secret. No credentials are returned to clients. A separate merchant allows OAO to coexist with the cashier's legacy merchant. A periodic reconciliation loop queries bounded recent pending attempts; it never infers payment from a browser redirect.

Migrations 024 and 025 add durable feature enablement and extend the attempt provider constraint. Retired manual collection is disabled for new purchases while economic history remains intact. Development verification uses disposable PostgreSQL databases, fake accounts and protocol fixtures; it does not transact real balances.
