import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

type PayrollRunRequest = {
  payrollMonth?: string
  payrollDate?: string
  status?: 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'PROCESSED' | 'REJECTED'
  totalEmployees?: number
  processedEmployees?: number
  totalGross?: number
  totalDeductions?: number
  totalNet?: number
  approvedBy?: string | null
  approvalDate?: string | null
  processedDate?: string | null
  paidDate?: string | null
  accessToken?: string
  userId?: string
  organizationId?: string
}

type UserProfileRow = {
  id: string
  organization_id: string | null
  is_active: boolean | null
}

type BankAccountRow = {
  id: string
  account_name?: string | null
  balance?: number | null
  is_primary?: boolean | null
  status?: string | null
}

type ExistingPayrollRunRow = {
  id: string
  status?: string | null
  total_net?: number | null
}

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  return createClient<any>(supabaseUrl, serviceRoleKey)
}

function isPayrollCashCommitted(status: string | null | undefined) {
  const s = (status ?? '').trim().toUpperCase()
  return s === 'PROCESSED' || s === 'APPROVED' || s === 'REJECTED'
}

async function findSalaryAccount(admin: ReturnType<typeof getAdminClient>, organizationId: string) {
  const { data, error } = await admin
    .from('bank_accounts')
    .select('id, account_name, balance, is_primary, status')
    .eq('organization_id', organizationId)

  if (error) {
    throw new Error(error.message)
  }

  const accounts = (data ?? []) as BankAccountRow[]
  const activeAccounts = accounts.filter((account) => (account.status ?? 'Active') === 'Active')

  const salaryAccount = activeAccounts.find((account) =>
    (account.account_name ?? '').toLowerCase().includes('salary')
  )

  if (salaryAccount) {
    return salaryAccount
  }

  const primaryAccount = activeAccounts.find((account) => Boolean(account.is_primary))
  return primaryAccount ?? null
}

async function adjustBankAccountBalance(
  admin: ReturnType<typeof getAdminClient>,
  bankAccountId: string,
  delta: number
) {
  if (!bankAccountId || delta === 0) {
    return
  }

  const { data: account, error: accountError } = await admin
    .from('bank_accounts')
    .select('id, balance')
    .eq('id', bankAccountId)
    .maybeSingle<{ id: string; balance?: number | null }>()

  if (accountError) {
    throw new Error(accountError.message)
  }

  if (!account) {
    throw new Error('Salary account not found')
  }

  const currentBalance = Number(account.balance ?? 0)
  const nextBalance = currentBalance + delta

  if (nextBalance < 0) {
    throw new Error('Insufficient balance in salary account for payroll processing')
  }

  const { error: updateError } = await admin
    .from('bank_accounts')
    .update({ balance: nextBalance })
    .eq('id', bankAccountId)

  if (updateError) {
    throw new Error(updateError.message)
  }
}

