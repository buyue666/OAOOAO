-- Transfer metadata is private operational data, never exposed through public APIs.
CREATE TABLE oaooao_transfer_runs (
  id text PRIMARY KEY,
  source_digest text NOT NULL,
  payload_digest text NOT NULL,
  captured_at timestamptz NOT NULL,
  summary jsonb NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE oaooao_transfer_archive (
  transfer_id text NOT NULL REFERENCES oaooao_transfer_runs(id),
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  document jsonb NOT NULL,
  PRIMARY KEY(transfer_id,entity_type,entity_id)
);
