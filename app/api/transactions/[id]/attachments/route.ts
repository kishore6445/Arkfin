import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const dynamic = 'force-dynamic'

type RouteContext = { params: { id: string } }

type AttachmentPayload = {
  id?: string
  fileName: string
  fileType?: string | null
  fileSizeBytes?: number | null
  storagePath: string
  uploadedBy?: string | null
  uploadedAt?: string | null
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
  if (!authHeader?.startsWith('Bearer ')) {
    return { error: NextResponse.json({ error: 'Missing authorization token' }, { status: 401 }) }
  }

  const accessToken = authHeader.replace('Bearer ', '')
  const admin = getAdminClient()

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

export async function GET(request: Request, context: RouteContext) {
  try {
    const authorized = await getAuthorizedProfile(request)
    if ('error' in authorized) {
      return authorized.error
    }

    const { admin, profile } = authorized
    const transactionId = context.params.id

    const { data, error } = await admin
      .from('transaction_attachments')
      .select('*')
      .eq('transaction_id', transactionId)
      .eq('organization_id', profile.organization_id)
      .order('uploaded_at', { ascending: false })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ attachments: data ?? [] }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const authorized = await getAuthorizedProfile(request)
    if ('error' in authorized) {
      return authorized.error
    }

    const { admin, profile } = authorized
    const transactionId = context.params.id
    const body = (await request.json()) as AttachmentPayload

    if (!body.fileName?.trim() || !body.storagePath?.trim()) {
      return NextResponse.json({ error: 'fileName and storagePath are required' }, { status: 400 })
    }

    const payload = {
      id: body.id ?? crypto.randomUUID(),
      transaction_id: transactionId,
      organization_id: profile.organization_id,
      file_name: body.fileName.trim(),
      file_type: body.fileType ?? null,
      file_size_bytes: body.fileSizeBytes ?? null,
      storage_path: body.storagePath.trim(),
      uploaded_by: body.uploadedBy ?? profile.id,
      uploaded_at: body.uploadedAt ?? new Date().toISOString(),
    }

    const { data, error } = await admin
      .from('transaction_attachments')
      .insert(payload)
      .select('*')
      .single()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ attachment: data }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const authorized = await getAuthorizedProfile(request)
    if ('error' in authorized) {
      return authorized.error
    }

    const { admin, profile } = authorized
    const transactionId = context.params.id
    const attachmentId = new URL(request.url).searchParams.get('attachmentId')

    if (!attachmentId) {
      return NextResponse.json({ error: 'attachmentId is required' }, { status: 400 })
    }

    const { error } = await admin
      .from('transaction_attachments')
      .delete()
      .eq('id', attachmentId)
      .eq('transaction_id', transactionId)
      .eq('organization_id', profile.organization_id)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    return NextResponse.json({ success: true }, { status: 200 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected server error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
