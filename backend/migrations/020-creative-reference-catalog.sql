-- Shared, curated references are site resources, separate from account quotas.
CREATE TABLE oaooao_creative_references (
 id text PRIMARY KEY,
 role text NOT NULL CHECK (role IN ('person','garment','pose')),
 group_id text NOT NULL,
 title text NOT NULL,
 category text NOT NULL DEFAULT '',
 style text NOT NULL DEFAULT '',
 angle text NOT NULL DEFAULT '',
 tags jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(tags)='array'),
 metadata jsonb NOT NULL DEFAULT '{}',
 storage_location jsonb NOT NULL,
 thumbnail_location jsonb NOT NULL,
 mime_type text NOT NULL,
 thumbnail_mime_type text NOT NULL,
 byte_count bigint NOT NULL CHECK (byte_count>0),
 sha256 text NOT NULL,
 thumbnail_sha256 text NOT NULL,
 enabled boolean NOT NULL DEFAULT true,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX oaooao_creative_references_filter ON oaooao_creative_references(role,style,category,angle,group_id,id) WHERE enabled;
