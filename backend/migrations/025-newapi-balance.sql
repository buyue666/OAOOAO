-- Extend immutable payment attempts to a second independently configured provider.
ALTER TABLE oaooao_payment_attempts DROP CONSTRAINT oaooao_payment_attempts_provider_check;
ALTER TABLE oaooao_payment_attempts ADD CONSTRAINT oaooao_payment_attempts_provider_check CHECK(provider IN ('epay','ciyuan_balance'));
-- Manual collection is retired. Historical orders and encrypted configuration remain for audit.
UPDATE oaooao_payment_configs SET enabled=false,updated_at=now() WHERE provider_id='manual';
