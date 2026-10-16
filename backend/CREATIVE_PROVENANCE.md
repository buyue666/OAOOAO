# Creative subsystem provenance and availability

Authored independently in this directory from `SPECIFICATION.md` and the consumer contracts below. No archived or upstream server implementation was opened, translated, or used by this module's implementer. The coordinating provenance reviewer inspected upstream code separately; this is not a claim of a formal clean-room process for the entire project.

Consumer contracts consulted (HTTP request and response interoperability only):

- `OAOOAO frontend repository / lib/studio/api.ts`
- `OAOOAO frontend repository / lib/studio/account-api.ts`
- `OAOOAO frontend repository / lib/studio/generation-api.ts`
- `OAOOAO frontend repository / lib/studio/generation-types.ts`
- `OAOOAO frontend repository / lib/studio/admin-api.ts` and `admin-types.ts`
- `OAOOAO frontend repository / lib/studio/drama-types.ts`
- `OAOOAO frontend repository / lib/studio/creative-api.ts`
- `creative-project.ts`: only the stableMediaUrl/mediaStorageKey URL contract.
- Targeted client route compatibility review: `app/projects/[projectId]/page.tsx` and `[section]/page.tsx` select the creative workspace only when the ID starts with `drama-`. New drama IDs therefore use that prefix; existing imported IDs remain opaque and unchanged. Canvas routes do not require a prefix.
- `lib/studio/admin-overview.ts` and the overview component's display contract define daily metrics using `date: YYYY-MM-DD` in `Asia/Shanghai`. Overview aggregation uses those calendar boundaries and includes zero-count dates.
- `lib/studio/drama-link.ts` and `use-drama-project.ts`: client-side ID and handoff matching contracts only. Project summaries expose the same stored `sourceHandoffId` as project details so clients can resolve explicit links without deriving new globally unique IDs from user-supplied handoffs. Existing legacy ID inference remains a consumer compatibility concern.

Official protocol references consulted:

- https://developers.openai.com/api/reference/resources/images
- https://developers.openai.com/api/reference/resources/chat
- https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create
- https://developers.openai.com/api/reference/resources/videos/methods/create
- https://developers.openai.com/api/reference/resources/videos/methods/retrieve
- https://ffmpeg.org/ffmpeg-filters.html
- https://ffmpeg.org/ffmpeg.html

The adapters implement OpenAI-compatible Chat Completions, Images generation/edit, speech synthesis and asynchronous Videos protocols. This is a protocol implementation, not a guarantee that every model sold by a compatible third party supports every parameter. Channels with other protocols return unavailable and are never silently translated or simulated. Video submission uses multipart form data; video completion downloads the authenticated content endpoint and persists its bytes. Provider requests use the core public-address, DNS-pinned transport. Provider error bodies and keys never enter task output.

Image edit submissions preserve the consumer's optional `edit.operation` and
`edit.mask` fields. A mask may be an inline image data URL or an authenticated
media URL owned by the submitting account; external URLs and non-image masks are
rejected before debit. For OpenAI-compatible image-edit channels the owned mask
is sent as the standard multipart `mask` part alongside the source image. An
explicit `capabilityProfile.supportsMask: false` disables masked editing rather
than silently dropping the mask. The operation label remains task metadata and
does not invent unsupported provider parameters.

The queue is PostgreSQL-backed. Claims use `FOR UPDATE SKIP LOCKED`, leases and conditional ownership. A lost synchronous submission becomes a review case, retaining its debit; it is never resubmitted automatically. Polling jobs with a known upstream video identifier can be reclaimed safely. Queued cancellation refunds once. Cancellation after submission records intent and waits for a confirmed provider outcome; it does not promise unsupported upstream cancellation. Administrator review is audited and can attach a known upstream identifier, attach an owned real result, or confirm failure and refund.

