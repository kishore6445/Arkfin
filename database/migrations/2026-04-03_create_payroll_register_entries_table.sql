-- Create payroll_register_entries table
-- Date: 2026-04-03

BEGIN;

CREATE TABLE IF NOT EXISTS payroll_register_entries (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  employee_code VARCHAR NOT NULL,
  employee_name VARCHAR NOT NULL,
  designation VARCHAR NOT NULL,
  payroll_month VARCHAR(7) NOT NULL,
  basic NUMERIC(14,2) NOT NULL DEFAULT 0,
  da NUMERIC(14,2) NOT NULL DEFAULT 0,
  hra NUMERIC(14,2) NOT NULL DEFAULT 0,
  conveyance NUMERIC(14,2) NOT NULL DEFAULT 0,
  medical NUMERIC(14,2) NOT NULL DEFAULT 0,
  gross_salary NUMERIC(14,2) NOT NULL DEFAULT 0,
  pf NUMERIC(14,2) NOT NULL DEFAULT 0,
  esi NUMERIC(14,2) NOT NULL DEFAULT 0,
  income_tax NUMERIC(14,2) NOT NULL DEFAULT 0,
  pt NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_deductions NUMERIC(14,2) NOT NULL DEFAULT 0,
  net_salary NUMERIC(14,2) NOT NULL DEFAULT 0,
  bank_account VARCHAR,
  transfer_status VARCHAR NOT NULL DEFAULT 'Pending' CHECK (transfer_status IN ('Pending', 'Processed', 'Cancelled')),
  transfer_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payroll_register_entries_org_month
  ON payroll_register_entries (organization_id, payroll_month);

CREATE INDEX IF NOT EXISTS idx_payroll_register_entries_org_status
  ON payroll_register_entries (organization_id, transfer_status);

COMMIT;
