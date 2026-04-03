import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

type RecurringTransactionRequest = {
  id?: string
  description: string
  amount: number
  type: 'Revenue' | 'Expense'
  frequency: 'Weekly' | 'Biweekly' | 'Monthly' | 'Quarterly' | 'Annually'
  startDate: string
  endDate?: string
  status?: 'Active' | 'Paused' | 'Completed'
  subtype?: string
  accountingType?: 'Revenue' | 'Expense' | 'Asset' | 'Liability'
  notes?: string
  autoApply?: boolean
  accessToken?: string
  userId?: string
  organizationId?: string
}

type UserProfileRow = {
  id: string
  organization_id: string | null
  is_active: boolean | null
}

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
      const body = (await clonedRequest.json()) as RecurringTransactionRequest
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

function normalizeFrequency(value: string | undefined) {
  const normalized = (value ?? 'Monthly').trim()
  if (normalized === 'Weekly' || normalized === 'Biweekly' || normalized === 'Monthly' || normalized === 'Quarterly' || normalized === 'Annually') {
    return normalized
  }
  return 'Monthly'
}

function parseDate(value: string | undefined) {
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString().slice(0, 10)
}

function toRecurringApiErrorMessage(errorMessage: string) {
  const normalized = errorMessage.toLowerCase()
  if (
    normalized.includes('recurring_transaction_templates') &&
    (normalized.includes('does not exist') || normalized.includes('not found') || normalized.includes('relation'))
  ) {
    return 'Recurring templates table is missing. Run migration: database/migrations/2026-03-30_add_recurring_transaction_templates.sql'
  }

  return errorMessage
}

export async function GET(request: Request) {
  try {
    const authorized = await getAuthorizedProfile(request)
    if ('error' in authorized) return authorized.error

    const { admin, profile } = authorized
    const organizationId = profile.organization_id
    if (!organizationId) {
      return NextResponse.json({ error: 'No organization linked to this user' }, { status: 400 })
    }

    const { data, error } = await admin
      .from('recurring_transaction_templates')
      .select('*')
      .eq('organization_id', organizationId)
      .order('created_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: toRecurringApiErrorMessage(error.message) }, { status: 400 })
    }

    return NextResponse.json({ recurringTransactions: data ?? [] }, { status: 200 })
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

    const body = (await request.json()) as RecurringTransactionRequest

    if (!body.description?.trim() || !body.amount || !body.startDate) {
      return NextResponse.json({ error: 'description, amount and startDate are required' }, { status: 400 })
    }

    const startDate = parseDate(body.startDate)
    if (!startDate) {
      return NextResponse.json({ error: 'Invalid startDate' }, { status: 400 })
    }

    const endDate = parseDate(body.endDate)

    const payload = {
      id: crypto.randomUUID(),
      organization_id: organizationId,
      description: body.description.trim(),
      amount: Number(body.amount),
      is_income: body.type === 'Revenue',
      accounting_type: body.accountingType ?? (body.type === 'Revenue' ? 'Revenue' : 'Expense'),
      subtype: body.subtype?.trim() || 'Other',
      frequency: normalizeFrequency(body.frequency),
      start_date: startDate,
      end_date: endDate,
      next_due_date: startDate,
      status: body.status ?? 'Active',
      auto_apply: body.autoApply !== false,
      notes: body.notes?.trim() || null,
      created_by: profile.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }

    const { data, error } = await admin
      .from('recurring_transaction_templates')
      .insert(payload)
      .select('*')
      .single()

    if (error) {
      return NextResponse.json({ error: toRecurringApiErrorMessage(error.message) }, { status: 400 })
    }

    return NextResponse.json({ recurringTransaction: data }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const authorized = await getAuthorizedProfile(request)
    if ('error' in authorized) return authorized.error

    const { admin, profile } = authorized
    const organizationId = profile.organization_id
    if (!organizationId) {
      return NextResponse.json({ error: 'No organization linked to this user' }, { status: 400 })
    }

    const body = (await request.json()) as RecurringTransactionRequest
    if (!body.id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const updatePayload: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (typeof body.description === 'string') updatePayload.description = body.description.trim()
    if (typeof body.amount === 'number' && body.amount > 0) updatePayload.amount = body.amount
    if (body.type) {
      updatePayload.is_income = body.type === 'Revenue'
      updatePayload.accounting_type = body.accountingType ?? (body.type === 'Revenue' ? 'Revenue' : 'Expense')
    }
    if (body.subtype) updatePayload.subtype = body.subtype.trim()
    if (body.frequency) updatePayload.frequency = normalizeFrequency(body.frequency)
    if (body.status) updatePayload.status = body.status
    if (typeof body.autoApply === 'boolean') updatePayload.auto_apply = body.autoApply
    if (typeof body.notes === 'string') updatePayload.notes = body.notes.trim() || null

    const parsedStartDate = parseDate(body.startDate)
    if (parsedStartDate) updatePayload.start_date = parsedStartDate

    const parsedEndDate = body.endDate === '' ? null : parseDate(body.endDate)
    if (body.endDate !== undefined) updatePayload.end_date = parsedEndDate

    const { data, error } = await admin
      .from('recurring_transaction_templates')
      .update(updatePayload)
      .eq('id', body.id)
      .eq('organization_id', organizationId)
      .select('*')
      .single()

    if (error) {
      return NextResponse.json({ error: toRecurringApiErrorMessage(error.message) }, { status: 400 })
    }

    return NextResponse.json({ recurringTransaction: data }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(request: Request) {
  try {
    const authorized = await getAuthorizedProfile(request)
    if ('error' in authorized) return authorized.error

    const { admin, profile } = authorized
    const organizationId = profile.organization_id
    if (!organizationId) {
      return NextResponse.json({ error: 'No organization linked to this user' }, { status: 400 })
    }

    const requestUrl = new URL(request.url)
    const id = requestUrl.searchParams.get('id')

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    const { error } = await admin
      .from('recurring_transaction_templates')
      .delete()
      .eq('id', id)
      .eq('organization_id', organizationId)

    if (error) {
      return NextResponse.json({ error: toRecurringApiErrorMessage(error.message) }, { status: 400 })
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
