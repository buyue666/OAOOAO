# Optional creative tools

Creative tool installation is a preference of the authenticated account. It does
not grant model, billing, project or team permissions. Existing resource APIs
continue to enforce ownership, membership and quotes independently.

- `GET /api/account/plugins` returns `{installedPlugins: string[]}`.
- `PATCH /api/account/plugins` accepts `{pluginId: string, installed: boolean}`
  and returns the confirmed installed IDs. The server rejects unknown IDs,
  non-boolean state and extra fields; callers cannot choose another account.
- Authenticated sessions include `settings.installedPlugins`, avoiding an extra
  startup request. Creative Assistant (`agent`) and Open canvas (`canvas`) are
  installed by default; the other tools remain opt-in.
- Changes lock the account row in a transaction. Installing 3D Director also
  installs Open canvas; removing Open canvas removes its dependent director.
  Repeated requests are idempotent, and concurrent toggles retain unrelated IDs.
- Migration `018-creative-plugins.sql` adds only the account installation table.
  Uninstall deletes preference rows; it never deletes or modifies creative data.
- Migration `019-default-creative-plugins.sql` adds these two defaults to existing
  accounts once, preserving other installations and their original timestamps.
  An account-insert trigger seeds the same defaults for all future account
  creation paths, within the account transaction. GET/session reads, profile
  updates and migration reruns never reinstall a tool the user has removed.

The client catalog contains metadata only. Tool pages use client-side dynamic
imports behind installation gates, and their links disable Next.js prefetching.
Image recreation and AI try-on have separate modules. Agent, drama and canvas
load only when entered; 3D code and models load when the director desk is opened.
Uninstalled canvas routes check the account preference before server data reads.
Home project queries are skipped when their tools are absent. Project management
may still read existing project summaries on explicit entry.

Installation state is confirmed by the server before a tool can mount. Pending
changes prevent repeated clicks; failed saves retain the last confirmed state.
Late responses cannot update another account. Browser-tab notices trigger a
preference refresh and contain no installation data or credentials.

Only reviewed tools bundled with the application are supported. This interface
does not download or execute arbitrary third-party JavaScript. Built-in plugin
versions follow the application release; installation is not a separate purchase
and existing generation charges continue to apply.
