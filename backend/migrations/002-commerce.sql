-- Independently authored from OAOOAO client contracts and SPECIFICATION.md.
CREATE TABLE oaooao_wallets (
  user_id text PRIMARY KEY REFERENCES oaooao_users(id) ON DELETE RESTRICT,
  permanent_balance numeric(20,4) NOT NULL DEFAULT 0 CHECK (permanent_balance >= 0),
  daily_balance numeric(20,4) NOT NULL DEFAULT 0 CHECK (daily_balance >= 0),
  daily_allowance numeric(20,4) NOT NULL DEFAULT 0 CHECK (daily_allowance >= 0),
  daily_spent numeric(20,4) NOT NULL DEFAULT 0 CHECK (daily_spent >= 0),
  daily_expires_at timestamptz,
  daily_refresh_date date,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE oaooao_wallet_operations (
  operation_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES oaooao_wallets(user_id),
  requested_delta numeric(20,4) NOT NULL,
  permanent_delta numeric(20,4) NOT NULL,
  daily_delta numeric(20,4) NOT NULL,
  permanent_after numeric(20,4) NOT NULL,
  daily_after numeric(20,4) NOT NULL,
  daily_expires_at timestamptz,
  refund_of text UNIQUE REFERENCES oaooao_wallet_operations(operation_id),
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oaooao_wallet_history ON oaooao_wallet_operations(user_id,created_at DESC,operation_id);
CREATE TABLE oaooao_products (
  id text PRIMARY KEY,
  product_kind text NOT NULL CHECK(product_kind IN ('points','plan')),
  plan_id text,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  amount_cents bigint NOT NULL CHECK(amount_cents >= 0 AND amount_cents <= 9007199254740991),
  currency text NOT NULL DEFAULT 'CNY' CHECK(currency ~ '^[A-Z]{3}$'),
  points_amount numeric(20,4) NOT NULL DEFAULT 0 CHECK(points_amount >= 0),
  daily_points numeric(20,4) NOT NULL DEFAULT 0 CHECK(daily_points >= 0),
  period_days integer NOT NULL DEFAULT 0 CHECK(period_days >= 0),
  enabled boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp())
);
CREATE TABLE oaooao_promotions (
  id text PRIMARY KEY,
  name text NOT NULL,
  label text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT false,
  starts_at timestamptz,
  ends_at timestamptz,
  products jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
  CHECK(ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE TABLE oaooao_coupon_templates (
  id text PRIMARY KEY,
  name text NOT NULL,
  discount_type text NOT NULL CHECK(discount_type IN ('fixed','percentage')),
  discount_value bigint NOT NULL CHECK(discount_value > 0),
  min_amount_cents bigint NOT NULL DEFAULT 0 CHECK(min_amount_cents >= 0),
  max_discount_cents bigint NOT NULL DEFAULT 0 CHECK(max_discount_cents >= 0),
  total_quantity integer NOT NULL DEFAULT 0 CHECK(total_quantity >= 0),
  claimed_quantity integer NOT NULL DEFAULT 0 CHECK(claimed_quantity >= 0),
  per_user_limit integer NOT NULL DEFAULT 1 CHECK(per_user_limit > 0),
  enabled boolean NOT NULL DEFAULT false,
  starts_at timestamptz,
  ends_at timestamptz,
  product_ids jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
  CHECK(discount_type <> 'percentage' OR discount_value <= 100),
  CHECK(ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);
CREATE TABLE oaooao_orders (
  id text PRIMARY KEY,
  order_no text NOT NULL UNIQUE,
  user_id text NOT NULL REFERENCES oaooao_users(id),
  product_id text NOT NULL REFERENCES oaooao_products(id),
  product_kind text NOT NULL,
  plan_id text,
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','paid','closed','canceled','refunding','refunded')),
  quantity integer NOT NULL CHECK(quantity > 0 AND quantity <= 100),
  list_amount_cents bigint NOT NULL CHECK(list_amount_cents >= 0),
  promotion_discount_cents bigint NOT NULL DEFAULT 0 CHECK(promotion_discount_cents >= 0),
  coupon_discount_cents bigint NOT NULL DEFAULT 0 CHECK(coupon_discount_cents >= 0),
  amount_cents bigint NOT NULL CHECK(amount_cents >= 0),
  currency text NOT NULL,
  points_amount numeric(20,4) NOT NULL CHECK(points_amount >= 0),
  daily_points numeric(20,4) NOT NULL CHECK(daily_points >= 0),
  period_days integer NOT NULL CHECK(period_days >= 0),
  provider text NOT NULL,
  provider_order_id text,
  request_key text,
  request_fingerprint text,
  expires_at timestamptz NOT NULL,
  closed_at timestamptz,
  paid_at timestamptz,
  refunded_at timestamptz,
  pricing_snapshot jsonb NOT NULL DEFAULT '{}',
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT date_trunc('milliseconds',clock_timestamp()),
  UNIQUE(user_id,request_key),
  CHECK(amount_cents = list_amount_cents - promotion_discount_cents - coupon_discount_cents)
);
CREATE INDEX oaooao_orders_user ON oaooao_orders(user_id,created_at DESC,id);
CREATE TABLE oaooao_coupons (
  id text PRIMARY KEY,
  template_id text NOT NULL REFERENCES oaooao_coupon_templates(id),
  user_id text NOT NULL REFERENCES oaooao_users(id),
  reserved_order_id text UNIQUE REFERENCES oaooao_orders(id),
  redeemed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oaooao_coupons_user ON oaooao_coupons(user_id,template_id);
CREATE TABLE oaooao_payments (
  id text PRIMARY KEY,
  order_id text NOT NULL UNIQUE REFERENCES oaooao_orders(id),
  provider text NOT NULL,
  provider_payment_id text NOT NULL,
  amount_cents bigint NOT NULL CHECK(amount_cents >= 0),
  currency text NOT NULL,
  status text NOT NULL CHECK(status IN ('succeeded','refunded')),
  confirmation jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  refunded_at timestamptz,
  UNIQUE(provider,provider_payment_id)
);
CREATE TABLE oaooao_payment_configs (
  provider_id text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  public_values jsonb NOT NULL DEFAULT '{}',
  encrypted_secrets text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE oaooao_plan_grants (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES oaooao_users(id),
  order_id text UNIQUE REFERENCES oaooao_orders(id),
  plan_id text NOT NULL,
  daily_points numeric(20,4) NOT NULL CHECK(daily_points >= 0),
  starts_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK(expires_at > starts_at)
);
CREATE INDEX oaooao_plan_user ON oaooao_plan_grants(user_id,expires_at);
CREATE TABLE oaooao_admin_plan_assignments (
  user_id text PRIMARY KEY REFERENCES oaooao_users(id),
  plan_id text NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE oaooao_referral_codes (
  user_id text PRIMARY KEY REFERENCES oaooao_users(id),
  code text NOT NULL UNIQUE,
  clicks bigint NOT NULL DEFAULT 0 CHECK(clicks >= 0)
);
CREATE TABLE oaooao_referrals (
  id text PRIMARY KEY,
  inviter_user_id text NOT NULL REFERENCES oaooao_users(id),
  invitee_user_id text NOT NULL UNIQUE REFERENCES oaooao_users(id),
  status text NOT NULL DEFAULT 'registered' CHECK(status IN ('registered','qualified','settled','revoked','frozen')),
  qualifying_order_id text UNIQUE REFERENCES oaooao_orders(id),
  qualified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK(inviter_user_id <> invitee_user_id)
);
CREATE TABLE oaooao_referral_rewards (
  id text PRIMARY KEY,
  relationship_id text NOT NULL REFERENCES oaooao_referrals(id),
  user_id text NOT NULL REFERENCES oaooao_users(id),
  role text NOT NULL CHECK(role IN ('inviter','invitee')),
  points numeric(20,4) NOT NULL CHECK(points >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','settled','revoked','frozen')),
  due_at timestamptz NOT NULL,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(relationship_id,role)
);