async function createPayrollTransaction(
  admin: ReturnType<typeof getAdminClient>,
  opts: {
    organizationId: string
    createdBy: string
    payrollMonthShort: string  // YYYY-MM
    payrollDate: string        // YYYY-MM-DD
    totalNet: number
    bankAccountId: string | null
  }
) {
  const { organizationId, createdBy, payrollMonthShort, payrollDate, totalNet, bankAccountId } = opts

  // Check if a payroll transaction already exists for this month to avoid duplicates
  const marker = `[PAYROLL:${payrollMonthShort}]`
  const { data: existing } = await admin
    .from('transactions')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('notes', marker)
    .maybeSingle()

  if (existing?.id) {
    // Update amount in case of re-processing
    await admin
      .from('transactions')
      .update({ amount: totalNet, updated_at: new Date().toISOString() })
      .eq('id', existing.id)
    return
  }

  const statusCandidates = ['Recorded', 'RECORDED', 'DRAFT', 'PENDING']
  for (const status of statusCandidates) {
    const payload: Record<string, unknown> = {
      id: crypto.randomUUID(),
      organization_id: organizationId,
      date: payrollDate,
      description: `Payroll - ${payrollMonthShort}`,
      amount: totalNet,
      is_income: false,
      accounting_type: 'Expense',
      subtype: 'Salary',
      notes: marker,
      source_type: 'payroll',
      status,
      created_by: createdBy,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      ...(bankAccountId ? { bank_account_id: bankAccountId } : {}),
    }

    const { error } = await admin.from('transactions').insert(payload)
    if (!error) break
    // If status constraint, try the next candidate; otherwise stop
    if (!error.message.toLowerCase().includes('status')) break
  }
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
      const body = (await clonedRequest.json()) as PayrollRunRequest
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
      .select('id, organization_id, is_active')
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
    .select('id, organization_id, is_active')
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

export async function GET(request: Request) {
  try {
    const authorized = await getAuthorizedProfile(request)
    if ('error' in authorized) return authorized.error

    const { admin, profile } = authorized
    const organizationId = profile.organization_id

    const { data, error } = await admin
      .from('payroll_runs')
      .select('*')
      .eq('organization_id', organizationId)
      .order('payroll_month', { ascending: false })
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    // Strip DATE column value (YYYY-MM-DD) back to YYYY-MM for the client
    const runs = (data ?? []).map((row: Record<string, unknown>) => ({
      ...row,
      payroll_month:
        typeof row.payroll_month === 'string' && row.payroll_month.length >= 7
          ? row.payroll_month.slice(0, 7)
          : row.payroll_month,
    }))
    return NextResponse.json({ runs }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const authorized = await getAuthorizedProfile(request)
    if ('error' in authorized) return authorized.error

    const { admin, profile } = authorized
    const organizationId = profile.organization_id
    if (!organizationId) {
      return NextResponse.json({ error: 'No organization linked to this user' }, { status: 400 })
    }

    const body = (await request.json()) as PayrollRunRequest
    if (!body.payrollMonth?.trim() || !body.payrollDate?.trim()) {
      return NextResponse.json({ error: 'payrollMonth and payrollDate are required' }, { status: 400 })
    }

    // DB stores payroll_month as DATE; ensure YYYY-MM-01 format
    const payrollMonthShort = body.payrollMonth.trim().slice(0, 7) // "2026-04"
    const payrollMonthDate = payrollMonthShort.length === 7 ? `${payrollMonthShort}-01` : payrollMonthShort

    const now = new Date().toISOString()
    const existingQuery = await admin
      .from('payroll_runs')
      .select('id, status, total_net')
      .eq('organization_id', organizationId)
      .eq('payroll_month', payrollMonthDate)
      .maybeSingle<ExistingPayrollRunRow>()

    if (existingQuery.error && existingQuery.error.code !== 'PGRST116') {
      return NextResponse.json({ error: existingQuery.error.message }, { status: 400 })
    }

    const nextStatus = body.status ?? 'PROCESSED'
    const previousNet = Number(existingQuery.data?.total_net ?? 0)
    const nextNet = Number(body.totalNet ?? 0)
    const previousCommitted = isPayrollCashCommitted(existingQuery.data?.status)
    const nextCommitted = isPayrollCashCommitted(nextStatus)

    let bankDelta = 0
    if (!previousCommitted && nextCommitted) {
      bankDelta = -nextNet
    } else if (previousCommitted && nextCommitted) {
      bankDelta = -(nextNet - previousNet)
    }

    const payload = {
      organization_id: organizationId,
      payroll_month: payrollMonthDate,
      payroll_date: body.payrollDate.trim(),
      status: nextStatus,
      total_employees: Number(body.totalEmployees ?? 0),
      processed_employees: Number(body.processedEmployees ?? 0),
      total_gross: Number(body.totalGross ?? 0),
      total_deductions: Number(body.totalDeductions ?? 0),
      total_net: nextNet,
      approved_by: body.approvedBy ?? null,
      approval_date: body.approvalDate ?? null,
      processed_date: body.processedDate ?? null,
      paid_date: body.paidDate ?? null,
      updated_at: now,
    }

    // Save the payroll run first
    let savedRun: Record<string, unknown>
    let httpStatus: number

    if (existingQuery.data?.id) {
      const { data, error } = await admin
        .from('payroll_runs')
        .update(payload)
        .eq('id', existingQuery.data.id)
        .select('*')
        .single()

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }

      savedRun = data as Record<string, unknown>
      httpStatus = 200
    } else {
      const { data, error } = await admin
        .from('payroll_runs')
        .insert({
          id: crypto.randomUUID(),
          ...payload,
          created_by: profile.id,
          created_at: now,
        })
        .select('*')
        .single()

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 })
      }

      savedRun = data as Record<string, unknown>
      httpStatus = 201
    }

    // Attempt bank debit as a best-effort operation (does not block the payroll save)
    let bankWarning: string | null = null
    let salaryAccountId: string | null = null
    if (bankDelta !== 0) {
      const salaryAccount = await findSalaryAccount(admin, organizationId)
      if (!salaryAccount) {
        bankWarning = 'Payroll run saved, but no active salary account found. Create a bank account named "Salary Account" or mark one as primary to enable automatic bank debit.'
      } else {
        salaryAccountId = salaryAccount.id
        try {
          await adjustBankAccountBalance(admin, salaryAccount.id, bankDelta)
        } catch (bankError) {
          bankWarning = bankError instanceof Error ? bankError.message : 'Bank account debit failed'
        }
      }
    }

    // Create/update a transaction record so Cash Runway outflows reflect the payroll
    if (nextCommitted && nextNet > 0) {
      try {
        await createPayrollTransaction(admin, {
          organizationId,
          createdBy: profile.id,
          payrollMonthShort,
          payrollDate: body.payrollDate.trim(),
          totalNet: nextNet,
          bankAccountId: salaryAccountId,
        })
      } catch {
        // best-effort: transaction creation failure does not fail the payroll run
      }
    }

    // Strip DATE column value back to YYYY-MM for the client
    const clientRun = {
      ...savedRun,
      payroll_month:
        typeof savedRun.payroll_month === 'string' && (savedRun.payroll_month as string).length >= 7
          ? (savedRun.payroll_month as string).slice(0, 7)
          : savedRun.payroll_month,
    }
    return NextResponse.json({ run: clientRun, warning: bankWarning }, { status: httpStatus })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
