-- Per-account defaults and durable media location/deletion state.
ALTER TABLE oaooao_users ADD COLUMN storage_quota_bytes bigint
 CHECK (storage_quota_bytes IS NULL OR storage_quota_bytes BETWEEN 0 AND 1125899906842624);
CREATE TABLE oaooao_account_preferences (
 user_id text PRIMARY KEY REFERENCES oaooao_users(id),
 default_models jsonb NOT NULL DEFAULT '{}',
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE oaooao_media ADD COLUMN storage_backend text NOT NULL DEFAULT 'local'
 CHECK (storage_backend IN ('local','s3'));
ALTER TABLE oaooao_media ADD COLUMN storage_location jsonb NOT NULL DEFAULT '{}';
ALTER TABLE oaooao_media ADD COLUMN delete_requested_at timestamptz;
CREATE INDEX oaooao_media_cleanup ON oaooao_media(expires_at) WHERE persistent=false;
