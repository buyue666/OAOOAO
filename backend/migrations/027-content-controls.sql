CREATE TABLE oaooao_content_preferences (
 user_id text PRIMARY KEY REFERENCES oaooao_users(id),
 adult_enabled boolean NOT NULL DEFAULT false,
 acknowledged_policy_version text,
 age_declared_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK (NOT adult_enabled OR (acknowledged_policy_version IS NOT NULL AND age_declared_at IS NOT NULL))
);
ALTER TABLE oaooao_creative_references ADD COLUMN adult_content boolean NOT NULL DEFAULT false;
-- Mark the reviewed categories without making the previously disabled rows visible.
-- The deployment restores only the exact private review manifest after the old backend stops.
UPDATE oaooao_creative_references SET adult_content=true WHERE role='pose' AND
 (style IN ('全身单人・性感系','双人缠绵') OR title ~ '挤胸|托胸|捧胸|揉胸|抚胸|挺胸|胸部|胸口视角|胸前沟壑|褪下肩带|解挂钩|胸伏|胸下缘|遮掩|遮蔽|前臂竖立|双臂于胸下|双手自下托起|指尖遮掩|双手向内挤|大腿内侧|手指含于唇边|四肢着地');
-- Administrator policy now decides whether an opt-out requires acknowledgment.
ALTER TABLE oaooao_watermark_preferences DROP CONSTRAINT oaooao_watermark_preferences_check;
