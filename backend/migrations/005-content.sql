-- Independently authored moderation metadata. No historical source tables are reused.
CREATE TABLE oaooao_works (
 id text PRIMARY KEY,
 author_user_id text NOT NULL REFERENCES oaooao_users(id),
 source_project_id text REFERENCES oaooao_projects(id) ON DELETE SET NULL,
 current_version_id text,
 moderation_status text NOT NULL DEFAULT 'pending' CHECK(moderation_status IN ('pending','approved','rejected')),
 lifecycle_status text NOT NULL DEFAULT 'draft' CHECK(lifecycle_status IN ('draft','published','taken_down','deleted')),
 featured boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 CHECK(NOT featured OR (moderation_status='approved' AND lifecycle_status='published'))
);
CREATE TABLE oaooao_work_versions (
 id text PRIMARY KEY,
 work_id text NOT NULL REFERENCES oaooao_works(id),
 title text NOT NULL,
 summary text NOT NULL DEFAULT '',
 cover_url text NOT NULL DEFAULT '',
 preview_url text NOT NULL DEFAULT '',
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 review_reason text NOT NULL DEFAULT '',
 reviewed_by text REFERENCES oaooao_users(id),
 reviewed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 UNIQUE(work_id,id)
);
ALTER TABLE oaooao_works ADD CONSTRAINT oaooao_work_current_version
 FOREIGN KEY(id,current_version_id) REFERENCES oaooao_work_versions(work_id,id);
CREATE INDEX oaooao_works_moderation ON oaooao_works(moderation_status,lifecycle_status,updated_at DESC,id);
CREATE INDEX oaooao_works_author ON oaooao_works(author_user_id,created_at DESC,id);
CREATE TABLE oaooao_work_cases (
 id text PRIMARY KEY,
 work_id text NOT NULL REFERENCES oaooao_works(id),
 version_id text,
 kind text NOT NULL,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
 reason text NOT NULL,
 decision text,
 resolution text,
 created_by text REFERENCES oaooao_users(id),
 resolved_by text REFERENCES oaooao_users(id),
 created_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
 resolved_at timestamptz,
 FOREIGN KEY(work_id,version_id) REFERENCES oaooao_work_versions(work_id,id),
 CHECK((status='open' AND resolved_at IS NULL AND decision IS NULL) OR
       (status='resolved' AND resolved_at IS NOT NULL AND decision IS NOT NULL))
);
CREATE INDEX oaooao_work_cases_listing ON oaooao_work_cases(created_at DESC,id);
