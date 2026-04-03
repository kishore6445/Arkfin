-- Add dob column back to employees table
-- Date: 2026-04-03

BEGIN;

ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS dob DATE;

COMMIT;
