-- Seed defaults only at account creation or during this one-time upgrade.
-- Read endpoints and later migrations must preserve deliberate uninstalls.
CREATE FUNCTION oaooao_install_default_creative_plugins() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO oaooao_account_plugins(user_id, plugin_id)
  VALUES (NEW.id, 'agent'), (NEW.id, 'canvas')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER oaooao_users_install_default_creative_plugins
AFTER INSERT ON oaooao_users
FOR EACH ROW EXECUTE FUNCTION oaooao_install_default_creative_plugins();

INSERT INTO oaooao_account_plugins(user_id, plugin_id)
SELECT users.id, defaults.plugin_id
FROM oaooao_users AS users
CROSS JOIN (VALUES ('agent'), ('canvas')) AS defaults(plugin_id)
ON CONFLICT DO NOTHING;
