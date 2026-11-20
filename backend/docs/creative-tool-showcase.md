# Creative tool availability and presentation

`creativeTools` is a global settings map keyed by the known tool IDs. Missing values keep existing tools open and use their catalog text and default covers. Settings writes require `system.manage`, validate only the submitted tool rows and are audited through the existing settings transaction. Model, credit, channel and payment configuration is never reserialized by an unrelated showcase edit.

Cards consume a small authenticated no-store endpoint and no tool implementation or reference catalog. Client entry gates and server submission checks enforce closed tools. Existing downloads, task polling, cancellation, project reads and document saving continue to work. Director access also depends on canvas availability. Team capability and wallet checks are unchanged.

Administrative uploads accept sniffed raster images (6 MiB) or MP4/WebM (25 MiB) and write a dedicated object-storage prefix, independent of personal asset quotas. Uploaded records are stored separately from the global settings record. Only explicitly selected showcase media becomes publicly readable; unpublished uploads require an administrator. Arbitrary user media URLs are not accepted as same-site published paths. External HTTPS presentation URLs are rendered by the client and never fetched by the application server.

Media supports hover zoom, bounded carousel, comparison and hover video. Reduced motion, page visibility and intersection observers limit automatic activity. All effect controls are native keyboard controls. Versions and manual rollback remain independent of tool availability.
