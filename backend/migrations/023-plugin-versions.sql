-- Installed versions are account preferences; project documents are untouched.
ALTER TABLE oaooao_account_plugins ADD COLUMN plugin_version text NOT NULL DEFAULT '';
ALTER TABLE oaooao_account_plugins ADD COLUMN auto_update boolean NOT NULL DEFAULT false;
-- Preserve the actual pre-upgrade director for existing installations.
UPDATE oaooao_account_plugins SET plugin_version='0.1.0' WHERE plugin_id='director';
