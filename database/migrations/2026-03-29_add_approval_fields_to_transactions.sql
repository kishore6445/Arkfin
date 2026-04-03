-- Add approval fields to transactions table
-- Date: 2026-03-29
-- Purpose: Store approval status and approver information for transaction approvals

BEGIN;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS approval_status VARCHAR DEFAULT 'Pending Approval',
  ADD COLUMN IF NOT EXISTS approved_by VARCHAR;

COMMIT;
