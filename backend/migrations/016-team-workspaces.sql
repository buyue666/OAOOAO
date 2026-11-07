CREATE TABLE oaooao_team_plans (
  id text PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT false,
  price_cents bigint CHECK(price_cents BETWEEN 1 AND 100000000),
  min_seats integer NOT NULL DEFAULT 2 CHECK(min_seats BETWEEN 2 AND 100),
  max_seats integer NOT NULL DEFAULT 20 CHECK(max_seats BETWEEN min_seats AND 100),
  reviewer_limit integer NOT NULL DEFAULT 10 CHECK(reviewer_limit BETWEEN 0 AND 500),
  points_per_seat numeric(20,4) NOT NULL DEFAULT 0 CHECK(points_per_seat>=0),
  credit_validity_days integer NOT NULL DEFAULT 30 CHECK(credit_validity_days BETWEEN 1 AND 365),
  storage_bytes bigint NOT NULL DEFAULT 10737418240 CHECK(storage_bytes BETWEEN 1 AND 1125899906842624),
  team_concurrency integer NOT NULL DEFAULT 3 CHECK(team_concurrency BETWEEN 1 AND 100),
  member_concurrency integer NOT NULL DEFAULT 1 CHECK(member_concurrency BETWEEN 1 AND team_concurrency),
  task_limit numeric(20,4) NOT NULL DEFAULT 1000 CHECK(task_limit>0),
  model_ids jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(model_ids)='array'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(NOT enabled OR price_cents IS NOT NULL)
);
INSERT INTO oaooao_team_plans(id,name,description) VALUES
 ('team-standard','团队标准','适合小型工作室，共享项目、素材与可控预算。'),
 ('team-pro','团队专业','适合稳定生产团队，按实际成本配置容量和并发。');