Agent runs execute a real text planner that must return a bounded JSON plan of one to eight steps. The server validates capabilities, enabled selected models, unique step identifiers, selected owned assets, and references to earlier steps. The plan requires approval before child generation; each step creates a separately billed durable job with an idempotent identity. Earlier text results become bounded downstream prompt context, image results can become reference images, and completed outputs are persisted in the owner's library with run/step/task provenance. Pause prevents new steps and pauses queued jobs; active upstream work finishes normally before further steps are allowed. Cancellation records intent and never assumes a remote request was cancelled. Custom executable skills and vision chat remain unavailable. The run event records `executionMode: bounded-plan`.

Rendering requires installed FFmpeg and FFprobe executables (`FFMPEG_PATH` / `FFPROBE_PATH`, otherwise PATH), the subtitles filter, and H.264/AAC encoders. The renderer normalizes owned clips to the selected dimensions, duration, frame rate and audio layout; it preserves source audio, replaces it with owned voiceover audio or generates silence according to each shot. It burns bounded plain-text captions from generated SRT files, then persists the actual final MP4. Source byte totals, working files, final bytes, shot counts, total duration and process runtime are bounded. All external processes use argument arrays without a shell and restricted media protocols. Jianying draft export is unavailable. No rendering path produces a fake video or empty success archive.

Local media is stored under the configured media root using generated UUID keys, file signature validation, byte limits, authenticated owner reads and expiring capability links for upstream references. Reference/library/generated-result URLs use `/api/reference-assets/<key>` to match the consumer storage-key parser. Object storage is not implemented in the creative media adapter yet; enabling it explicitly blocks media uploads/generation before debit instead of silently using local storage. Historical imported logs live in their own `oaooao_generation_history` table; they are merged for display without becoming executable jobs. Provider endpoint and encrypted credentials are snapshotted together so later channel edits cannot send a new secret to an old destination.

All automated adapter and worker tests use synthetic users, isolated disposable PostgreSQL schemas, locally generated fixture bytes and injected synthetic provider responses. No model, payment, production database or real user account is contacted by these tests.

The creative routes cover canvas/drama project CRUD, optimistic saves and handoff creation; library CRUD; reference upload and authenticated media reads; text/image/video/audio create/query/cancel/recover; merged generation history; Agent create/list/query/events/actions/child retry; drama rendering and versions; and administrative generation overview, operations and audited review. The Jianying route is deliberately present with an unavailable response. Numeric entitlement limits for daily calls, generation counts and point spending are enforced. Arbitrary entitlement `features` strings remain stored display metadata because the supplied consumer contract does not define executable feature identifiers or their access rules.

## Capability restrictions, 2026-10-14

The original arbitrary `features` labels remain compatibility metadata. The later
`allowedGenerationKinds` field is a distinct executable policy controlling text,
image, video, audio and render tasks before provider calls or debit, including Agent
steps. Concurrent plan revocation and task creation serialize on the account row;
this does not retroactively change the original module author's provenance statement.
The current behavior and isolated regression scope are described in
[the integration audit](../docs/INTEGRATION-AUDIT-2026-10-14.md).

## Follow-up acceptance fixes, 2026-10-14

The coordinating implementer added prompt-skill selection and `src/agent-context.ts`
using this repository's existing Agent/project/library contracts and new synthetic
tests. Skill IDs are owner-checked before planning; prompt instructions remain
user context. Project context comes from the saved owner project, with bounded
JSON structure and inline-media omission. No upstream server code was opened or
used for these additions. The coordinator has prior upstream audit exposure, so
the original implementer's narrower no-exposure statement above does not extend
to this follow-up or establish a formally separated clean-room process.

The acceptance browser fixture uses an explicitly selected synthetic scenario,
test-only model adapters and an isolated database schema; it does not establish
live provider or payment acceptance. Public gallery follow-up provenance is
recorded separately in `docs/PUBLIC-GALLERY-PROVENANCE.md`.
