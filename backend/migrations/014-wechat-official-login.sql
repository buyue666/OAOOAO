CREATE TABLE oaooao_wechat_identities (
  app_id text NOT NULL,
  open_id text NOT NULL,
  user_id text NOT NULL REFERENCES oaooao_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(app_id,open_id),
  UNIQUE(app_id,user_id)
);
CREATE TABLE oaooao_wechat_login_sessions (
  id text PRIMARY KEY,
  app_id text NOT NULL,
  provider_fingerprint text NOT NULL,
  scene_key text NOT NULL UNIQUE,
  browser_hash text NOT NULL,
  purpose text NOT NULL CHECK(purpose IN ('login','binding')),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','authorized','unlinked','consumed')),
  open_id text,
  user_id text REFERENCES oaooao_users(id) ON DELETE CASCADE,
  owner_auth_hash text,
  owner_password_hash text,
  policy_accepted boolean NOT NULL DEFAULT false,
  return_to text NOT NULL,
  login_token_ciphertext text,
  login_token_hash text,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oaooao_wechat_login_expiry ON oaooao_wechat_login_sessions(expires_at);
CREATE INDEX oaooao_wechat_login_identity ON oaooao_wechat_login_sessions(app_id,open_id);
