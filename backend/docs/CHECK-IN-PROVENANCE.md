# Manual account check-in

Independently implemented from the OAOOAO product request and this repository's `SPECIFICATION.md`, `src/core.ts`, `src/wallet.ts`, authentication/settings contracts and disposable PostgreSQL test fixtures. No third-party application implementation or assets were consulted.

Manual check-in grants permanent wallet credits once per account per Shanghai calendar day. It is disabled by default, with a default reward of 10. The existing UTC daily allowance is a separate, expiring wallet mechanism and is unchanged. A unique account/date claim, deferred wallet-operation foreign key, wallet adjustment and audit write share one transaction. Repeat requests return the current balance without granting again. Configuration uses the existing commerce management permission. The optional internal test clock is never exposed to request input.
