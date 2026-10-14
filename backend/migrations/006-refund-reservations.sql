-- Durable manual-refund preparation. No automatic release can race an external transfer.
CREATE TABLE oaooao_refund_reservations (
 id text PRIMARY KEY,
 order_id text NOT NULL REFERENCES oaooao_orders(id),
 status text NOT NULL CHECK(status IN ('prepared','confirmed','canceled')),
 amount_cents bigint NOT NULL CHECK(amount_cents>=0),
 currency text NOT NULL,
 holds jsonb NOT NULL CHECK(jsonb_typeof(holds)='array'),
 reason text NOT NULL,
 prepared_by text NOT NULL REFERENCES oaooao_users(id),
 prepared_at timestamptz NOT NULL DEFAULT now(),
 resolved_by text REFERENCES oaooao_users(id),
 resolved_at timestamptz,
 resolution_reason text,
 CHECK((status='prepared' AND resolved_at IS NULL) OR (status<>'prepared' AND resolved_at IS NOT NULL))
);
CREATE UNIQUE INDEX oaooao_one_active_refund ON oaooao_refund_reservations(order_id) WHERE status='prepared';
CREATE INDEX oaooao_refund_history ON oaooao_refund_reservations(order_id,prepared_at DESC);
