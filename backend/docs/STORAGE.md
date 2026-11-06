# Account preferences and media storage

Migration `015-account-storage.sql` adds per-account model preferences, optional
account quota overrides and the location/deletion state of each stored media file.
Existing media rows default to `local`; enabling R2 never reinterprets old files.

## User model defaults

`GET/PATCH /api/account/model-defaults` reads or updates the authenticated user's
image/video/text/audio model defaults. Updates validate the capability and an
enabled, authenticated binding, including its request alias. Session settings merge
these choices over site fallbacks. Missing or unavailable choices fall back without
changing the user's saved preference. Explicit task model selections take priority;
Agent planning also uses the account's default text model.

## Capacity

`GET /api/account/storage` reports actual bytes, file count, quota and bytes awaiting
deletion. Priority: an administrator's account override, active membership plan,
default plan, site default. The initial default is 10 GiB. A quota of zero means
unlimited; null account override means inherit. UI fields marked GB use 1024 cubed
bytes. No data is deleted when membership expires or its quota is lowered.

Uploads and generated results reserve bytes under a per-account PostgreSQL advisory
lock before writing. Concurrent writes cannot pass the same free-space check. Both
persistent and temporary files count, including uploads/deletions awaiting recovery.
The API refuses additional writes that exceed the quota. Since generation output
size is not known before calling a provider, it checks for available space at
submission and verifies the exact result bytes before persisting. A provider result
that cannot be persisted follows the existing manual-review flow, never an automatic
second provider call.

`GET /api/account/stored-media` lists stored files, including uploads without a
library record, so occupied capacity can be managed in Creative assets.

## Cloudflare R2 and S3

Configure the existing administrator object-storage API with `provider: r2`, the R2
S3 endpoint, region `auto`, a private bucket and an object read/write credential
scoped to that bucket. Secrets are encrypted with the deployment's encryption key,
never returned to clients or committed. No account, bucket or credential is created
by the adapter. Generic S3-compatible endpoints use `provider: s3`.

New files record an immutable object location. Existing remote files remain readable
after new object writes are disabled. Switching bucket/endpoint or clearing keys is
blocked while remote files remain; rotating credentials for the same bucket is
allowed. Prefix changes apply only to new files. There is no automatic migration of
existing local files.

The signed AWS SDK transport uses DNS/IP-validated requests with fixed time/size
bounds. Authenticated image/video elements receive a five-minute signed GET URL;
same-origin browser fetches and canvas CORS reads retain an authenticated origin
response. Private upstream reference tokens remain bounded by the media token's
expiry. Other accounts cannot obtain a URL. R2 does not need a public development
domain or blanket public permissions.

The administrator's connection test performs HeadBucket, Put, Get/content verification,
Delete and absence verification on a uniquely named probe. It reports failure if any
stage fails; it never treats connectivity alone as upload success.

## Deletion and recovery

`POST /api/account/assets/batch-delete` accepts at most 100 media/library IDs and
validates ownership for the entire batch before changing anything. Files referenced
by projects, project versions or active jobs are skipped with a reason. Saving new
project/library/job references shares the same account lock with deletion. Eligible
files are removed from duplicate library records and historical output lists;
generation prompts, task/credit history and projects are preserved.

Deletion first records a durable tombstone, then removes the local file or object.
Only successful physical deletion removes the byte-accounting row. Failed deletions
remain queued and counted; worker maintenance retries them. Uploads reserve a
ten-minute recovery lease before external I/O, so a crash can also be cleaned up.
Temporary references expire after two hours; their physical deletion follows the
administrator's `cleanupExpiredTemporaryMedia` switch. Pending deletions and failed
upload recovery are retried regardless of this switch. Persistent assets are retained. Worker
maintenance runs between jobs, so physical expiry cleanup is not an exact-time SLA.

Tests use disposable PostgreSQL schemas and synthetic files. S3 network operations
are mocked at the SDK command boundary; live storage configuration still requires a
real credential and a separate upload/read/delete check before claiming deployment
verification.

## Per-channel generated-result storage

Administrators set `systemChannels[].storeGeneratedMedia` in the channel editor.
Missing values preserve the existing save behavior. `true` saves outputs using the
global storage configuration (R2 when enabled, otherwise local storage). `false`
keeps a public HTTPS output URL without downloading it, reserving storage or counting
it against capacity. The URL's hostname is checked against private/reserved networks.
The selected value is snapshotted with the job, including asynchronous polling.
An old client omitting the field preserves the channel's saved value.

Binary/base64-only outputs and local renders still require storage and exact-byte
quota checks. An upstream URL with expired access cannot be recovered by this switch.
Enabling transfer is appropriate for channels returning temporary URLs.

CDN output collection, deletion and download verify the authenticated account's
successful generation result. Downloads use `/api/account/media/export`, retain the
account's saved watermark policy and never save a permanent copy. Arbitrary URLs
cannot use this endpoint as a fetch proxy. Deleting CDN results removes account
records and leaves upstream files alone; no freed storage is reported. Removing one
result from a multi-image task retains its other results.
