-- Recurring transaction templates and materialization metadata
-- Date: 2026-03-30

BEGIN;

CREATE TABLE IF NOT EXISTS recurring_transaction_templates (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  description TEXT NOT NULL,
  amount DECIMAL(15,2) NOT NULL CHECK (amount > 0),
  is_income BOOLEAN NOT NULL DEFAULT FALSE,
  accounting_type VARCHAR NOT NULL DEFAULT 'Expense', -- Revenue, Expense, Asset, Liability
  subtype VARCHAR NOT NULL DEFAULT 'Other',
  frequency VARCHAR NOT NULL, -- Weekly, Biweekly, Monthly, Quarterly, Annually
  start_date DATE NOT NULL,
  end_date DATE,
  next_due_date DATE NOT NULL,
  last_generated_date DATE,
  occurrences_count INT NOT NULL DEFAULT 0,
  status VARCHAR NOT NULL DEFAULT 'Active', -- Active, Paused, Completed
  auto_apply BOOLEAN NOT NULL DEFAULT TRUE,
  notes TEXT,
  bank_account_id UUID REFERENCES bank_accounts(id),
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recurring_templates_org_status_due
  ON recurring_transaction_templates(organization_id, status, next_due_date);

CREATE INDEX IF NOT EXISTS idx_recurring_templates_org_created
  ON recurring_transaction_templates(organization_id, created_at DESC);

COMMIT;
