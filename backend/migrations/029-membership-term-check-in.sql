ALTER TABLE oaooao_credit_batches
  ADD COLUMN membership_assignment_at timestamptz,
  ADD CONSTRAINT oaooao_credit_batches_expiry_basis
    CHECK (membership_assignment_at IS NULL OR expires_at='9999-12-31T00:00:00Z'::timestamptz);
CREATE INDEX oaooao_credit_batches_active_assignment ON oaooao_credit_batches(user_id)
  WHERE expired_at IS NULL AND membership_assignment_at IS NOT NULL;

-- Align still-live membership rewards with the original term without reviving expired batches.
WITH terms AS (
  SELECT b.id, c.operation_id, c.claimed_at, b.created_at,
    CASE WHEN w.metadata ? 'membershipOrderId'
      THEN coalesce(least(g.expires_at, g.revoked_at), now()) ELSE now() END AS end_at,
    a.assigned_at AS assignment_at
  FROM oaooao_credit_batches b
  JOIN oaooao_wallet_operations w ON w.operation_id=b.grant_operation_id
  JOIN oaooao_check_ins c ON c.operation_id=w.operation_id
  LEFT JOIN oaooao_plan_grants g ON g.user_id=b.user_id AND g.order_id=w.metadata->>'membershipOrderId'
  LEFT JOIN oaooao_admin_plan_assignments a ON a.user_id=b.user_id
    AND NOT (w.metadata ? 'membershipOrderId') AND a.plan_id=c.rule_plan_id AND a.assigned_at<=b.created_at
  WHERE b.expired_at IS NULL AND b.expires_at>now() AND w.metadata->>'rewardSource'='membership'
), updated AS (
  UPDATE oaooao_credit_batches b SET membership_assignment_at=t.assignment_at,
    expires_at=CASE WHEN t.assignment_at IS NOT NULL THEN '9999-12-31T00:00:00Z'::timestamptz ELSE greatest(t.end_at,greatest(t.claimed_at,t.created_at)+interval '1 microsecond') END
  FROM terms t WHERE b.id=t.id RETURNING t.operation_id,t.claimed_at,CASE WHEN t.assignment_at IS NULL THEN b.expires_at END AS expires_at
)
UPDATE oaooao_check_ins c SET expires_at=u.expires_at,
  validity_days=CASE WHEN u.expires_at IS NULL THEN 0 ELSE least(3650,greatest(1,ceil(extract(epoch FROM (u.expires_at-u.claimed_at))/86400)::int)) END
FROM updated u WHERE c.operation_id=u.operation_id;
