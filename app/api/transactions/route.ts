  import { NextResponse } from 'next/server'
  import { createClient } from '@supabase/supabase-js'

  export const dynamic = 'force-dynamic'

  type TransactionRequest = {
    id?: string
    date: string
    description: string
    amount: number
    isIncome: boolean
    accountingType: 'Revenue' | 'Expense' | 'Asset' | 'Liability'
    subtype: string
    bucketId?: string | null
    vendorCustomerName?: string | null
    paymentMethod?: string | null
    bankAccountId?: string | null
    invoiceId?: string | null
    status?: string
    gstAmount?: number
    taxableAmount?: number
    gstRate?: number
    gstTreatment?: 'Taxable' | 'Exempt' | 'Nil-rated' | 'RCM' | string
    hsnSacCode?: string
    cgstAmount?: number
    sgstAmount?: number
    igstAmount?: number
    itcEligible?: boolean
    notes?: string
    approvalStatus?: 'Pending Approval' | 'Approved' | 'Rejected' | string
    approval_status?: 'Pending Approval' | 'Approved' | 'Rejected' | string
    approvedBy?: string
    approved_by?: string
    sourceType?: string
    source_type?: string
    sourceReferenceId?: string | null
    source_reference_id?: string | null
    paymentStatus?: 'Recorded' | 'Pending Payment' | 'Partially Paid' | 'Paid' | string
    payment_status?: 'Recorded' | 'Pending Payment' | 'Partially Paid' | 'Paid' | string
    reconciliationStatus?: 'Unreconciled' | 'Reconciled' | 'Flagged' | string
    reconciliation_status?: 'Unreconciled' | 'Reconciled' | 'Flagged' | string
    bankStatementReference?: string | null
    bank_statement_reference?: string | null
    workflowStage?: 'ENTRY' | 'REVIEW' | 'APPROVAL' | 'PROCESSING' | 'RECORDED' | string
    workflow_stage?: 'ENTRY' | 'REVIEW' | 'APPROVAL' | 'PROCESSING' | 'RECORDED' | string
    costCenterCode?: string | null
    cost_center_code?: string | null
    internalNotes?: string | null
    internal_notes?: string | null
    externalNotes?: string | null
    external_notes?: string | null
    complianceRiskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | string
    compliance_risk_level?: 'LOW' | 'MEDIUM' | 'HIGH' | string
    requiresAudit?: boolean
    requires_audit?: boolean
    lockedBy?: string | null
    locked_by?: string | null
    lockedAt?: string | null
    locked_at?: string | null
    approvedAt?: string | null
    approved_at?: string | null
    rejectedAt?: string | null
    rejected_at?: string | null
    processedAt?: string | null
    processed_at?: string | null
    processedBy?: string | null
    processed_by?: string | null
    impactOnCashFlow?: number | null
    impact_on_cash_flow?: number | null
    impactOnProfit?: number | null
    impact_on_profit?: number | null
    taxLines?: Array<{
      lineType?: string
      line_type?: string
      taxCode?: string | null
      tax_code?: string | null
      rate?: number | null
      taxableAmount?: number | null
      taxable_amount?: number | null
      taxAmount?: number | null
      tax_amount?: number | null
      isItcEligible?: boolean | null
      is_itc_eligible?: boolean | null
      hsnSacCode?: string | null
      hsn_sac_code?: string | null
    }>
  }

  type RequestBody = {
    transaction?: TransactionRequest
    accessToken?: string
    userId?: string
    organizationId?: string
  }

  type UserProfileRow = {
    id: string
    organization_id: string | null
    is_active: boolean | null
    role?: string | null
  }

  function normalizeRoleToken(value: string | null | undefined) {
    return (value ?? '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
  }

  function isAccountantRole(role: string | null | undefined) {
    return normalizeRoleToken(role) === 'ACCOUNTANT'
  }

  type RecurringTemplateRow = {
    id: string
    organization_id: string
    description: string
    amount: number
    is_income: boolean
    accounting_type?: string | null
    subtype?: string | null
    frequency: string
    start_date: string
    end_date?: string | null
    next_due_date: string
    last_generated_date?: string | null
    occurrences_count?: number | null
    status?: string | null
    auto_apply?: boolean | null
    notes?: string | null
    bank_account_id?: string | null
  }

  // Removed role-based approval check - any user can now approve transactions
  // Previously only Accountant/CA roles could approve

  function getAdminClient() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    }

    return createClient<any>(supabaseUrl, serviceRoleKey)
  }

  async function getAuthorizedProfile(request: Request) {
    const authHeader = request.headers.get('authorization')
    const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.replace('Bearer ', '') : null
    const fallbackHeaderToken = request.headers.get('x-access-token')
    const fallbackUserIdHeader = request.headers.get('x-user-id')
    const fallbackOrganizationIdHeader = request.headers.get('x-organization-id')
    const requestUrl = new URL(request.url)

    let bodyToken: string | null = null
    let bodyUserId: string | null = null
    let bodyOrganizationId: string | null = null

    if (request.method !== 'GET') {
      const clonedRequest = request.clone()
      try {
        const body = (await clonedRequest.json()) as RequestBody
        bodyToken = body.accessToken ?? null
        bodyUserId = body.userId ?? null
        bodyOrganizationId = body.organizationId ?? null
      } catch {
        bodyToken = null
        bodyUserId = null
        bodyOrganizationId = null
      }
    }

    const accessToken = headerToken ?? fallbackHeaderToken ?? bodyToken
    const admin = getAdminClient()

    if (!accessToken) {
      const fallbackUserId = fallbackUserIdHeader ?? requestUrl.searchParams.get('userId') ?? bodyUserId
      const fallbackOrganizationId =
        fallbackOrganizationIdHeader ?? requestUrl.searchParams.get('organizationId') ?? bodyOrganizationId

      if (!fallbackUserId || !fallbackOrganizationId) {
        return { error: NextResponse.json({ error: 'Missing authorization token' }, { status: 401 }) }
      }

      const { data: profile, error: profileError } = await admin
        .from('users')
        .select('id, organization_id, is_active, role')
        .eq('id', fallbackUserId)
        .maybeSingle<UserProfileRow>()

      if (profileError) {
        return { error: NextResponse.json({ error: profileError.message }, { status: 400 }) }
      }

      if (!profile?.is_active) {
        return { error: NextResponse.json({ error: 'User is inactive' }, { status: 403 }) }
      }

      if (profile.organization_id !== fallbackOrganizationId) {
        return { error: NextResponse.json({ error: 'Organization mismatch for this user' }, { status: 403 }) }
      }

      return { admin, profile }
    }

    const { data: authData, error: authError } = await admin.auth.getUser(accessToken)
    if (authError || !authData.user) {
      return { error: NextResponse.json({ error: authError?.message ?? 'Unauthorized' }, { status: 401 }) }
    }

    const { data: profile, error: profileError } = await admin
      .from('users')
      .select('id, organization_id, is_active, role')
      .eq('id', authData.user.id)
      .maybeSingle<UserProfileRow>()

    if (profileError) {
      return { error: NextResponse.json({ error: profileError.message }, { status: 400 }) }
    }

    if (!profile?.is_active) {
      return { error: NextResponse.json({ error: 'User is inactive' }, { status: 403 }) }
    }

    if (!profile.organization_id) {
      return { error: NextResponse.json({ error: 'No organization linked to this user' }, { status: 400 }) }
    }

    return { admin, profile }
  }


  function buildTransactionPayload(
    transaction: TransactionRequest,
    organizationId: string,
    resolvedId?: string
  ) {
        const t = transaction as any
        const isIncome = t.isIncome ?? t.is_income
        const accountingType = t.accountingType ?? t.accounting_type
        const bucketId = t.bucketId ?? t.bucket_id
        const vendorCustomerName = t.vendorCustomerName ?? t.vendor_customer_name
        const paymentMethod = t.paymentMethod ?? t.payment_method
        const bankAccountId = t.bankAccountId ?? t.bank_account_id
        const cgstAmount = Number(t.cgstAmount ?? t.cgst_amount ?? 0)
        const sgstAmount = Number(t.sgstAmount ?? t.sgst_amount ?? 0)
        const igstAmount = Number(t.igstAmount ?? t.igst_amount ?? 0)
        const gstAmountFromBreakdown = cgstAmount + sgstAmount + igstAmount
        const gstAmount = t.gstAmount ?? t.gst_amount ?? (gstAmountFromBreakdown > 0 ? gstAmountFromBreakdown : 0)
        const gstRate = t.gstRate ?? t.gst_rate ?? null
        const taxableAmount = t.taxableAmount ?? t.taxable_amount ?? t.amount
        const invoiceId = t.invoiceId ?? t.invoice_reference ?? t.invoice_id
        const approvalStatus = t.approvalStatus ?? t.approval_status ?? 'Pending Approval'
        const approvedBy = t.approvedBy ?? t.approved_by
        const paymentStatus = t.paymentStatus ?? t.payment_status ?? 'Recorded'
        const reconciliationStatus = t.reconciliationStatus ?? t.reconciliation_status
        const bankStatementReference = t.bankStatementReference ?? t.bank_statement_reference ?? null
          const explicitSourceTypeRaw = t.sourceType ?? t.source_type
          const explicitSourceType =
            typeof explicitSourceTypeRaw === 'string' && explicitSourceTypeRaw.trim().length > 0
              ? explicitSourceTypeRaw.trim().toUpperCase()
              : null
          const explicitSourceReference =
            t.sourceReferenceId ?? t.source_reference_id ?? null
          const workflowStageRaw = t.workflowStage ?? t.workflow_stage
          const workflowStage =
            typeof workflowStageRaw === 'string' && workflowStageRaw.trim().length > 0
              ? workflowStageRaw.trim().toUpperCase()
              : 'ENTRY'
          const costCenterCode = t.costCenterCode ?? t.cost_center_code ?? null
          const internalNotes = t.internalNotes ?? t.internal_notes ?? null
          const externalNotes = t.externalNotes ?? t.external_notes ?? null
          const complianceRiskLevelRaw = t.complianceRiskLevel ?? t.compliance_risk_level
          const complianceRiskLevel =
            typeof complianceRiskLevelRaw === 'string' && complianceRiskLevelRaw.trim().length > 0
              ? complianceRiskLevelRaw.trim().toUpperCase()
              : null
          const requiresAudit =
            typeof (t.requiresAudit ?? t.requires_audit) === 'boolean'
              ? Boolean(t.requiresAudit ?? t.requires_audit)
              : false
          const lockedBy = t.lockedBy ?? t.locked_by ?? null
          const lockedAt = t.lockedAt ?? t.locked_at ?? null
          const approvedAt = t.approvedAt ?? t.approved_at ?? null
          const rejectedAt = t.rejectedAt ?? t.rejected_at ?? null
          const processedAt = t.processedAt ?? t.processed_at ?? null
          const processedBy = t.processedBy ?? t.processed_by ?? null
          const impactOnCashFlow = t.impactOnCashFlow ?? t.impact_on_cash_flow ?? null
          const impactOnProfit = t.impactOnProfit ?? t.impact_on_profit ?? null

          const sourceType = explicitSourceType ?? (invoiceId ? 'INVOICE' : 'MANUAL')
          const sourceReferenceId = explicitSourceReference ?? invoiceId ?? null

    return {
      ...(resolvedId ? { id: resolvedId } : {}),
      organization_id: organizationId,
      date: t.date,
      description: t.description.trim(),
      amount: t.amount,
        is_income: isIncome,
        accounting_type: accountingType,
      subtype: t.subtype,
        bucket_id: bucketId ?? null,
        vendor_customer_name: vendorCustomerName ?? null,
        bank_account_id: bankAccountId ?? null,
        assigned_bank_account_id: bankAccountId ?? null,
      status: t.status ?? 'DRAFT',
        gst_rate: gstRate,
        gst_amount: gstAmount,
        gst_taxable: taxableAmount,
      notes: t.notes ?? '',
        invoice_reference: invoiceId ?? null,
        approval_status: approvalStatus ?? null,
        approved_by: approvedBy ?? null,
        source_type: sourceType,
        source_reference_id: sourceReferenceId,
        payment_status: paymentStatus,
        reconciliation_status: reconciliationStatus ?? null,
        bank_statement_reference: bankStatementReference,
        workflow_stage: workflowStage,
        cost_center_code: costCenterCode,
        internal_notes: internalNotes,
        external_notes: externalNotes,
        compliance_risk_level: complianceRiskLevel,
        requires_audit: requiresAudit,
        locked_by: lockedBy,
        locked_at: lockedAt,
        approved_at: approvedAt,
        rejected_at: rejectedAt,
        processed_at: processedAt,
        processed_by: processedBy,
        impact_on_cash_flow: impactOnCashFlow,
        impact_on_profit: impactOnProfit,
    }
  }

