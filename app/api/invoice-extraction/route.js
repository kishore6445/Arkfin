import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { PDFParse } from 'pdf-parse'

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024

async function extractReadableContent(file) {
  const fileName = file.name.toLowerCase()
  const contentType = (file.type || '').toLowerCase()

  if (fileName.endsWith('.pdf') || contentType.includes('pdf')) {
    try {
      const parser = new PDFParse({ data: new Uint8Array(await file.arrayBuffer()) })
      const parsed = await parser.getText()
      await parser.destroy()
      const text = parsed?.text?.trim() ?? ''
      return { text, extractor: 'pdf-parse' }
    } catch {
      return { text: '', extractor: 'pdf-parse-failed' }
    }
  }

  try {
    const text = await file.text()
    return { text, extractor: 'text' }
  } catch {
    return { text: '', extractor: 'text-failed' }
  }
}

function getAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  }

  return createClient(supabaseUrl, serviceRoleKey)
}

async function getAuthorizedProfile(request) {
  const authHeader = request.headers.get('authorization')
  const headerToken = authHeader?.startsWith('Bearer ') ? authHeader.replace('Bearer ', '') : null
  const fallbackHeaderToken = request.headers.get('x-access-token')
  const fallbackUserIdHeader = request.headers.get('x-user-id')
  const fallbackOrganizationIdHeader = request.headers.get('x-organization-id')
  const requestUrl = new URL(request.url)

  const accessToken = headerToken ?? fallbackHeaderToken
  const admin = getAdminClient()

  if (!accessToken) {
    const fallbackUserId = fallbackUserIdHeader ?? requestUrl.searchParams.get('userId')
    const fallbackOrganizationId =
      fallbackOrganizationIdHeader ?? requestUrl.searchParams.get('organizationId')

    if (!fallbackUserId || !fallbackOrganizationId) {
      return { error: NextResponse.json({ error: 'Missing authorization token' }, { status: 401 }) }
    }

    const { data: profile, error: profileError } = await admin
      .from('users')
      .select('id, organization_id, is_active')
      .eq('id', fallbackUserId)
      .maybeSingle()

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
    .maybeSingle()

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

function toParsedNumber(value) {
  if (!value) {
    return undefined
  }

  const parsed = Number.parseFloat(String(value).replace(/,/g, ''))
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseAmountAfterKeyword(normalized, keywordRegex) {
  const match = normalized.match(keywordRegex)
  if (!match) {
    return undefined
  }

  // Prefer captured groups first; fallback to first number token in the whole match
  for (let i = 1; i < match.length; i += 1) {
    const parsed = toParsedNumber(match[i])
    if (parsed !== undefined) {
      return parsed
    }
  }

  const fallback = match[0].match(/([\d,]+(?:\.\d{1,2})?)/)
  return toParsedNumber(fallback?.[1])
}

function toTreatment(value) {
  if (typeof value !== 'string') {
    return undefined
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'taxable') return 'Taxable'
  if (normalized === 'exempt') return 'Exempt'
  if (normalized === 'nil-rated' || normalized === 'nil rated') return 'Nil-rated'
  if (normalized === 'rcm' || normalized === 'reverse charge') return 'RCM'
  return undefined
}

function tryExtractTaxFieldsFromText(text) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const extracted = {}

  const gstRateMatch = normalized.match(/(?:gst(?:\s+rate)?|tax\s*rate|rate)\s*[@:=\-]?\s*(\d{1,2}(?:\.\d{1,2})?)\s*%/i)
  const hsnSacMatch = normalized.match(/(?:hsn\/?sac|hsn|sac)\s*(?:code)?\s*[:=-]?\s*([A-Za-z0-9\-/]{3,12})/i)
  const cgstAmount = parseAmountAfterKeyword(
    normalized,
    /cgst(?:\s*\([^)]*\)|\s*@\s*\d{1,2}(?:\.\d{1,2})?\s*%)?\s*[:=-]?\s*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i
  )
  const sgstAmount = parseAmountAfterKeyword(
    normalized,
    /sgst(?:\s*\([^)]*\)|\s*@\s*\d{1,2}(?:\.\d{1,2})?\s*%)?\s*[:=-]?\s*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i
  )
  const igstAmount = parseAmountAfterKeyword(
    normalized,
    /igst(?:\s*\([^)]*\)|\s*@\s*\d{1,2}(?:\.\d{1,2})?\s*%)?\s*[:=-]?\s*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i
  )

  const gstRate = toParsedNumber(gstRateMatch?.[1])
  const taxableAmount = parseAmountAfterKeyword(
    normalized,
    /(?:taxable\s*value|taxable\s*amount|assessable\s*value|amount\s*before\s*tax)\s*[:=-]?\s*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i
  )
  const totalGstAmount = parseAmountAfterKeyword(
    normalized,
    /(?:total\s*gst|gst\s*amount|tax\s*amount|total\s*tax)\s*[:=-]?\s*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i
  )

  if (gstRate !== undefined) extracted.gstRate = gstRate
  if (hsnSacMatch?.[1]) extracted.hsnSacCode = hsnSacMatch[1]
  if (cgstAmount !== undefined) extracted.cgstAmount = cgstAmount
  if (sgstAmount !== undefined) extracted.sgstAmount = sgstAmount
  if (igstAmount !== undefined) extracted.igstAmount = igstAmount

  if ((igstAmount ?? 0) > 0 || ((cgstAmount ?? 0) > 0 && (sgstAmount ?? 0) > 0)) {
    extracted.gstTreatment = 'Taxable'
  }

  // If explicit component values are not present, infer from total GST + rate + taxable amount.
  if (extracted.gstRate === undefined && taxableAmount !== undefined && totalGstAmount !== undefined && taxableAmount > 0) {
    const inferredRate = (totalGstAmount * 100) / taxableAmount
    if (Number.isFinite(inferredRate) && inferredRate > 0) {
      extracted.gstRate = Math.round(inferredRate * 100) / 100
    }
  }

  if ((extracted.cgstAmount === undefined && extracted.sgstAmount === undefined && extracted.igstAmount === undefined) && totalGstAmount !== undefined) {
    if (normalized.match(/\bigst\b/i)) {
      extracted.igstAmount = totalGstAmount
    } else {
      extracted.cgstAmount = Math.round((totalGstAmount / 2) * 100) / 100
      extracted.sgstAmount = Math.round((totalGstAmount / 2) * 100) / 100
    }
  }

  if (normalized.match(/\bitc\s*eligible\b|\binput\s*tax\s*credit\b/i)) {
    extracted.itcEligible = true
  }

  return extracted
}

