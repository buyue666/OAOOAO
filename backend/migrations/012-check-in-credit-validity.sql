-- Independently authored: additive expiring reward batches; existing credits stay permanent.
ALTER TABLE oaooao_wallet_operations
  ADD COLUMN timed_delta numeric(20,4) NOT NULL DEFAULT 0,
  ADD COLUMN timed_after numeric(20,4) NOT NULL DEFAULT 0 CHECK (timed_after >= 0);

CREATE TABLE oaooao_credit_batches (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES oaooao_users(id) ON DELETE RESTRICT,
  grant_operation_id text NOT NULL UNIQUE REFERENCES oaooao_wallet_operations(operation_id) DEFERRABLE INITIALLY DEFERRED,
  original_amount numeric(20,4) NOT NULL CHECK (original_amount > 0),
  remaining_amount numeric(20,4) NOT NULL CHECK (remaining_amount >= 0 AND remaining_amount <= original_amount),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  expired_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK (expired_at IS NULL OR remaining_amount = 0)
);
CREATE INDEX oaooao_credit_batches_available ON oaooao_credit_batches(user_id,expires_at,id) WHERE expired_at IS NULL;
CREATE INDEX oaooao_credit_batches_due ON oaooao_credit_batches(expires_at,user_id) WHERE expired_at IS NULL;

CREATE TABLE oaooao_wallet_batch_allocations (
  operation_id text NOT NULL REFERENCES oaooao_wallet_operations(operation_id) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  batch_id text NOT NULL REFERENCES oaooao_credit_batches(id) ON DELETE RESTRICT,
  delta numeric(20,4) NOT NULL CHECK (delta <> 0),
  PRIMARY KEY (operation_id,batch_id)
);

ALTER TABLE oaooao_check_ins
  ADD COLUMN validity_days integer NOT NULL DEFAULT 0 CHECK (validity_days BETWEEN 0 AND 3650),
  ADD COLUMN expires_at timestamptz,
  ADD COLUMN rule_plan_id text,
  ADD COLUMN rule_plan_name text,
  ADD CONSTRAINT oaooao_check_ins_validity CHECK ((validity_days = 0 AND expires_at IS NULL) OR (validity_days > 0 AND expires_at > claimed_at));