function stripSourceColumns(payload: Record<string, unknown>) {
  const sanitized = { ...payload }
  delete sanitized.source_type
  delete sanitized.source_reference_id
  return sanitized
}

function stripUnsupportedColumns(payload: Record<string, unknown>, errorMessage: string | undefined) {
  if (!errorMessage) {
    return { ...payload }
  }

  const sanitized = { ...payload }
  const normalized = errorMessage.toLowerCase()

  const maybeRemove = (column: string) => {
    if (normalized.includes(column.toLowerCase())) {
      delete sanitized[column]
    }
  }

  maybeRemove('source_type')
  maybeRemove('source_reference_id')
  maybeRemove('assigned_bank_account_id')
  maybeRemove('payment_status')
  maybeRemove('reconciliation_status')
  maybeRemove('bank_statement_reference')
  maybeRemove('workflow_stage')
  maybeRemove('cost_center_code')
  maybeRemove('internal_notes')
  maybeRemove('external_notes')
  maybeRemove('compliance_risk_level')
  maybeRemove('requires_audit')
  maybeRemove('locked_by')
  maybeRemove('locked_at')
  maybeRemove('approved_at')
  maybeRemove('rejected_at')
  maybeRemove('processed_at')
  maybeRemove('processed_by')
  maybeRemove('impact_on_cash_flow')
  maybeRemove('impact_on_profit')
  maybeRemove('gst_rate')

  return sanitized
}

