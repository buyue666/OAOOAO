ALTER TABLE oaooao_team_plans ADD COLUMN display jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(display)='object');
