-- Independently authored account export preference and durable opt-out evidence.
CREATE TABLE oaooao_watermark_preferences (
  user_id text PRIMARY KEY REFERENCES oaooao_users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  acknowledged_policy_version text,
  acknowledged_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (enabled OR (acknowledged_policy_version IS NOT NULL AND acknowledged_at IS NOT NULL))
);
CREATE TABLE oaooao_watermark_events (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('preference_disabled','preference_enabled','export_without_label','export_with_label')),
  media_id text,
  policy_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  retain_until timestamptz NOT NULL DEFAULT now() + interval '6 months',
  CHECK (retain_until >= created_at + interval '6 months')
);
CREATE INDEX oaooao_watermark_events_user ON oaooao_watermark_events(user_id,created_at DESC);
CREATE INDEX oaooao_watermark_events_retention ON oaooao_watermark_events(retain_until);