function isMissingSourceColumnsError(errorMessage: string | undefined) {
  if (!errorMessage) {
    return false
  }

  const normalized = errorMessage.toLowerCase()

  // Catch any "column X does not exist" Postgres error so the retry with stripped columns runs
  if (
    normalized.includes('does not exist') ||
    normalized.includes('column') && normalized.includes('unknown')
  ) {
    return true
  }

  return (
    normalized.includes('source_type') ||
    normalized.includes('source_reference_id') ||
    normalized.includes('payment_status') ||
    normalized.includes('reconciliation_status') ||
    normalized.includes('bank_statement_reference') ||
    normalized.includes('assigned_bank_account_id') ||
    normalized.includes('workflow_stage') ||
    normalized.includes('cost_center_code') ||
    normalized.includes('internal_notes') ||
    normalized.includes('external_notes') ||
    normalized.includes('compliance_risk_level') ||
    normalized.includes('requires_audit') ||
    normalized.includes('locked_by') ||
    normalized.includes('locked_at') ||
    normalized.includes('approved_at') ||
    normalized.includes('rejected_at') ||
    normalized.includes('processed_at') ||
    normalized.includes('processed_by') ||
    normalized.includes('impact_on_cash_flow') ||
    normalized.includes('impact_on_profit')
  )
}

    

  


  // async function selectTransactionsByOrganization(admin: ReturnType<typeof getAdminClient>, organizationId: string) {
  //   const variants = [
  //     () =>
  //       admin
  //         .from('transactions')
  //         .select('*')
  //         .eq('organizationid', organizationId)
  //         .order('createdat', { ascending: false }),
  //     () =>
  //       admin
  //         .from('transactions')
  //         .select('*')
  //         .eq('organization_id', organizationId)
  //         .order('created_at', { ascending: false }),
  //   ]
async function selectTransactionsByOrganization(
  admin: ReturnType<typeof getAdminClient>,
  organizationId: string
) {
  const { data, error } = await admin
    .from('transactions')
    .select('*')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })

  if (error || !data?.length) {
    return { data: data ?? [], error }
  }

  const transactionIds = data
    .map((row: any) => row.id)
    .filter((id: string | undefined): id is string => Boolean(id))

  const { data: taxLines, error: taxLinesError } = await admin
    .from('transaction_tax_lines')
    .select('transaction_id, line_type, tax_code, rate, taxable_amount, tax_amount, is_itc_eligible, hsn_sac_code')
    .in('transaction_id', transactionIds)

  if (!taxLinesError) {
    const taxLinesByTransactionId = new Map<string, any[]>()
    for (const line of taxLines ?? []) {
      const existing = taxLinesByTransactionId.get(line.transaction_id) ?? []
      existing.push(line)
      taxLinesByTransactionId.set(line.transaction_id, existing)
    }

    const mergedWithTaxLines = data.map((row: any) => {
      const lines = taxLinesByTransactionId.get(row.id) ?? []
      if (!lines.length) {
        return row
      }

      const firstLine = lines[0]
      const cgstAmount = lines
        .filter((l) => (l.line_type ?? '').toUpperCase() === 'CGST')
        .reduce((sum, l) => sum + Number(l.tax_amount ?? 0), 0)
      const sgstAmount = lines
        .filter((l) => (l.line_type ?? '').toUpperCase() === 'SGST')
        .reduce((sum, l) => sum + Number(l.tax_amount ?? 0), 0)
      const igstAmount = lines
        .filter((l) => (l.line_type ?? '').toUpperCase() === 'IGST')
        .reduce((sum, l) => sum + Number(l.tax_amount ?? 0), 0)

      return {
        ...row,
        gst_rate: firstLine?.rate ?? null,
        gst_treatment: firstLine?.tax_code ?? null,
        hsn_sac_code: firstLine?.hsn_sac_code ?? null,
        cgst_amount: cgstAmount,
        sgst_amount: sgstAmount,
        igst_amount: igstAmount,
        itc_eligible: firstLine?.is_itc_eligible ?? null,
        tax_lines: lines,
      }
    })

    return { data: mergedWithTaxLines, error }
  }

  // Backward-compatible fallback for older deployments still using transaction_items.
  const { data: items } = await admin
    .from('transaction_items')
    .select('transaction_id, gst_rate, gst_treatment, hsn_sac_code, cgst_amount, sgst_amount, igst_amount, itc_eligible')
    .in('transaction_id', transactionIds)

  const itemsByTransactionId = new Map<string, any>()
  for (const item of items ?? []) {
    itemsByTransactionId.set(item.transaction_id, item)
  }

  const merged = data.map((row: any) => {
    const item = itemsByTransactionId.get(row.id)
    if (!item) {
      return row
    }

    return {
      ...row,
      gst_rate: item.gst_rate,
      gst_treatment: item.gst_treatment,
      hsn_sac_code: item.hsn_sac_code,
      cgst_amount: item.cgst_amount,
      sgst_amount: item.sgst_amount,
      igst_amount: item.igst_amount,
      itc_eligible: item.itc_eligible,
    }
  })

  return { data: merged, error }
}

