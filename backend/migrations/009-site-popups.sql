-- Promotional popups are independent from announcements and start empty.
CREATE TABLE oaooao_site_popups (
  id text PRIMARY KEY,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 120),
  content text NOT NULL DEFAULT '' CHECK (char_length(content) <= 10000),
  image_url text CHECK (image_url IS NULL OR char_length(image_url) BETWEEN 1 AND 2048),
  action_url text CHECK (action_url IS NULL OR char_length(action_url) BETWEEN 1 AND 2048),
  button_text text NOT NULL DEFAULT '查看详情' CHECK (char_length(btrim(button_text)) BETWEEN 1 AND 24),
  enabled boolean NOT NULL DEFAULT false,
  pages text[] NOT NULL DEFAULT ARRAY['home','studio']::text[]
    CHECK (array_ndims(pages)=1 AND cardinality(pages) BETWEEN 1 AND 2 AND pages <@ ARRAY['home','studio']::text[] AND array_position(pages,NULL) IS NULL AND pages[1] IS DISTINCT FROM pages[2]),
  frequency text NOT NULL DEFAULT 'session' CHECK (frequency IN ('session','daily')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (char_length(btrim(content)) > 0 OR image_url IS NOT NULL),
  CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at)
);
CREATE INDEX oaooao_site_popups_updated ON oaooao_site_popups(updated_at DESC,created_at DESC,id DESC);
