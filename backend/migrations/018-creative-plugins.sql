-- Installation is an account preference, independent of project ownership.
-- Removing a plugin never cascades to projects, assets or generation records.
CREATE TABLE oaooao_account_plugins (
 user_id text NOT NULL REFERENCES oaooao_users(id),
 plugin_id text NOT NULL,
 installed_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id, plugin_id)
);