function hasTransactionItemFields(transaction: TransactionRequest | Record<string, unknown>) {
  const t = transaction as Record<string, unknown>
  const keys = [
    'gstRate',
    'gst_rate',
    'gstTreatment',
    'gst_treatment',
    'hsnSacCode',
    'hsn_sac_code',
    'cgstAmount',
    'cgst_amount',
    'sgstAmount',
    'sgst_amount',
    'igstAmount',
    'igst_amount',
    'itcEligible',
    'itc_eligible',
  ]

  return keys.some((key) => {
    const value = t[key]
    if (value === undefined || value === null) {
      return false
    }

    if (typeof value === 'string') {
      return value.trim().length > 0
    }

    return true
  })
}

async function upsertTransactionItem(
  admin: ReturnType<typeof getAdminClient>,
  organizationId: string,
  transactionId: string,
  transaction: TransactionRequest | Record<string, unknown>
) {
  const t = transaction as any

  const { data: existingItem, error: existingItemError } = await admin
    .from('transaction_items')
    .select('id')
    .eq('transaction_id', transactionId)
    .maybeSingle()

  if (existingItemError) {
    return existingItemError
  }

  const payload = {
    id: existingItem?.id ?? crypto.randomUUID(),
    transaction_id: transactionId,
    organization_id: organizationId,
    gst_rate: t.gstRate ?? t.gst_rate ?? null,
    gst_treatment: t.gstTreatment ?? t.gst_treatment ?? null,
    hsn_sac_code: t.hsnSacCode ?? t.hsn_sac_code ?? null,
    cgst_amount: t.cgstAmount ?? t.cgst_amount ?? null,
    sgst_amount: t.sgstAmount ?? t.sgst_amount ?? null,
    igst_amount: t.igstAmount ?? t.igst_amount ?? null,
    itc_eligible:
      typeof (t.itcEligible ?? t.itc_eligible) === 'boolean'
        ? Boolean(t.itcEligible ?? t.itc_eligible)
        : null,
    updated_at: new Date().toISOString(),
  }

  const { error } = await admin
    .from('transaction_items')
    .upsert(payload, { onConflict: 'transaction_id' })

  return error
}

function hasTransactionTaxLineFields(transaction: TransactionRequest | Record<string, unknown>) {
  const t = transaction as Record<string, unknown>
  if (Array.isArray(t.taxLines) && t.taxLines.length > 0) {
    return true
  }

  const keys = [
    'gstRate',
    'gst_rate',
    'gstTreatment',
    'gst_treatment',
    'hsnSacCode',
    'hsn_sac_code',
    'cgstAmount',
    'cgst_amount',
    'sgstAmount',
    'sgst_amount',
    'igstAmount',
    'igst_amount',
    'itcEligible',
    'itc_eligible',
  ]

  return keys.some((key) => {
    const value = t[key]
    if (value === undefined || value === null) {
      return false
    }

    if (typeof value === 'string') {
      return value.trim().length > 0
    }

    return true
  })
}

async function replaceTransactionTaxLines(
  admin: ReturnType<typeof getAdminClient>,
  organizationId: string,
  transactionId: string,
  transaction: TransactionRequest | Record<string, unknown>,
  userId?: string | null
) {
  const t = transaction as any
  const { error: deleteError } = await admin
    .from('transaction_tax_lines')
    .delete()
    .eq('transaction_id', transactionId)

  if (deleteError) {
    return deleteError
  }

  const explicitLines = Array.isArray(t.taxLines) ? t.taxLines : []
  const linesToInsert: Array<Record<string, unknown>> = []

  if (explicitLines.length > 0) {
    for (const line of explicitLines) {
      linesToInsert.push({
        id: crypto.randomUUID(),
        transaction_id: transactionId,
        organization_id: organizationId,
        line_type: (line.lineType ?? line.line_type ?? 'OTHER').toString().toUpperCase(),
        tax_code: line.taxCode ?? line.tax_code ?? null,
        rate: line.rate ?? null,
        taxable_amount: line.taxableAmount ?? line.taxable_amount ?? null,
        tax_amount: line.taxAmount ?? line.tax_amount ?? 0,
        is_itc_eligible: line.isItcEligible ?? line.is_itc_eligible ?? null,
        hsn_sac_code: line.hsnSacCode ?? line.hsn_sac_code ?? null,
        created_by: userId ?? null,
        updated_at: new Date().toISOString(),
      })
    }
  } else {
    const gstRate = t.gstRate ?? t.gst_rate ?? null
    const gstTreatment = t.gstTreatment ?? t.gst_treatment ?? null
    const hsnSacCode = t.hsnSacCode ?? t.hsn_sac_code ?? null
    const taxableAmount = t.taxableAmount ?? t.taxable_amount ?? t.amount ?? null
    const itcEligible =
      typeof (t.itcEligible ?? t.itc_eligible) === 'boolean'
        ? Boolean(t.itcEligible ?? t.itc_eligible)
        : null

    const composed = [
      { lineType: 'CGST', taxAmount: t.cgstAmount ?? t.cgst_amount },
      { lineType: 'SGST', taxAmount: t.sgstAmount ?? t.sgst_amount },
      { lineType: 'IGST', taxAmount: t.igstAmount ?? t.igst_amount },
    ]

    for (const item of composed) {
      const amount = Number(item.taxAmount ?? 0)
      if (amount <= 0) {
        continue
      }

      linesToInsert.push({
        id: crypto.randomUUID(),
        transaction_id: transactionId,
        organization_id: organizationId,
        line_type: item.lineType,
        tax_code: gstTreatment,
        rate: gstRate,
        taxable_amount: taxableAmount,
        tax_amount: amount,
        is_itc_eligible: itcEligible,
        hsn_sac_code: hsnSacCode,
        created_by: userId ?? null,
        updated_at: new Date().toISOString(),
      })
    }
  }

  if (!linesToInsert.length) {
    return null
  }

  const { error } = await admin
    .from('transaction_tax_lines')
    .insert(linesToInsert)

  return error
}

