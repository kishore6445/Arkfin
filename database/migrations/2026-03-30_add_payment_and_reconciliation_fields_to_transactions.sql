-- Persist payment and reconciliation states from transaction edit drawer
-- Date: 2026-03-30

BEGIN;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS payment_status VARCHAR,
  ADD COLUMN IF NOT EXISTS reconciliation_status VARCHAR,
  ADD COLUMN IF NOT EXISTS bank_statement_reference VARCHAR;

CREATE INDEX IF NOT EXISTS idx_transactions_payment_status
  ON transactions(payment_status);

CREATE INDEX IF NOT EXISTS idx_transactions_reconciliation_status
  ON transactions(reconciliation_status);

COMMIT;
