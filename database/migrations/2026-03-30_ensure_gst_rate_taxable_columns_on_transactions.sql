-- Ensure transactions table has GST summary columns used by API sync
-- Date: 2026-03-30

BEGIN;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS gst_rate DECIMAL(7,4),
  ADD COLUMN IF NOT EXISTS gst_taxable DECIMAL(15,2);

CREATE INDEX IF NOT EXISTS idx_transactions_gst_rate
  ON transactions(gst_rate);

COMMIT;
