-- Persist external uploaded invoice content and extraction metadata
-- Date: 2026-03-29

BEGIN;

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS source_file_name VARCHAR,
  ADD COLUMN IF NOT EXISTS source_file_type VARCHAR,
  ADD COLUMN IF NOT EXISTS source_raw_content TEXT,
  ADD COLUMN IF NOT EXISTS extraction_payload JSONB,
  ADD COLUMN IF NOT EXISTS linked_transaction_id UUID REFERENCES transactions(id),
  ADD COLUMN IF NOT EXISTS is_external_upload BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_invoices_linked_transaction_id
  ON invoices(linked_transaction_id);

CREATE INDEX IF NOT EXISTS idx_invoices_is_external_upload
  ON invoices(is_external_upload);

COMMIT;