CREATE TABLE oaooao_teams (
  id text PRIMARY KEY,
  name text NOT NULL,
  owner_id text NOT NULL REFERENCES oaooao_users(id),
  seat_limit integer NOT NULL DEFAULT 2 CHECK(seat_limit BETWEEN 1 AND 100),
  reviewer_limit integer NOT NULL DEFAULT 5 CHECK(reviewer_limit BETWEEN 0 AND 500),
  storage_quota_bytes bigint NOT NULL DEFAULT 1073741824 CHECK(storage_quota_bytes>0),
  team_concurrency integer NOT NULL DEFAULT 3 CHECK(team_concurrency BETWEEN 1 AND 100),
  member_concurrency integer NOT NULL DEFAULT 1 CHECK(member_concurrency BETWEEN 1 AND team_concurrency),
  task_limit numeric(20,4) NOT NULL DEFAULT 1000 CHECK(task_limit>0),
  model_ids jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(model_ids)='array'),
  plan_id text REFERENCES oaooao_team_plans(id),
  subscription_expires_at timestamptz,
  transfer_to text REFERENCES oaooao_users(id),
  transfer_expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE oaooao_team_members (
  team_id text NOT NULL REFERENCES oaooao_teams(id),
  user_id text NOT NULL REFERENCES oaooao_users(id),
  role text NOT NULL CHECK(role IN ('owner','admin','creator','reviewer')),
  monthly_limit numeric(20,4) CHECK(monthly_limit>=0),
  can_download boolean NOT NULL DEFAULT false,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(team_id,user_id)
);
CREATE UNIQUE INDEX oaooao_team_single_owner ON oaooao_team_members(team_id) WHERE role='owner';
CREATE INDEX oaooao_team_member_lookup ON oaooao_team_members(user_id,team_id);
CREATE TABLE oaooao_team_invitations (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES oaooao_teams(id),
  token_hash text NOT NULL UNIQUE,
  role text NOT NULL CHECK(role IN ('admin','creator','reviewer')),
  email text,
  target_user_id text REFERENCES oaooao_users(id),
  invited_by text NOT NULL REFERENCES oaooao_users(id),
  accepted_by text REFERENCES oaooao_users(id),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(email IS NULL OR target_user_id IS NULL)
);
CREATE INDEX oaooao_team_pending_invites ON oaooao_team_invitations(team_id,expires_at) WHERE accepted_at IS NULL AND revoked_at IS NULL;
CREATE TABLE oaooao_team_projects (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES oaooao_teams(id),
  created_by text NOT NULL REFERENCES oaooao_users(id),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  visibility text NOT NULL DEFAULT 'restricted' CHECK(visibility IN ('team','restricted')),
  document jsonb NOT NULL DEFAULT '{}',
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(id,team_id)
);
CREATE TABLE oaooao_team_project_members (
  project_id text NOT NULL,
  team_id text NOT NULL,
  user_id text NOT NULL,
  PRIMARY KEY(project_id,user_id),
  FOREIGN KEY(project_id,team_id) REFERENCES oaooao_team_projects(id,team_id) ON DELETE CASCADE,
  FOREIGN KEY(team_id,user_id) REFERENCES oaooao_team_members(team_id,user_id) ON DELETE CASCADE
);
CREATE TABLE oaooao_team_assets (
  id text PRIMARY KEY,
  team_id text NOT NULL,
  project_id text NOT NULL,
  created_by text NOT NULL REFERENCES oaooao_users(id),
  title text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('text','image','video','audio')),
  text_content text,
  mime_type text NOT NULL,
  byte_count bigint NOT NULL CHECK(byte_count>=0),
  sha256 text,
  storage_backend text NOT NULL CHECK(storage_backend IN ('local','s3','text')),
  storage_location jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','ready','deleting')),
  source_asset_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY(project_id,team_id) REFERENCES oaooao_team_projects(id,team_id)
);
CREATE INDEX oaooao_team_assets_project ON oaooao_team_assets(team_id,project_id,created_at DESC,id);
CREATE TABLE oaooao_team_credit_batches (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES oaooao_teams(id),
  source text NOT NULL CHECK(source IN ('subscription','topup','adjustment')),
  grant_key text NOT NULL UNIQUE,
  original_amount numeric(20,4) NOT NULL CHECK(original_amount>0),
  remaining_amount numeric(20,4) NOT NULL CHECK(remaining_amount>=0 AND remaining_amount<=original_amount),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oaooao_team_credit_expiry ON oaooao_team_credit_batches(team_id,expires_at,id);
CREATE TABLE oaooao_team_credit_operations (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES oaooao_teams(id),
  actor_id text NOT NULL REFERENCES oaooao_users(id),
  kind text NOT NULL CHECK(kind IN ('grant','debit','refund')),
  amount numeric(20,4) NOT NULL,
  budget_delta numeric(20,4) NOT NULL DEFAULT 0,
  budget_month date,
  job_id text,
  refund_of text UNIQUE REFERENCES oaooao_team_credit_operations(id),
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX oaooao_team_budget_cycle ON oaooao_team_credit_operations(team_id,actor_id,budget_month);
CREATE TABLE oaooao_team_credit_allocations (
  operation_id text NOT NULL REFERENCES oaooao_team_credit_operations(id),
  batch_id text NOT NULL REFERENCES oaooao_team_credit_batches(id),
  delta numeric(20,4) NOT NULL,
  PRIMARY KEY(operation_id,batch_id)
);
CREATE TABLE oaooao_team_events (
  id bigserial PRIMARY KEY,
  team_id text NOT NULL REFERENCES oaooao_teams(id),
  actor_id text NOT NULL REFERENCES oaooao_users(id),
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX oaooao_team_events_order ON oaooao_team_events(team_id,id DESC);

ALTER TABLE oaooao_generation_jobs ADD COLUMN team_id text REFERENCES oaooao_teams(id);
ALTER TABLE oaooao_generation_jobs ADD COLUMN team_project_id text;
ALTER TABLE oaooao_generation_jobs ADD CONSTRAINT oaooao_job_team_project FOREIGN KEY(team_project_id,team_id) REFERENCES oaooao_team_projects(id,team_id);
ALTER TABLE oaooao_generation_jobs ADD CONSTRAINT oaooao_job_scope CHECK((team_id IS NULL)=(team_project_id IS NULL));
CREATE INDEX oaooao_team_jobs_project ON oaooao_generation_jobs(team_id,team_project_id,created_at DESC) WHERE team_id IS NOT NULL;
