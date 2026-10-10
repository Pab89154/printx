/** Cloud Slicer API client — per-admin tokens, quote → grams/hours. */

import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_BASE = 'https://api.cloudslicer3d.com'

export type CloudSlicerCreds = {
  token: string
  printerId: string
  filamentId: string
}

export type CloudSlicerQuoteResult = {
  grams: number
  hours: number
  quoteId: string
  fileId: string
}

function apiBase(): string {
  return (process.env.CLOUD_SLICER_API_BASE?.trim() || DEFAULT_BASE).replace(/\/$/, '')
}

function authHeaders(token: string): HeadersInit {
  return {
    Authorization: `Bearer ${token}`,
  }
}

async function readJsonSafe(res: Response): Promise<Record<string, unknown>> {
  try {
    return (await res.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function maskCloudSlicerToken(token: string): string | null {
  const t = token.trim()
  if (!t) return null
  if (t.length <= 4) return '••••'
  return `••••${t.slice(-4)}`
}

export function cloudSlicerConfigured(creds: Partial<CloudSlicerCreds> | null | undefined): boolean {
  return Boolean(creds?.token?.trim() && creds?.printerId?.trim() && creds?.filamentId?.trim())
}

/** Upload a local STL and return Cloud Slicer file_id. */
export async function uploadStlFile(
  creds: CloudSlicerCreds,
  localPath: string,
  filename: string,
): Promise<string> {
  const buf = fs.readFileSync(localPath)
  const form = new FormData()
  form.append(
    'file',
    new Blob([new Uint8Array(buf)], { type: 'application/octet-stream' }),
    filename,
  )

  const res = await fetch(`${apiBase()}/v1/file`, {
    method: 'POST',
    headers: authHeaders(creds.token),
    body: form,
  })
  const data = await readJsonSafe(res)
  if (!res.ok) {
    throw new Error(
      String(data.error || data.message || data.detail || `Cloud Slicer upload failed (${res.status})`),
    )
  }
  const fileId = String(data.file_id ?? data.id ?? '')
  if (!fileId) throw new Error('Cloud Slicer upload did not return file_id.')
  return fileId
}

async function queueQuote(creds: CloudSlicerCreds, fileId: string): Promise<string> {
  const res = await fetch(`${apiBase()}/v1/quote/fdm/${encodeURIComponent(fileId)}`, {
    method: 'POST',
    headers: {
      ...authHeaders(creds.token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      printer_id: creds.printerId,
      filament_id: creds.filamentId,
    }),
  })
  const data = await readJsonSafe(res)
  if (!res.ok && res.status !== 202) {
    throw new Error(
      String(data.error || data.message || data.detail || `Cloud Slicer quote failed (${res.status})`),
    )
  }
  const quoteId = String(data.quote_id ?? data.id ?? '')
  if (!quoteId) throw new Error('Cloud Slicer quote did not return quote_id.')
  return quoteId
}

async function waitForQuote(
  creds: CloudSlicerCreds,
  quoteId: string,
  timeoutMs = 300_000,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(`${apiBase()}/v1/quote/${encodeURIComponent(quoteId)}`, {
      headers: authHeaders(creds.token),
    })
    const data = await readJsonSafe(res)
    if (!res.ok) {
      throw new Error(
        String(data.error || data.message || data.detail || `Cloud Slicer poll failed (${res.status})`),
      )
    }
    const status = String(data.status || '')
    if (status === 'success') return data
    if (status === 'failed' || status === 'error') {
      throw new Error(String(data.error_message || data.error || data.message || 'Cloud Slicer quote failed'))
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
  throw new Error('Cloud Slicer quote timed out.')
}

function extractGramsHours(quote: Record<string, unknown>): { grams: number; hours: number } {
  const pricing = (quote.pricing as Record<string, unknown> | undefined) ?? {}
  const time = (quote.time as Record<string, unknown> | undefined) ?? {}
  const grams = Number(pricing.filament_weight ?? pricing.filament_weight_g ?? pricing.weight)
  const seconds = Number(time.estimated_time_seconds ?? time.seconds)
  if (!Number.isFinite(grams) || grams < 0) {
    throw new Error('Cloud Slicer quote missing filament weight.')
  }
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error('Cloud Slicer quote missing print time.')
  }
  const hours = Math.round((seconds / 3600) * 1000) / 1000
  return { grams: Math.round(grams * 100) / 100, hours }
}

/** Upload STL + quote for one printer owner account. */
export async function quoteStlForPrinter(
  creds: CloudSlicerCreds,
  localPath: string,
): Promise<CloudSlicerQuoteResult> {
  const filename = path.basename(localPath) || 'design.stl'
  const fileId = await uploadStlFile(creds, localPath, filename)
  const quoteId = await queueQuote(creds, fileId)
  const quote = await waitForQuote(creds, quoteId)
  const { grams, hours } = extractGramsHours(quote)
  return { grams, hours, quoteId, fileId }
}
