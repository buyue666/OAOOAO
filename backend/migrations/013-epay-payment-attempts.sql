-- Additive provider binding; no existing orders, balances, or provider settings are changed.
CREATE TABLE oaooao_payment_attempts (
  order_id text PRIMARY KEY REFERENCES oaooao_orders(id) ON DELETE RESTRICT,
  provider text NOT NULL CHECK (provider = 'epay'),
  encrypted_config text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
