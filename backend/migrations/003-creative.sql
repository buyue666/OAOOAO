-- Independently authored project, media and durable generation schema.
CREATE TABLE oaooao_projects (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES oaooao_users(id),
 kind text NOT NULL CHECK(kind IN ('canvas','drama')), title text NOT NULL,
 source_handoff_id text, document jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 UNIQUE(user_id,kind,source_handoff_id)
);
CREATE INDEX oaooao_projects_owner ON oaooao_projects(user_id,kind,updated_at DESC);
CREATE TABLE oaooao_project_versions (
 id text PRIMARY KEY, project_id text NOT NULL REFERENCES oaooao_projects(id) ON DELETE CASCADE,
 version integer NOT NULL, reason text NOT NULL, document jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(project_id,version)
);
CREATE TABLE oaooao_generation_history (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES oaooao_users(id),
 document jsonb NOT NULL, created_at timestamptz NOT NULL
);
CREATE INDEX oaooao_history_owner ON oaooao_generation_history(user_id,created_at DESC,id);
CREATE TABLE oaooao_media (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES oaooao_users(id),
 mime_type text NOT NULL, byte_count integer NOT NULL CHECK(byte_count>0), sha256 text NOT NULL,
 persistent boolean NOT NULL DEFAULT false, access_token_hash text,
 expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oaooao_media_owner ON oaooao_media(user_id,created_at DESC);
CREATE TABLE oaooao_library_assets (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES oaooao_users(id),
 kind text NOT NULL CHECK(kind IN ('text','image','video','audio')), document jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp())
);
CREATE INDEX oaooao_library_owner ON oaooao_library_assets(user_id,created_at DESC);
CREATE TABLE oaooao_generation_jobs (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES oaooao_users(id),
 kind text NOT NULL CHECK(kind IN ('text','image','video','audio','render')),
 client_request_id text NOT NULL, attempt_no integer NOT NULL DEFAULT 1 CHECK(attempt_no>0),
 input_hash text NOT NULL, input jsonb NOT NULL, model text NOT NULL,
 channel_id text, upstream_model text, provider_config jsonb NOT NULL DEFAULT '{}',
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','paused','success','error','cancelled')),
 phase text NOT NULL DEFAULT 'queued' CHECK(phase IN ('queued','submitting','polling','review','complete')),
 cost numeric(20,4) NOT NULL CHECK(cost>=0), result jsonb, error text,
 upstream_id text, needs_review boolean NOT NULL DEFAULT false, cancel_requested boolean NOT NULL DEFAULT false,
 lease_owner text, lease_until timestamptz, next_poll_at timestamptz NOT NULL DEFAULT now(),
 started_at timestamptz, finished_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 UNIQUE(user_id,kind,client_request_id,attempt_no)
);
CREATE INDEX oaooao_jobs_queue ON oaooao_generation_jobs(next_poll_at,created_at) WHERE status IN ('pending','running');
CREATE INDEX oaooao_jobs_owner ON oaooao_generation_jobs(user_id,created_at DESC);
CREATE TABLE oaooao_agent_runs (
 id text PRIMARY KEY, user_id text NOT NULL REFERENCES oaooao_users(id),
 client_request_id text NOT NULL, input_hash text NOT NULL, input jsonb NOT NULL,
 job_id text NOT NULL REFERENCES oaooao_generation_jobs(id),
 state text NOT NULL DEFAULT 'planning' CHECK(state IN ('planning','awaiting_approval','running','paused','completed','failed','cancelled')),
 plan jsonb, failure text, approved_at timestamptz, cancel_requested boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,client_request_id)
);
CREATE TABLE oaooao_agent_steps (
 run_id text NOT NULL REFERENCES oaooao_agent_runs(id) ON DELETE CASCADE,
 step_id text NOT NULL, position integer NOT NULL, specification jsonb NOT NULL,
 job_id text REFERENCES oaooao_generation_jobs(id), asset_ids jsonb NOT NULL DEFAULT '[]',
 PRIMARY KEY(run_id,step_id), UNIQUE(run_id,position)
);
CREATE TABLE oaooao_agent_events (
 id bigserial PRIMARY KEY, run_id text NOT NULL REFERENCES oaooao_agent_runs(id) ON DELETE CASCADE,
 event_type text NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oaooao_agent_events_run ON oaooao_agent_events(run_id,id);
