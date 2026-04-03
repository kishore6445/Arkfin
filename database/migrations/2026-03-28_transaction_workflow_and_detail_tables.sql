-- Transaction workflow normalization for Ark Finance
-- Date: 2026-03-28
-- Goal:
-- 1) Keep stage/status + core accounting fields on transactions
-- 2) Move repeatable/detail sections into child tables

BEGIN;

-- 1) Core workflow and ownership columns on transactions
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS workflow_stage VARCHAR NOT NULL DEFAULT 'ENTRY', -- ENTRY, REVIEW, APPROVAL, PROCESSING, RECORDED
  ADD COLUMN IF NOT EXISTS source_type VARCHAR, -- PAYROLL, INVOICE, MANUAL, BANK_IMPORT, JOURNAL
  ADD COLUMN IF NOT EXISTS source_reference_id UUID,
  ADD COLUMN IF NOT EXISTS cost_center_code VARCHAR,
  ADD COLUMN IF NOT EXISTS internal_notes TEXT,
  ADD COLUMN IF NOT EXISTS external_notes TEXT,
  ADD COLUMN IF NOT EXISTS compliance_risk_level VARCHAR, -- LOW, MEDIUM, HIGH
  ADD COLUMN IF NOT EXISTS requires_audit BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS locked_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMP,
  ADD COLUMN IF NOT EXISTS processed_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS impact_on_cash_flow DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS impact_on_profit DECIMAL(15,2);

-- Normalize legacy enum-like status values to uppercase if present
UPDATE transactions
SET status = UPPER(status)
WHERE status IS NOT NULL
  AND status <> UPPER(status);

-- 2) Tax lines (CGST/SGST/IGST/etc) per transaction
CREATE TABLE IF NOT EXISTS transaction_tax_lines (
  id UUID PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  line_type VARCHAR NOT NULL, -- CGST, SGST, IGST, CESS, TDS, PF, ESI, OTHER
  tax_code VARCHAR,
  rate DECIMAL(7,4),
  taxable_amount DECIMAL(15,2),
  tax_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  is_itc_eligible BOOLEAN,
  hsn_sac_code VARCHAR,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transaction_tax_lines_transaction_id
  ON transaction_tax_lines(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_tax_lines_organization_id
  ON transaction_tax_lines(organization_id);
CREATE INDEX IF NOT EXISTS idx_transaction_tax_lines_line_type
  ON transaction_tax_lines(line_type);

-- 3) Compliance checks and obligations tied to transaction
CREATE TABLE IF NOT EXISTS transaction_compliance (
  id UUID PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  check_code VARCHAR NOT NULL, -- GST_VALIDATION, PAYROLL_TDS, PF, ESI, AUDIT_TRAIL, etc
  check_name VARCHAR NOT NULL,
  status VARCHAR NOT NULL DEFAULT 'PENDING', -- PENDING, PASSED, FAILED, WAIVED
  severity VARCHAR NOT NULL DEFAULT 'MEDIUM', -- LOW, MEDIUM, HIGH, CRITICAL
  due_date DATE,
  notes TEXT,
  resolved_by UUID REFERENCES users(id),
  resolved_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(transaction_id, check_code)
);

CREATE INDEX IF NOT EXISTS idx_transaction_compliance_transaction_id
  ON transaction_compliance(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_compliance_status
  ON transaction_compliance(status);

-- 4) Approval action history (supports reassignment, request changes, etc.)
CREATE TABLE IF NOT EXISTS transaction_approval_actions (
  id UUID PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  action VARCHAR NOT NULL, -- ASSIGNED, REASSIGNED, REQUEST_CHANGES, APPROVED, REJECTED, ESCALATED
  from_user_id UUID REFERENCES users(id),
  to_user_id UUID REFERENCES users(id),
  acted_by UUID REFERENCES users(id),
  approval_level VARCHAR, -- NONE, MANAGER, ADMIN, ADMIN_AUDITOR
  note TEXT,
  acted_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transaction_approval_actions_transaction_id
  ON transaction_approval_actions(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_approval_actions_acted_at
  ON transaction_approval_actions(acted_at DESC);

-- 5) Attachment metadata (documents, invoices, proofs)
CREATE TABLE IF NOT EXISTS transaction_attachments (
  id UUID PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  file_name VARCHAR NOT NULL,
  file_type VARCHAR,
  file_size_bytes BIGINT,
  storage_path TEXT NOT NULL,
  uploaded_by UUID REFERENCES users(id),
  uploaded_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transaction_attachments_transaction_id
  ON transaction_attachments(transaction_id);

-- 6) Invoice links (many-to-many and partial matching support)
CREATE TABLE IF NOT EXISTS transaction_invoice_links (
  id UUID PRIMARY KEY,
  transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id),
  linked_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  adjustment_type VARCHAR NOT NULL DEFAULT 'FULL', -- FULL, PARTIAL
  match_confidence DECIMAL(5,2),
  linked_by UUID REFERENCES users(id),
  linked_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(transaction_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_transaction_invoice_links_transaction_id
  ON transaction_invoice_links(transaction_id);
CREATE INDEX IF NOT EXISTS idx_transaction_invoice_links_invoice_id
  ON transaction_invoice_links(invoice_id);

-- 7) Helpful indexes on transactions for workflow views
CREATE INDEX IF NOT EXISTS idx_transactions_workflow_stage
  ON transactions(workflow_stage);
CREATE INDEX IF NOT EXISTS idx_transactions_status
  ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_organization_workflow
  ON transactions(organization_id, workflow_stage, status);
CREATE INDEX IF NOT EXISTS idx_transactions_source
  ON transactions(source_type, source_reference_id);
CREATE INDEX IF NOT EXISTS idx_transactions_locked_at
  ON transactions(locked_at DESC);

COMMIT;