function tryExtractTaxFieldsFromJson(content) {
  try {
    const parsed = JSON.parse(content)

    return {
      gstRate: toParsedNumber(parsed.gstRate ?? parsed.gst_rate),
      gstTreatment: toTreatment(parsed.gstTreatment ?? parsed.gst_treatment),
      hsnSacCode:
        String(parsed.hsnSacCode ?? parsed.hsn_sac_code ?? parsed.hsn ?? parsed.sac ?? '') || undefined,
      cgstAmount: toParsedNumber(parsed.cgstAmount ?? parsed.cgst_amount),
      sgstAmount: toParsedNumber(parsed.sgstAmount ?? parsed.sgst_amount),
      igstAmount: toParsedNumber(parsed.igstAmount ?? parsed.igst_amount),
      itcEligible:
        typeof parsed.itcEligible === 'boolean'
          ? parsed.itcEligible
          : typeof parsed.itc_eligible === 'boolean'
            ? parsed.itc_eligible
            : undefined,
    }
  } catch {
    return {}
  }
}

function tryExtractTaxFieldsFromCsv(content) {
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  if (lines.length < 2) {
    return tryExtractTaxFieldsFromText(content)
  }

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase())
  const values = lines[1].split(',').map((v) => v.trim())

  const get = (...possible) => {
    for (const key of possible) {
      const idx = headers.findIndex((h) => h === key)
      if (idx >= 0) {
        return values[idx]
      }
    }
    return undefined
  }

  const extracted = {
    gstRate: toParsedNumber(get('gstrate', 'gst_rate', 'gst rate', 'tax_rate', 'tax rate')),
    gstTreatment: toTreatment(get('gsttreatment', 'gst_treatment', 'gst treatment')),
    hsnSacCode: get('hsnsaccode', 'hsn_sac_code', 'hsn/sac', 'hsn', 'sac'),
    cgstAmount: toParsedNumber(get('cgstamount', 'cgst_amount', 'cgst')),
    sgstAmount: toParsedNumber(get('sgstamount', 'sgst_amount', 'sgst')),
    igstAmount: toParsedNumber(get('igstamount', 'igst_amount', 'igst')),
  }

  const itcRaw = get('itceligible', 'itc_eligible', 'itc eligible')
  if (itcRaw) {
    extracted.itcEligible = ['true', 'yes', '1', 'y'].includes(itcRaw.toLowerCase())
  }

  return extracted
}

