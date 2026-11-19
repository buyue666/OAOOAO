-- Subscription products can define fractional rewards. Historical claims retain their amounts.
ALTER TABLE oaooao_check_ins
  DROP CONSTRAINT oaooao_check_ins_reward_points_check,
  ALTER COLUMN reward_points TYPE numeric(20,4),
  ADD CONSTRAINT oaooao_check_ins_reward_points_check CHECK (reward_points > 0);
