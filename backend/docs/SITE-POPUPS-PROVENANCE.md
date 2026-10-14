# Independent promotional popup resource

This implementation follows the OAOOAO owner's requested independent promotional
popup contract, as relayed by the coordinating agent. Inputs were that contract,
this repository's existing Fastify/PostgreSQL authorization, transaction, audit,
pagination and safe announcement-URL conventions. No restricted third-party
server implementation, proprietary assets, or dependency implementation was
consulted or copied.

`009-site-popups.sql` creates a new table that is initially empty. It does not alter
announcements, login popups, user records, balances, or prior migrations. Admin
operations require `content.manage` and write their audit event in the same
transaction. Public listing applies the published flag and the inclusive start /
exclusive end interval. The client decides session/daily frequency and page matching.

Image URLs are limited to normalized public `/media/` paths or complete HTTPS
URLs; SVG/SVGZ paths, URL credentials, control characters and backslashes are
rejected. The backend does not fetch configured images or actions. URL validation
cannot certify an external server's eventual image MIME type; the client must load
the image as an image and render title/content as text, never inline image markup
or HTML. Account-owned `/api/reference-assets` uploads require authentication and
are not made public by this feature.

Verification uses disposable PostgreSQL schemas, synthetic users and synthetic
URLs only. Coverage includes additive migration compatibility, durable CRUD,
permissions/CSRF, validation, schedule boundaries, list ordering/pagination,
concurrent partial edits and full rollback when audit insertion fails.
