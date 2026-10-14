-- Independently authored for the OAOOAO manual check-in contract.
-- Separate from the automatically refreshed UTC daily wallet allowance.
CREATE TABLE oaooao_check_ins (
  user_id text NOT NULL REFERENCES oaooao_users(id) ON DELETE RESTRICT,
  claim_date date NOT NULL,
  reward_points integer NOT NULL CHECK (reward_points BETWEEN 1 AND 1000000),
  operation_id text NOT NULL UNIQUE REFERENCES oaooao_wallet_operations(operation_id) DEFERRABLE INITIALLY DEFERRED,
  claimed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (user_id, claim_date)
);