function countExtractedFields(extracted) {
  return Object.values(extracted).filter((value) => value !== undefined && value !== null && value !== '').length
}

function extractInvoiceCoreFromText(text) {
  const normalized = text.replace(/\s+/g, ' ').trim()
  const invoiceNoMatch = normalized.match(/(?:invoice\s*(?:no|number|#)|bill\s*(?:no|number|#))\s*[:=-]?\s*([A-Za-z0-9\-/]{3,30})/i)
  const partyMatch = normalized.match(/(?:party|vendor|supplier|customer|buyer|bill\s*to)\s*[:=-]?\s*([A-Za-z0-9 .,&()\-/]{3,80})/i)
  const totalMatch = normalized.match(/(?:total\s*amount|invoice\s*amount|grand\s*total)\s*[:=-]?\s*(?:rs\.?|inr|₹)?\s*([\d,]+(?:\.\d{1,2})?)/i)
  const dueMatch = normalized.match(/(?:due\s*date|payment\s*due)\s*[:=-]?\s*(\d{4}-\d{2}-\d{2}|\d{2}[-\/]\d{2}[-\/]\d{4})/i)

  return {
    invoiceNo: invoiceNoMatch?.[1],
    partyName: partyMatch?.[1]?.trim(),
    invoiceAmount: toParsedNumber(totalMatch?.[1]),
    dueDate: dueMatch?.[1],
  }
}

function extractInvoiceCoreFromJson(content) {
  try {
    const parsed = JSON.parse(content)
    return {
      invoiceNo: String(parsed.invoiceNo ?? parsed.invoice_no ?? parsed.invoiceno ?? '') || undefined,
      partyName: String(parsed.partyName ?? parsed.party_name ?? parsed.party ?? '') || undefined,
      invoiceAmount: toParsedNumber(parsed.invoiceAmount ?? parsed.invoice_amount ?? parsed.totalAmount ?? parsed.total_amount),
      dueDate: String(parsed.dueDate ?? parsed.due_date ?? '') || undefined,
    }
  } catch {
    return {}
  }
}

function normalizeDate(value) {
  if (!value) {
    return undefined
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value
  }

  if (/^\d{2}[\/-]\d{2}[\/-]\d{4}$/.test(value)) {
    const [d, m, y] = value.split(/[\/-]/)
    return `${y}-${m}-${d}`
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return undefined
  }

  return parsed.toISOString().slice(0, 10)
}

async function insertUploadedInvoiceWithFallbacks(admin, organizationId, invoice, upload) {
  const status = 'Unpaid'
  const invoiceDate = new Date().toISOString().slice(0, 10)
  const safeRawContent = upload.rawContent.slice(0, 200000)
  const baseSnake = {
    organization_id: organizationId,
    invoice_no: invoice.invoiceNo,
    party_name: invoice.partyName,
    type: invoice.type,
    invoice_amount: invoice.invoiceAmount,
    paid_amount: 0,
    invoice_date: invoiceDate,
    due_date: invoice.dueDate,
    status,
  }

  const payloadVariants = [
    {
      ...baseSnake,
      source_file_name: upload.fileName,
      source_file_type: upload.fileType,
      source_raw_content: safeRawContent,
      extraction_payload: upload.extractionPayload,
      linked_transaction_id: upload.transactionId ?? null,
      is_external_upload: true,
    },
    {
      ...baseSnake,
      source_file_name: upload.fileName,
      source_file_type: upload.fileType,
      source_raw_content: safeRawContent,
      extraction_payload: upload.extractionPayload,
      is_external_upload: true,
    },
    {
      ...baseSnake,
    },
    {
      organizationid: organizationId,
      invoiceno: invoice.invoiceNo,
      partyname: invoice.partyName,
      type: invoice.type,
      invoiceamount: invoice.invoiceAmount,
      paidamount: 0,
      invoicedate: invoiceDate,
      due_date: invoice.dueDate,
      status,
    },
  ]

  const errors = []
  for (const payload of payloadVariants) {
    const { data, error } = await admin.from('invoices').insert(payload).select('*').single()
    if (!error) {
      return { data, error: null }
    }
    errors.push(error.message)
  }

  return { data: null, error: { message: `Unable to persist uploaded invoice: ${errors.join(' | ')}` } }
}

export async function POST(request) {
  try {
    const authorized = await getAuthorizedProfile(request)
    if ('error' in authorized) {
      return authorized.error
    }

    const { admin, profile } = authorized
    const formData = await request.formData()
    const file = formData.get('file')
    const transactionIdRaw = formData.get('transactionId')
    const accountingTypeRaw = formData.get('accountingType')
    const transactionId = typeof transactionIdRaw === 'string' ? transactionIdRaw : null
    const accountingType = typeof accountingTypeRaw === 'string' ? accountingTypeRaw : null

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Missing invoice file' }, { status: 400 })
    }

    if (file.size > MAX_FILE_SIZE_BYTES) {
      return NextResponse.json({ error: 'File is too large. Max 10 MB allowed.' }, { status: 400 })
    }

    const fileName = file.name.toLowerCase()
    const contentType = (file.type || '').toLowerCase()
    const { text, extractor } = await extractReadableContent(file)

    let extracted = {}

    if (fileName.endsWith('.json') || contentType.includes('application/json')) {
      extracted = tryExtractTaxFieldsFromJson(text)
    } else if (fileName.endsWith('.csv') || contentType.includes('text/csv')) {
      extracted = tryExtractTaxFieldsFromCsv(text)
    } else if (
      fileName.endsWith('.txt') ||
      fileName.endsWith('.xml') ||
      fileName.endsWith('.html') ||
      fileName.endsWith('.htm') ||
      contentType.startsWith('text/')
    ) {
      extracted = tryExtractTaxFieldsFromText(text)
    } else {
      extracted = tryExtractTaxFieldsFromText(text)
    }

    const extractedCount = countExtractedFields(extracted)

    const coreFromJson = tryExtractTaxFieldsFromJson(text)
    const extractedCoreFromText = extractInvoiceCoreFromText(text)
    const extractedCoreFromJson = extractInvoiceCoreFromJson(text)
    const inferredAmount =
      extractedCoreFromJson.invoiceAmount ??
      extractedCoreFromText.invoiceAmount ??
      ((extracted.cgstAmount ?? 0) + (extracted.sgstAmount ?? 0) + (extracted.igstAmount ?? 0))

    const invoiceNo =
      extractedCoreFromJson.invoiceNo ??
      extractedCoreFromText.invoiceNo ??
      `EXT-${Date.now()}`
    const partyName =
      extractedCoreFromJson.partyName ??
      extractedCoreFromText.partyName ??
      'External Invoice'
    const dueDate =
      normalizeDate(extractedCoreFromJson.dueDate) ??
      normalizeDate(extractedCoreFromText.dueDate) ??
      new Date().toISOString().slice(0, 10)

    const invoiceType = accountingType === 'Expense' ? 'Expense' : 'Revenue'
    const invoiceAmount = Number.isFinite(inferredAmount) && inferredAmount > 0 ? Number(inferredAmount) : 0

    const persisted = await insertUploadedInvoiceWithFallbacks(
      admin,
      profile.organization_id,
      {
        invoiceNo,
        partyName,
        invoiceAmount,
        dueDate,
        type: invoiceType,
      },
      {
        fileName: file.name,
        fileType: file.type || 'unknown',
        rawContent: text,
        extractionPayload: {
          extracted,
          extractedCount,
          coreFromJson,
          extractedCoreFromText,
          extractedCoreFromJson,
        },
        transactionId,
      }
    )

    return NextResponse.json(
      {
        extracted,
        meta: {
          fileName: file.name,
          fileType: file.type || 'unknown',
          extractionSource: extractor,
          extractedCount,
          needsManualReview: extractedCount === 0,
          invoicePersisted: !persisted.error,
          persistedInvoiceId: persisted.data?.id ?? null,
          persistError: persisted.error?.message,
          message:
            extractedCount === 0
              ? extractor === 'pdf-parse' && !text
                ? 'PDF uploaded but no readable text was found (likely scanned/image PDF). Please upload text/JSON/CSV or use OCR-enabled invoice files.'
                : extractor === 'pdf-parse-failed'
                  ? 'Could not read text from this PDF. Please try another PDF or upload JSON/CSV/TXT.'
                  : 'Could not confidently extract GST fields from this file type/content. Fill manually or upload a readable PDF/text/JSON/CSV.'
              : 'Invoice content normalized successfully.',
        },
      },
      { status: 200 }
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to process invoice file'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
