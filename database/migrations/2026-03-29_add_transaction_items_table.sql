-- Store accountant-level GST and tax breakdown details per transaction
-- Date: 2026-03-29

BEGIN;

CREATE TABLE IF NOT EXISTS transaction_items (
  id UUID PRIMARY KEY,
  transaction_id UUID NOT NULL UNIQUE REFERENCES transactions(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  gst_rate DECIMAL(7,4),
  gst_treatment VARCHAR,
  hsn_sac_code VARCHAR,
  cgst_amount DECIMAL(15,2),
  sgst_amount DECIMAL(15,2),
  igst_amount DECIMAL(15,2),
  itc_eligible BOOLEAN,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transaction_items_transaction_id
  ON transaction_items(transaction_id);

CREATE INDEX IF NOT EXISTS idx_transaction_items_organization_id
  ON transaction_items(organization_id);

COMMIT;
