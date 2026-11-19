-- Temporary export copies are operational cache, separate from user assets/quota.
-- Keep cleanup records after source/account removal so R2 objects cannot be orphaned.
CREATE TABLE oaooao_media_downloads (
  id text PRIMARY KEY,
  cache_key text NOT NULL UNIQUE,
  user_id text NOT NULL,
  media_id text NOT NULL,
  storage_location jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('preparing','ready','failed','deleting')),
  mime_type text NOT NULL,
  byte_count bigint NOT NULL DEFAULT 0 CHECK (byte_count >= 0),
  lease_until timestamptz NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oaooao_media_downloads_cleanup ON oaooao_media_downloads(expires_at);
CREATE INDEX oaooao_media_downloads_owner ON oaooao_media_downloads(user_id,media_id);
