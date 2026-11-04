# Video capabilities and pricing

Each logical model binding can declare its video options in `capabilityProfile`.
The admin editor, public model list, quote endpoint and generation submission use
the same saved rules. This module contains no deployment-specific provider catalog.

- `videoBillingUnit`: `second`, `request`, or `duration`.
- `videoPricing.resolutionRates`: points per second or request for each resolution.
- `videoPricing.durationRates`: exact resolution → seconds → points per request.
- `videoDurationRules`: a `range` (`min`, `max`, `step`) or a `list` (`values`) per resolution.
- `supportsFirstFrame` and `supportsLastFrame`: explicit switches; a last frame requires a first frame.
- `videoReferenceRules`: `maxCount`, `freeCount`, `maxItemSeconds`, `maxTotalSeconds` for each of `image`, `video`, and `audio`.
- `videoPricing.extraImage`, `extraVideo`, `extraAudio`: points per reference beyond its free allowance. `referenceVideoPerSecond` and `referenceAudioPerSecond` optionally add duration charges for billed references.
- `videoReferenceFieldMap`: multipart field names for `first_frame`, `last_frame`, `image`, `video`, `audio`. A first frame/image defaults to `input_reference`; other roles require an explicit upstream field name.

A zero quantity/time limit adds no restriction beyond native/provider limits.
A zero free count gives no free allowance. A zero price explicitly means free;
an absent required price blocks the request. Resolution and exact-duration prices
can stand alone without a fallback base price. Money uses the wallet's four-decimal
integer precision, with duration charges rounded up to that precision.

`POST /api/video-generation-tasks/quote` requires a session and accepts the same
`config`, `references`, and project `context` as submission. It returns
`{ points, estimated: true }`, validates media ownership and actual duration, and
creates no job, wallet operation, or provider request. Local FFprobe is required
when video/audio references must be inspected. Quotes may publish temporary
reference uploads through the existing authenticated upload route.

Continuous seconds are shown compactly as `4-30 秒`; discrete presets retain
their gaps, such as `4、6、8 秒`. The editor accepts `4-30` directly.

Models without an enabled, authenticated binding are disabled and omitted from
the public catalog. Availability recovers when a saved binding becomes usable;
explicitly disabled models remain disabled. Deleting a channel removes only its
inherited bindings in the settings transaction and preserves model definitions,
prices and historical jobs. Explicit dangling bindings are rejected.

An entry request alias selects its binding directly. A logical model alias uses
the model's routing priorities. A display name only affects the interface.
