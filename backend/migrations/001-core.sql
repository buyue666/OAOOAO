CREATE TABLE IF NOT EXISTS oaooao_users (
  id text PRIMARY KEY,
  username text NOT NULL,
  email text,
  display_name text NOT NULL DEFAULT '',
  bio text NOT NULL DEFAULT '',
  avatar_url text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
  admin_permissions jsonb NOT NULL DEFAULT '[]',
  enabled boolean NOT NULL DEFAULT true,
  password_hash text NOT NULL,
  email_verified boolean NOT NULL DEFAULT false,
  plan_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  policy_accepted_at timestamptz,
  CHECK (jsonb_typeof(admin_permissions) = 'array')
);
CREATE UNIQUE INDEX IF NOT EXISTS oaooao_users_username_uq ON oaooao_users(lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS oaooao_users_email_uq ON oaooao_users(lower(email)) WHERE email IS NOT NULL;
CREATE TABLE IF NOT EXISTS oaooao_sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES oaooao_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS oaooao_sessions_user_idx ON oaooao_sessions(user_id);
CREATE INDEX IF NOT EXISTS oaooao_sessions_expiry_idx ON oaooao_sessions(expires_at);
CREATE TABLE IF NOT EXISTS oaooao_email_codes (
  id text PRIMARY KEY,
  email text NOT NULL,
  purpose text NOT NULL CHECK(purpose IN ('register','email-change','password-reset')),
  user_id text REFERENCES oaooao_users(id) ON DELETE CASCADE,
  code_hash text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  sent_at timestamptz,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oaooao_email_codes_lookup_idx ON oaooao_email_codes(email,purpose,created_at DESC);
CREATE TABLE IF NOT EXISTS oaooao_settings (
  id text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO oaooao_settings(id) VALUES ('global'),('object-storage') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS oaooao_audit_logs (
  id text PRIMARY KEY,
  actor_id text,
  action text NOT NULL,
  target_type text,
  target_id text,
  status text NOT NULL DEFAULT 'success',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS oaooao_audit_logs_created_idx ON oaooao_audit_logs(created_at DESC);
CREATE TABLE IF NOT EXISTS oaooao_rate_limits (
  key text PRIMARY KEY,
  count integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS oaooao_announcements (
  id text PRIMARY KEY,
  title text NOT NULL,
  content text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  popup_home boolean NOT NULL DEFAULT false,
  popup_after_login boolean NOT NULL DEFAULT false,
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