async function adjustBankAccountBalance(
  admin: ReturnType<typeof getAdminClient>,
  bankAccountId: string,
  delta: number
) {
  if (!bankAccountId || delta === 0) {
    return
  }

  const { data: acc } = await admin
    .from('bank_accounts')
    .select('balance')
    .eq('id', bankAccountId)
    .maybeSingle()

  if (acc) {
    await admin
      .from('bank_accounts')
      .update({ balance: Number(acc.balance ?? 0) + delta })
      .eq('id', bankAccountId)
  }
}

function normalizeUpper(value: unknown) {
  if (typeof value !== 'string') {
    return ''
  }

  return value.trim().toUpperCase()
}

function normalizeToken(value: unknown) {
  return normalizeUpper(value).replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

function paymentStatusCandidates(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) {
    return []
  }

  const trimmed = value.trim()
  const token = normalizeToken(trimmed)
  const variants = new Set<string>([trimmed, token, token.toLowerCase()])

  if (token === 'RECORDED') {
    variants.add('Recorded')
    variants.add('recorded')
  } else if (token === 'PENDING_PAYMENT') {
    variants.add('Pending Payment')
    variants.add('pending payment')
  } else if (token === 'PARTIALLY_PAID') {
    variants.add('Partially Paid')
    variants.add('partially paid')
  } else if (token === 'PAID') {
    variants.add('Paid')
    variants.add('paid')
  }

  return Array.from(variants)
}

function isPaymentStatusConstraintError(message: string | undefined) {
  if (!message) {
    return false
  }

  const normalized = message.toLowerCase()
  return normalized.includes('transactions_payment_status_check') || normalized.includes('payment_status_check')
}

function parseIsoDate(dateValue: string | null | undefined) {
  if (!dateValue) {
    return null
  }

  const parsed = new Date(`${dateValue}T00:00:00.000Z`)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  return parsed
}

function isPaymentOnlyUpdate(transaction: TransactionRequest | undefined) {
  if (!transaction || !transaction.id) {
    return false
  }

  const allowedKeys = new Set([
    'id',
    'paymentStatus',
    'payment_status',
    'reconciliationStatus',
    'reconciliation_status',
    'bankStatementReference',
    'bank_statement_reference',
  ])

  return Object.keys(transaction).every((key) => allowedKeys.has(key))
}

function formatIsoDate(date: Date) {
  return date.toISOString().slice(0, 10)
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setUTCDate(next.getUTCDate() + days)
  return next
}

function addMonths(date: Date, months: number) {
  const next = new Date(date)
  const day = next.getUTCDate()
  next.setUTCDate(1)
  next.setUTCMonth(next.getUTCMonth() + months)

  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate()
  next.setUTCDate(Math.min(day, lastDay))
  return next
}

function computeNextDueDate(currentDueDate: string, frequency: string) {
  const current = parseIsoDate(currentDueDate)
  if (!current) {
    return currentDueDate
  }

  const normalized = normalizeUpper(frequency)
  if (normalized === 'WEEKLY') {
    return formatIsoDate(addDays(current, 7))
  }

  if (normalized === 'BIWEEKLY') {
    return formatIsoDate(addDays(current, 14))
  }

  if (normalized === 'QUARTERLY') {
    return formatIsoDate(addMonths(current, 3))
  }

  if (normalized === 'ANNUALLY' || normalized === 'YEARLY') {
    return formatIsoDate(addMonths(current, 12))
  }

  return formatIsoDate(addMonths(current, 1))
}

function buildRecurringMarker(templateId: string) {
  return `[RECURRING_TEMPLATE:${templateId}]`
}

async function insertRecurringTransactionWithFallbackStatus(
  admin: ReturnType<typeof getAdminClient>,
  basePayload: Record<string, unknown>
) {
  const statusCandidates = [
    'PENDING_APPROVAL',
    'DRAFT',
    'PENDING',
    'RECORDED',
    'Recorded',
    'Needs Info',
    'Action Required',
  ]
  let lastErrorMessage = ''

  for (const candidate of statusCandidates) {
    const payload = {
      ...basePayload,
      status: candidate,
    }

    let { error: insertError } = await admin
      .from('transactions')
      .insert(payload)

    if (insertError) {
      const fallbackPayload = stripUnsupportedColumns(payload, insertError.message)
      ;({ error: insertError } = await admin
        .from('transactions')
        .insert(fallbackPayload))
    }

    if (!insertError) {
      return null
    }

    lastErrorMessage = insertError.message
    if (!insertError.message.toLowerCase().includes('transactions_status_check')) {
      break
    }
  }

  return new Error(lastErrorMessage || 'Unable to insert recurring transaction')
}

