# Self-service team purchases

Team catalog readiness now follows the existing published commerce policy and
configured verified payment providers. Users choose a managed team or name a new
team, select seats and review the exact server price before creating an order.
The server rejects stale amounts, invalid seats, foreign teams, conflicting
pending orders and incompatible in-term plan changes.

Orders reuse the existing New API balance or EPay checkout and signed settlement.
The immutable team plan snapshot is fulfilled only after verified payment. It
updates team capacity, concurrency, model scope and the subscription term, then
grants a uniquely identified team credit batch. No personal plan or personal
credits are added. Repeated callbacks are idempotent. Matching renewals extend the
team term by 30 days, with no automatic debit.

Unused team orders use the existing refund workflow, with a team-specific credit
hold and exact restore on cancellation. Orders with spent team credits or later
subscription changes reject a full refund before money is sent. Personal wallet
refund deductions are never used for team credits.

Tests create synthetic accounts in isolated databases, validate signed synthetic
receipts and never call a live payment gateway or alter production balances.
