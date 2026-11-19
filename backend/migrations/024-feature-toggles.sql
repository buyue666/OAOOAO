-- Disabling a feature preserves its version preferences. Existing enabled states are unchanged.
ALTER TABLE oaooao_account_plugins ADD COLUMN enabled boolean NOT NULL DEFAULT true;
