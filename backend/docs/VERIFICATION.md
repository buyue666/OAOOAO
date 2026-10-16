# Verification methods

The checks described here establish tested behavior within their stated scope.
They are not a legal clearance, a guarantee of complete coverage, or evidence that
an arbitrary deployment has working payment or model-provider credentials.

## Automated checks with synthetic data

Run typechecking, production compilation and the tests defined in `package.json`.
Integration tests require a disposable PostgreSQL database or schema and synthetic
users, orders, wallets, assets and projects. Keep connection strings and test
passwords outside version control. Tests must not target a production database.

The test suite exercises:

- Account authentication, session isolation and administrator permissions.
- Transactional wallet changes, idempotent settlement and refund reservations.
- Purchase-policy publication, catalog readiness and order policy snapshots.
- Project and canvas persistence, generation state and resource ownership.
- Announcement scheduling, promotion settings and public response filtering.
- Media-export ownership, real rendering behavior and watermark preferences.
- Check-in eligibility, daily idempotency and configured reward rules.

Test reports should identify the checked source revision, commands, dependency and
runtime versions, passed and failed checks, and any skipped or unavailable checks.
A test that cannot reach a provider must not be reported as a successful provider
integration. Test credentials, database dumps and fixture exports remain private.

## Browser acceptance with synthetic data

Use a disposable account against an isolated backend. Verify both an ordinary user
and an administrator, including reloads and permission failures. Useful workflows
include saving and reopening a project, retaining nested shot content, creating a
pending test order, resuming checkout, and preparing, canceling and completing a
synthetic refund. Reconcile the resulting wallet and order state through the API.

For public pages, check light and dark themes, narrow screens, keyboard operation,
empty states, validation errors and safe return navigation. Readiness messages must
reflect actual configured capabilities. A published purchase policy alone does not
establish that a payment method, email service or model channel is available.

Do not make real payments or incur model-provider charges as part of these tests.
See [CLIENT-API-COVERAGE.md](CLIENT-API-COVERAGE.md) for capability boundaries.

## Migration validation

Exercise migrations on a disposable database populated with synthetic records.
Verify the checksums of existing migrations, preservation of existing field values,
new-column defaults, uniqueness and ownership constraints, and compatibility of
older writers where that is part of the release plan. Repeat execution to test
idempotency. Financial migrations also need concurrent spend, grant, expiration and
refund cases; schema compatibility alone is insufficient for application rollback.

Transfer-adapter tests use synthetic snapshots to check nested projects, timestamps,
status mapping, rejection of unmapped source data and destination freshness. Keep
actual customer snapshots, production counts, balance totals and reconciliation
reports outside the public repository.

## Evidence and scope

Public evidence should contain only synthetic fixtures and reproducible methods.
Production backups, customer records, operational topology and deployment journals
are retained separately by the operator.
Do not substitute a synthetic test result for a production readiness check.

See [DEPLOYMENT.md](DEPLOYMENT.md) for deployment and rollback guidance.
