# OAOOAO independent backend

This AGPL-3.0-only backend is an independent implementation commissioned by the OAOOAO owner.
Implement from the functional specification and the existing client API contract.
Do not read, copy, translate, or mechanically refactor restricted or unauthorized
third-party server implementations, or the archived derivative server.
Do not copy proprietary assets or dependency implementation code.

Allowed inputs: this repository, standards and official dependency/provider docs,
and the OAOOAO frontend's API request/response type definitions and call contracts
in the OAOOAO frontend repository: `lib/studio`. Read those only for interoperability,
not for implementation reuse. Record consulted sources in provenance notes.

Use Node.js, TypeScript, Fastify, PostgreSQL, permissively licensed dependencies.
No production writes, deployment, credentials, or user data in development tests.
All integration tests use disposable schemas/databases and synthetic users.
Never mark unavailable providers, payment, email, storage or rendering successful.
Never include credentials in errors, session responses, logs or source control.
Keep each user's resources isolated and use transactions/idempotency for credits.

Shared integration contract is SPECIFICATION.md. Coordinate changes to core APIs.
Each agent owns its assigned modules and tests. Do not overwrite another module.
Typecheck and run tests for the functionality you implement.
