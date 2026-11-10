# Curated creative references

The try-on workbench combines independent person, garment and pose inputs. Users
may upload images, reuse their own library assets or select a curated reference.
Selected images are ordered person, garment, pose; prompt numbering follows the
actual submitted array. A pose takes precedence over the person's original pose.
These are image-model instructions, not a guarantee of exact skeletal control.

Migration 020 creates a separate site catalog. It has no account ownership and
does not contribute to account storage quotas. Original media and thumbnails
remain in the configured private object store. Authenticated catalog endpoints
return only paginated display metadata and application URLs, never bucket names,
object locations, internal provenance notes or credentials. Pose groups expose
their available angles without loading the full image collection.

`GET /api/creative-references` supports role, keyword, category, style, angle,
page, pageSize and grouped pose results. Content/thumbnail routes authenticate
before issuing short-lived object URLs. Generation reads the exact original
object through the same store; user uploads retain their existing owner checks.

`POST /api/image-tasks/quote` uses the same context validation, model routing,
capability and pricing logic as submission. It creates no job or wallet entry.
The client submits the confirmed amount as approvedCost, so increased prices
require a fresh confirmation rather than silently charging more.

The operator-only importer accepts local, reviewed manifest/media files and
retains provenance. It validates paths and media signatures, uploads objects
under `_catalog`, and publishes metadata only after upload succeeds. It never
downloads or executes third-party code. `--stage-only` prepares object storage
without database writes; checkpoints permit interrupted imports to resume.
Object keys include content hashes. Asset packs and deployment manifests are
managed privately; no third-party image collection is bundled with the frontend.