async function materializeRecurringTransactions(
  admin: ReturnType<typeof getAdminClient>,
  organizationId: string
) {
  const { data: templates, error } = await admin
    .from('recurring_transaction_templates')
    .select('*')
    .eq('organization_id', organizationId)

  if (error) {
    const message = error.message.toLowerCase()
    if (message.includes('recurring_transaction_templates') || message.includes('does not exist')) {
      return
    }
    throw new Error(`Failed to load recurring templates: ${error.message}`)
  }

  const today = formatIsoDate(new Date())

  for (const template of (templates ?? []) as RecurringTemplateRow[]) {
    const normalizedTemplateStatus = normalizeUpper(template.status ?? 'Active')
    if (normalizedTemplateStatus === 'PAUSED' || normalizedTemplateStatus === 'COMPLETED') {
      continue
    }

    if (template.auto_apply === false) {
      continue
    }

    const marker = buildRecurringMarker(template.id)
    const initialDueDate = parseIsoDate(template.next_due_date)
    if (!initialDueDate) {
      continue
    }

    let nextDueDate = formatIsoDate(initialDueDate)
    let lastGeneratedDate = template.last_generated_date ?? null
    let occurrences = Number(template.occurrences_count ?? 0)
    let nextStatus = template.status ?? 'Active'
    let safetyCounter = 0

    while (nextDueDate <= today) {
      safetyCounter += 1
      if (safetyCounter > 120) {
        break
      }

      if (template.end_date && nextDueDate > template.end_date) {
        nextStatus = 'Completed'
        break
      }

      const { data: existingTransaction, error: existingError } = await admin
        .from('transactions')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('date', nextDueDate)
        .eq('notes', marker)
        .maybeSingle()

      if (existingError) {
        console.error('[Recurring Materialize] Duplicate check failed:', existingError.message)
        break
      }

      if (!existingTransaction) {
        const payload: Record<string, unknown> = {
          id: crypto.randomUUID(),
          organization_id: organizationId,
          date: nextDueDate,
          description: template.description,
          amount: Number(template.amount ?? 0),
          is_income: Boolean(template.is_income),
          accounting_type: template.accounting_type ?? (template.is_income ? 'Revenue' : 'Expense'),
          subtype: template.subtype ?? 'Other',
          bucket_id: null,
          vendor_customer_name: null,
          bank_account_id: template.bank_account_id ?? null,
          assigned_bank_account_id: template.bank_account_id ?? null,
          notes: marker,
          source_type: 'RECURRING',
          source_reference_id: template.id,
          workflow_stage: 'ENTRY',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }

        const insertError = await insertRecurringTransactionWithFallbackStatus(admin, payload)
        if (insertError) {
          console.error('[Recurring Materialize] Failed to create recurring transaction:', insertError.message)
          break
        }
      }

      lastGeneratedDate = nextDueDate
      occurrences += 1

      const computedNextDueDate = computeNextDueDate(nextDueDate, template.frequency)
      if (computedNextDueDate === nextDueDate) {
        break
      }

      nextDueDate = computedNextDueDate

      if (template.end_date && nextDueDate > template.end_date) {
        nextStatus = 'Completed'
        break
      }
    }

    if (
      nextDueDate !== template.next_due_date ||
      lastGeneratedDate !== (template.last_generated_date ?? null) ||
      occurrences !== Number(template.occurrences_count ?? 0) ||
      nextStatus !== (template.status ?? 'Active')
    ) {
      const { error: updateError } = await admin
        .from('recurring_transaction_templates')
        .update({
          next_due_date: nextDueDate,
          last_generated_date: lastGeneratedDate,
          occurrences_count: occurrences,
          status: nextStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', template.id)
        .eq('organization_id', organizationId)

      if (updateError) {
        console.error('[Recurring Materialize] Failed to update template progress:', updateError.message)
      }
    }
  }
}

function isApprovedForCashMovement(
  approvalStatus?: unknown,
  paymentStatus?: unknown,
  transactionStatus?: unknown
) {
  const normalizedApprovalStatus = normalizeUpper(approvalStatus)
  const normalizedPaymentStatus = normalizeUpper(paymentStatus)
  const normalizedTransactionStatus = normalizeUpper(transactionStatus)

  const approvalSatisfied =
    normalizedApprovalStatus === 'APPROVED' ||
    normalizedApprovalStatus === 'APPROVED_FOR_PAYMENT' ||
    normalizedTransactionStatus === 'APPROVED'

  const paymentSatisfied = normalizedPaymentStatus === 'PAID'

  return approvalSatisfied && paymentSatisfied
}

function calculateCashEffect(amount: unknown, isIncome: unknown) {
  const normalizedAmount = Number(amount ?? 0)
  if (!Number.isFinite(normalizedAmount) || normalizedAmount === 0) {
    return 0
  }

  return Boolean(isIncome) ? normalizedAmount : -normalizedAmount
}
  //   const errors: string[] = []
  //   for (const query of variants) {
  //     const { data, error } = await query()
  //     if (!error) {
  //       return { data: data ?? [], error: null }
  //     }
  //     errors.push(error.message)
  //   }

  //   return { data: [], error: { message: errors.join(' | ') } }
  // }

  export async function GET(request: Request) {
    try {
      const authorized = await getAuthorizedProfile(request)
      if ('error' in authorized) {
        return authorized.error
      }

      const { admin, profile } = authorized
      const organizationId = profile.organization_id
      if (!organizationId) {
        return NextResponse.json({ error: 'No organization linked to this user' }, { status: 400 })
      }

      try {
        await materializeRecurringTransactions(admin, organizationId)
      } catch (materializeError) {
        console.error('[Transactions API] Recurring materialization failed:', materializeError)
      }

      const { data, error } = await selectTransactionsByOrganization(admin, organizationId)
      if (error) {
        return NextResponse.json({ error: `Failed to fetch transactions: ${error.message}` }, { status: 400 })
      }

      return NextResponse.json({ transactions: data }, { status: 200 })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected server error'
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  async function updateInvoiceStatusIfPaid(
    admin: ReturnType<typeof getAdminClient>,
    organizationId: string,
    invoiceId: string | null | undefined,
    paymentStatus: string | undefined
  ) {
    // Only update invoice status if payment_status is being set to 'Paid' and invoice exists
    if (!invoiceId || normalizeToken(paymentStatus) !== 'PAID') {
      return
    }

    try {
      // Update invoice status to 'Paid'
      const { error } = await admin
        .from('invoices')
        .update({
          status: 'Paid',
          updated_at: new Date().toISOString(),
        })
        .eq('id', invoiceId)
        .eq('organization_id', organizationId)

      if (error) {
        console.error(
          `[Invoice Status Update] Failed to update invoice ${invoiceId} to Paid:`,
          error.message
        )
      }
    } catch (err) {
      console.error(
        `[Invoice Status Update] Unexpected error updating invoice ${invoiceId}:`,
        err instanceof Error ? err.message : 'Unknown error'
      )
    }
  }

  export async function POST(request: Request) {
    try {
      const authorized = await getAuthorizedProfile(request)
      if ('error' in authorized) {
        return authorized.error
      }

      const { admin, profile } = authorized
      const body = (await request.json()) as RequestBody
      const transaction = body.transaction
      const normalizedTransaction = transaction as any
      const incomingPaymentStatus = normalizedTransaction?.paymentStatus ?? normalizedTransaction?.payment_status
      const incomingReconciliationStatus =
        normalizedTransaction?.reconciliationStatus ?? normalizedTransaction?.reconciliation_status
      const incomingBankStatementReference =
        normalizedTransaction?.bankStatementReference ?? normalizedTransaction?.bank_statement_reference
      const bankAccountId = normalizedTransaction?.bankAccountId ?? normalizedTransaction?.bank_account_id ?? null
      const isIncome = normalizedTransaction?.isIncome ?? normalizedTransaction?.is_income
      const incomingApprovalStatus = normalizedTransaction?.approvalStatus ?? normalizedTransaction?.approval_status

      const organizationId = profile.organization_id
      if (!organizationId) {
        return NextResponse.json({ error: 'No organization linked to this user' }, { status: 400 })
      }

      // Status-only fast path for inline dropdown updates.
      // This avoids failing on missing full transaction fields (date/description/amount)
      // when callers only intend to update payment/reconciliation metadata.
      if (transaction?.id && incomingPaymentStatus !== undefined && isPaymentOnlyUpdate(transaction)) {
        if (!isAccountantRole(profile.role)) {
          return NextResponse.json({ error: 'Only Accountant users can edit transactions' }, { status: 403 })
        }

        const candidates = paymentStatusCandidates(incomingPaymentStatus)
        let updatedData: any = null
        let lastError: { message: string } | null = null
        let usedStatusValue = String(incomingPaymentStatus)

        const { data: oldTxn } = await admin
          .from('transactions')
          .select('amount, is_income, bank_account_id, approval_status, payment_status, status')
          .eq('id', transaction.id)
          .eq('organization_id', organizationId)
          .maybeSingle()

        for (const candidate of candidates) {
          const statusOnlyPayload: Record<string, unknown> = {
            payment_status: candidate,
          }

          if (incomingReconciliationStatus !== undefined) {
            statusOnlyPayload.reconciliation_status = incomingReconciliationStatus
          }

          if (incomingBankStatementReference !== undefined) {
            statusOnlyPayload.bank_statement_reference = incomingBankStatementReference
          }

          const { data, error } = await admin
            .from('transactions')
            .update(statusOnlyPayload)
            .eq('id', transaction.id)
            .eq('organization_id', organizationId)
            .select('*')
            .single()

          if (!error) {
            updatedData = data
            usedStatusValue = candidate
            lastError = null
            break
          }

          lastError = error
          if (!isPaymentStatusConstraintError(error.message)) {
            break
          }
        }

        if (lastError || !updatedData) {
          return NextResponse.json({ error: `Unable to update transaction status: ${lastError?.message ?? 'Unknown error'}` }, { status: 400 })
        }

        const invoiceId = transaction.invoiceId ?? normalizedTransaction?.invoice_id ?? normalizedTransaction?.invoice_reference
        await updateInvoiceStatusIfPaid(admin, organizationId, invoiceId, usedStatusValue)

        const oldPosted = isApprovedForCashMovement(
          oldTxn?.approval_status,
          oldTxn?.payment_status,
          oldTxn?.status
        )
        const newPosted = isApprovedForCashMovement(
          updatedData?.approval_status,
          updatedData?.payment_status,
          updatedData?.status
        )
        const oldEffect = oldPosted ? calculateCashEffect(oldTxn?.amount, oldTxn?.is_income) : 0
        const newEffect = newPosted ? calculateCashEffect(updatedData?.amount, updatedData?.is_income) : 0

        if (oldTxn?.bank_account_id) {
          const delta = newEffect - oldEffect
          if (delta !== 0) {
            await adjustBankAccountBalance(admin, oldTxn.bank_account_id, delta)
          }
        }

        return NextResponse.json({ transaction: updatedData }, { status: 200 })
      }

      // Removed role-based approval check - any authenticated user can now approve transactions
      // Previously only Accountant/CA roles could approve
      if (!transaction || !transaction.description?.trim() || !Number.isFinite(transaction.amount) || !transaction.date) {
        return NextResponse.json({ error: 'Transaction date, description and amount are required' }, { status: 400 })
      }

      // UPDATE existing transaction
      if (transaction.id) {
        if (!isAccountantRole(profile.role)) {
          return NextResponse.json({ error: 'Only Accountant users can edit transactions' }, { status: 403 })
        }

        // Fetch the old transaction so we can reverse its effect on the bank balance
        const { data: oldTxn } = await admin
          .from('transactions')
          .select('amount, is_income, bank_account_id, approval_status, payment_status, status')
          .eq('id', transaction.id)
          .maybeSingle()

        const payload = buildTransactionPayload(transaction, organizationId)
        let { data, error } = await admin
          .from('transactions')
          .update(payload)
          .eq('id', transaction.id)
          .select('*')
          .single()

        // Retry loop: keep stripping unknown columns until the update succeeds
        let retryPayload: Record<string, unknown> = payload
        let retryCount = 0
        while (error && isMissingSourceColumnsError(error.message) && retryCount < 5) {
          retryPayload = stripUnsupportedColumns(retryPayload, error.message)
          ;({ data, error } = await admin
            .from('transactions')
            .update(retryPayload as any)
            .eq('id', transaction.id)
            .select('*')
            .single())
          retryCount++
        }

        if (error) {
          return NextResponse.json({ error: `Unable to update transaction: ${error.message}` }, { status: 400 })
        }

        if (hasTransactionTaxLineFields(normalizedTransaction)) {
          const taxLineError = await replaceTransactionTaxLines(
            admin,
            organizationId,
            transaction.id,
            normalizedTransaction,
            profile.id
          )
          if (taxLineError) {
            return NextResponse.json(
              { error: `Unable to save transaction tax lines: ${taxLineError.message}` },
              { status: 400 }
            )
          }
        }

        if (hasTransactionItemFields(normalizedTransaction)) {
          const itemError = await upsertTransactionItem(admin, organizationId, transaction.id, normalizedTransaction)
          if (itemError) {
            return NextResponse.json(
              { error: `Unable to save transaction items: ${itemError.message}` },
              { status: 400 }
            )
          }
        }

        // Update invoice status to 'Paid' if transaction payment status is updated to 'Paid'
        const invoiceId = transaction.invoiceId ?? normalizedTransaction?.invoice_id ?? normalizedTransaction?.invoice_reference
        await updateInvoiceStatusIfPaid(admin, organizationId, invoiceId, transaction.paymentStatus ?? normalizedTransaction?.payment_status)

        // Cash movement happens only after approval, not at draft/edit stage.
        const oldAccountId = oldTxn?.bank_account_id ?? null
        const newAccountId = bankAccountId ?? normalizedTransaction?.bankAccountId ?? normalizedTransaction?.bank_account_id ?? oldAccountId
        const effectiveApprovalStatus = incomingApprovalStatus ?? oldTxn?.approval_status
        const effectivePaymentStatus = incomingPaymentStatus ?? oldTxn?.payment_status
        const effectiveTransactionStatus = transaction.status ?? oldTxn?.status
        const oldPosted = isApprovedForCashMovement(oldTxn?.approval_status, oldTxn?.payment_status, oldTxn?.status)
        const newPosted = isApprovedForCashMovement(effectiveApprovalStatus, effectivePaymentStatus, effectiveTransactionStatus)
        const oldEffect = oldPosted ? calculateCashEffect(oldTxn?.amount, oldTxn?.is_income) : 0
        const newEffect = newPosted ? calculateCashEffect(transaction.amount, isIncome) : 0

        if (oldAccountId && oldAccountId === newAccountId) {
          const delta = newEffect - oldEffect
          if (delta !== 0) {
            await adjustBankAccountBalance(admin, oldAccountId, delta)
          }
        } else {
          if (oldAccountId && oldEffect !== 0) {
            await adjustBankAccountBalance(admin, oldAccountId, -oldEffect)
          }

          if (newAccountId && newEffect !== 0) {
            await adjustBankAccountBalance(admin, newAccountId, newEffect)
          }
        }

        return NextResponse.json({ transaction: data }, { status: 200 })
      }

      // INSERT new transaction
      const resolvedId = crypto.randomUUID()
      const payload = buildTransactionPayload(transaction, organizationId, resolvedId)
      let { data, error } = await admin
        .from('transactions')
        .insert(payload)
        .select('*')
        .single()

      // Retry loop: keep stripping unknown columns until the insert succeeds
      let insertRetryPayload: Record<string, unknown> = payload
      let insertRetryCount = 0
      while (error && isMissingSourceColumnsError(error.message) && insertRetryCount < 5) {
        insertRetryPayload = stripUnsupportedColumns(insertRetryPayload, error.message)
        ;({ data, error } = await admin
          .from('transactions')
          .insert(insertRetryPayload as any)
          .select('*')
          .single())
        insertRetryCount++
      }

      if (error) {
        return NextResponse.json({ error: `Unable to create transaction: ${error.message}` }, { status: 400 })
      }

      if (hasTransactionTaxLineFields(normalizedTransaction)) {
        const taxLineError = await replaceTransactionTaxLines(
          admin,
          organizationId,
          resolvedId,
          normalizedTransaction,
          profile.id
        )
        if (taxLineError) {
          return NextResponse.json(
            { error: `Unable to save transaction tax lines: ${taxLineError.message}` },
            { status: 400 }
          )
        }
      }

      if (hasTransactionItemFields(normalizedTransaction)) {
        const itemError = await upsertTransactionItem(admin, organizationId, resolvedId, normalizedTransaction)
        if (itemError) {
          return NextResponse.json(
            { error: `Unable to save transaction items: ${itemError.message}` },
            { status: 400 }
          )
        }
      }

      // Update invoice status to 'Paid' if transaction payment status is set to 'Paid'
      const invoiceId = transaction.invoiceId ?? normalizedTransaction?.invoice_id ?? normalizedTransaction?.invoice_reference
      await updateInvoiceStatusIfPaid(admin, organizationId, invoiceId, transaction.paymentStatus ?? normalizedTransaction?.payment_status)

      // Cash movement for new transaction only if it's already approved.
      if (bankAccountId && isApprovedForCashMovement(incomingApprovalStatus, incomingPaymentStatus, transaction.status)) {
        const delta = calculateCashEffect(transaction.amount, isIncome)
        if (delta !== 0) {
          await adjustBankAccountBalance(admin, bankAccountId, delta)
        }
      }

      return NextResponse.json({ transaction: data }, { status: 200 })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected server error'
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }

  export async function DELETE(request: Request) {
    try {
      const authorized = await getAuthorizedProfile(request)
      if ('error' in authorized) {
        return authorized.error
      }

      const { admin, profile } = authorized
      const organizationId = profile.organization_id
      if (!organizationId) {
        return NextResponse.json({ error: 'No organization linked to this user' }, { status: 400 })
      }

      const requestUrl = new URL(request.url)
      const transactionId = requestUrl.searchParams.get('id')
      if (!transactionId) {
        return NextResponse.json({ error: 'Transaction id is required' }, { status: 400 })
      }

      const { data: existingTransaction, error: fetchError } = await admin
        .from('transactions')
        .select('id, amount, is_income, bank_account_id, organization_id, approval_status, payment_status, status')
        .eq('id', transactionId)
        .maybeSingle()

      if (fetchError) {
        return NextResponse.json({ error: `Unable to load transaction: ${fetchError.message}` }, { status: 400 })
      }

      if (!existingTransaction || existingTransaction.organization_id !== organizationId) {
        return NextResponse.json({ error: 'Transaction not found' }, { status: 404 })
      }

      const { error: deleteError } = await admin
        .from('transactions')
        .delete()
        .eq('id', transactionId)

      if (deleteError) {
        return NextResponse.json({ error: `Unable to delete transaction: ${deleteError.message}` }, { status: 400 })
      }

      if (
        existingTransaction.bank_account_id &&
        isApprovedForCashMovement(
          existingTransaction.approval_status,
          existingTransaction.payment_status,
          existingTransaction.status
        )
      ) {
        const reversal = -calculateCashEffect(existingTransaction.amount, existingTransaction.is_income)
        if (reversal !== 0) {
          await adjustBankAccountBalance(admin, existingTransaction.bank_account_id, reversal)
        }
      }

      return NextResponse.json({ success: true }, { status: 200 })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected server error'
      return NextResponse.json({ error: message }, { status: 500 })
    }
  }
