-- Add PROCESSED value to payroll_run_status enum
-- Date: 2026-04-03

ALTER TYPE payroll_run_status ADD VALUE IF NOT EXISTS 'PROCESSED';
