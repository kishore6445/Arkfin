-- Create payroll_runs table
-- Date: 2026-04-03

BEGIN;

CREATE TABLE IF NOT EXISTS payroll_runs (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  payroll_month DATE NOT NULL,  -- stored as YYYY-MM-01 (first day of month)
  payroll_date DATE NOT NULL,
  status payroll_run_status NOT NULL DEFAULT 'DRAFT',
  total_employees INTEGER NOT NULL DEFAULT 0,
  processed_employees INTEGER NOT NULL DEFAULT 0,
  total_gross NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_deductions NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_net NUMERIC(14,2) NOT NULL DEFAULT 0,
  approved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  approval_date DATE,
  processed_date DATE,
  paid_date DATE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, payroll_month)
);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_org_month
  ON payroll_runs (organization_id, payroll_month);

CREATE INDEX IF NOT EXISTS idx_payroll_runs_org_status
  ON payroll_runs (organization_id, status);

COMMIT;
