# Public gallery change inputs

This 2026-10-14 change adds public gallery discovery and version-scoped media
delivery to `src/content.ts`, with isolated synthetic tests in
`tests/public-gallery.test.ts`. No schema or private-media authentication rule
was changed.

Inputs were the owner's explicit public-gallery requirements, this repository's
`AGENTS.md`, `SPECIFICATION.md`, `content.ts`, `media.ts`, `core.ts`, schema and test
helpers, and the current OAOOAO frontend's gallery HTTP field/path contract.
The implementation was written for those requirements. No archived/upstream
implementation or assets were consulted or reused in this change.

The contributor previously performed a separate provenance audit that included
historical source inspection. Accordingly, the earlier original-module author's
no-upstream-exposure statement does not describe this later contributor, and
this change is not represented as a formal clean-room implementation or a legal
clearance.

Publication selects only a currently approved and published version, with a
recorded reviewer and review timestamp. Media is limited to that version's
explicit cover/preview slot, an owned persistent local image/video, and an
allowlisted format. Public responses contain presentation fields and newly
constructed version-scoped URLs; they never serialize private project documents,
user rows, source media URLs, access tokens, or arbitrary remote resources.
Withdrawal and version changes are checked again on every public media read.
