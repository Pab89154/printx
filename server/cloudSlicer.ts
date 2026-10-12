/** Cloud Slicer API client — per-admin tokens, quote → grams/hours (+ capture G-code). */

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
  /** Captured immediately on quote success — CS discards gcode when “Save gcode” is off. */
  gcodeBuffer?: Buffer
  gcodeFilename?: string
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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
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

export async function waitForQuote(
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
    await sleep(2000)
  }
  throw new Error('Cloud Slicer quote timed out.')
}

/** True when we should re-slice this printer instead of using the stored quote id. */
export function isGcodeOutputMissing(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /output file is not available|not available for this quote|g-code download failed \(404\)|poll failed \(404\)|quote(?: record)? not found|quote not ready|quote timed out|discarded this g-code|save gcode/i.test(
    msg,
  )
}

export const GCODE_SAVE_HINT =
  'Cloud Slicer discards G-code unless “Save gcode files” is on (Settings → File Retention, Pro/Max). PrintX tries to capture it at slice time — try Download again to re-slice and save a copy.'

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

async function downloadQuoteGcodeOnce(
  creds: CloudSlicerCreds,
  quoteId: string,
): Promise<{ buffer: Buffer; filename: string }> {
  const id = quoteId.trim()
  if (!id) throw new Error('Missing Cloud Slicer quote id.')
  const res = await fetch(`${apiBase()}/v1/quote/output/${encodeURIComponent(id)}`, {
    headers: authHeaders(creds.token),
  })
  if (!res.ok) {
    const data = await readJsonSafe(res)
    throw new Error(
      String(data.error || data.message || data.detail || `G-code download failed (${res.status})`),
    )
  }
  const disposition = res.headers.get('content-disposition') || ''
  const match = /filename\*?=(?:UTF-8''|")?([^\";]+)/i.exec(disposition)
  const filename = match?.[1]
    ? decodeURIComponent(match[1].replace(/"/g, '').trim())
    : `${id}.gcode`
  const buffer = Buffer.from(await res.arrayBuffer())
  if (!buffer.length) throw new Error('Cloud Slicer returned an empty G-code file.')
  return { buffer, filename: filename.endsWith('.gcode') ? filename : `${filename}.gcode` }
}

/** Grab G-code the instant a quote hits success (before Cloud Slicer discards it). */
async function captureGcodeAfterSuccess(
  creds: CloudSlicerCreds,
  quoteId: string,
  quote: Record<string, unknown>,
): Promise<{ buffer: Buffer; filename: string } | null> {
  let lastErr: Error | null = null
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      return await downloadQuoteGcodeOnce(creds, quoteId)
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err))
      if (!isGcodeOutputMissing(lastErr)) throw lastErr
      await sleep(400)
    }
  }
  const files = (quote.files as Record<string, unknown> | undefined) ?? {}
  const hasPath = Boolean(files.gcode_path || files.gcode_name)
  console.warn(
    '[cloudslicer] gcode capture failed after success',
    quoteId,
    hasPath ? 'has gcode_path' : 'no gcode_path',
    lastErr?.message,
  )
  return null
}

/**
 * Poll until quote success, then immediately download G-code in the same turn.
 * Required because Cloud Slicer discards output when “Save gcode files” is off.
 */
export async function waitForQuoteAndDownloadGcode(
  creds: CloudSlicerCreds,
  quoteId: string,
  timeoutMs = 300_000,
): Promise<{
  quote: Record<string, unknown>
  grams: number
  hours: number
  buffer: Buffer
  filename: string
}> {
  const id = quoteId.trim()
  if (!id) throw new Error('Missing Cloud Slicer quote id.')
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const res = await fetch(`${apiBase()}/v1/quote/${encodeURIComponent(id)}`, {
      headers: authHeaders(creds.token),
    })
    const data = await readJsonSafe(res)
    if (!res.ok) {
      throw new Error(
        String(data.error || data.message || data.detail || `Cloud Slicer poll failed (${res.status})`),
      )
    }
    const status = String(data.status || '')
    if (status === 'success') {
      const { grams, hours } = extractGramsHours(data)
      const captured = await captureGcodeAfterSuccess(creds, id, data)
      if (!captured) throw new Error(GCODE_SAVE_HINT)
      return { quote: data, grams, hours, buffer: captured.buffer, filename: captured.filename }
    }
    if (status === 'failed' || status === 'error') {
      throw new Error(String(data.error_message || data.error || data.message || 'Cloud Slicer quote failed'))
    }
    await sleep(2000)
  }
  throw new Error('Cloud Slicer quote timed out.')
}

/** Upload STL + quote for one printer; capture G-code when Cloud Slicer still has it. */
export async function quoteStlForPrinter(
  creds: CloudSlicerCreds,
  localPath: string,
): Promise<CloudSlicerQuoteResult> {
  const filename = path.basename(localPath) || 'design.stl'
  const fileId = await uploadStlFile(creds, localPath, filename)
  const quoteId = await queueQuote(creds, fileId)

  const deadline = Date.now() + 300_000
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
    if (status === 'success') {
      const { grams, hours } = extractGramsHours(data)
      const captured = await captureGcodeAfterSuccess(creds, quoteId, data)
      return {
        grams,
        hours,
        quoteId,
        fileId,
        gcodeBuffer: captured?.buffer,
        gcodeFilename: captured?.filename,
      }
    }
    if (status === 'failed' || status === 'error') {
      throw new Error(String(data.error_message || data.error || data.message || 'Cloud Slicer quote failed'))
    }
    await sleep(2000)
  }
  throw new Error('Cloud Slicer quote timed out.')
}

/**
 * Download G-code for a stored quote id (usually already discarded).
 * Prefer serving PrintX-stored gcode; this is a last resort.
 */
export async function downloadQuoteGcode(
  creds: CloudSlicerCreds,
  quoteId: string,
): Promise<{ buffer: Buffer; filename: string }> {
  const id = quoteId.trim()
  if (!id) throw new Error('Missing Cloud Slicer quote id.')

  const res = await fetch(`${apiBase()}/v1/quote/${encodeURIComponent(id)}`, {
    headers: authHeaders(creds.token),
  })
  const data = await readJsonSafe(res)
  if (!res.ok) {
    throw new Error(
      String(data.error || data.message || data.detail || `Cloud Slicer poll failed (${res.status})`),
    )
  }
  const status = String(data.status || '')
  if (status === 'pending') {
    return waitForQuoteAndDownloadGcode(creds, id, 60_000).then((r) => ({
      buffer: r.buffer,
      filename: r.filename,
    }))
  }
  if (status === 'failed' || status === 'error') {
    throw new Error(String(data.error_message || data.error || data.message || 'Cloud Slicer quote failed'))
  }
  if (status !== 'success') {
    throw new Error(`Cloud Slicer quote not ready (${status || 'unknown'}).`)
  }

  const captured = await captureGcodeAfterSuccess(creds, id, data)
  if (!captured) throw new Error(GCODE_SAVE_HINT)
  return captured
}

/** Re-quote an existing Cloud Slicer file and capture G-code immediately. */
export async function requoteFileAndDownloadGcode(
  creds: CloudSlicerCreds,
  fileId: string,
): Promise<{ buffer: Buffer; filename: string; quoteId: string; fileId: string; grams: number; hours: number }> {
  const id = fileId.trim()
  if (!id) throw new Error('Missing Cloud Slicer file id.')
  const quoteId = await queueQuote(creds, id)
  const result = await waitForQuoteAndDownloadGcode(creds, quoteId)
  return {
    buffer: result.buffer,
    filename: result.filename,
    quoteId,
    fileId: id,
    grams: result.grams,
    hours: result.hours,
  }
}

/** Fresh upload + slice, capture G-code immediately. */
export async function quoteAndDownloadGcode(
  creds: CloudSlicerCreds,
  localPath: string,
): Promise<{ buffer: Buffer; filename: string; quoteId: string; fileId: string; grams: number; hours: number }> {
  const quoted = await quoteStlForPrinter(creds, localPath)
  if (quoted.gcodeBuffer && quoted.gcodeBuffer.length) {
    return {
      buffer: quoted.gcodeBuffer,
      filename: quoted.gcodeFilename || `printx-${quoted.quoteId}.gcode`,
      quoteId: quoted.quoteId,
      fileId: quoted.fileId,
      grams: quoted.grams,
      hours: quoted.hours,
    }
  }
  // Quote succeeded but capture missed the window — one more attempt via output API.
  const again = await captureGcodeAfterSuccess(creds, quoted.quoteId, {})
  if (!again) throw new Error(GCODE_SAVE_HINT)
  return {
    buffer: again.buffer,
    filename: again.filename,
    quoteId: quoted.quoteId,
    fileId: quoted.fileId,
    grams: quoted.grams,
    hours: quoted.hours,
  }
}

/** Delete a quote record and its G-code on Cloud Slicer. */
export async function deleteQuote(creds: CloudSlicerCreds, quoteId: string): Promise<void> {
  const id = quoteId.trim()
  if (!id) return
  const res = await fetch(`${apiBase()}/v1/quote/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(creds.token),
  })
  if (!res.ok && res.status !== 404) {
    const data = await readJsonSafe(res)
    throw new Error(
      String(data.error || data.message || data.detail || `Quote delete failed (${res.status})`),
    )
  }
}

/** Delete an uploaded source file on Cloud Slicer. */
export async function deleteCloudSlicerFile(creds: CloudSlicerCreds, fileId: string): Promise<void> {
  const id = fileId.trim()
  if (!id) return
  const res = await fetch(`${apiBase()}/v1/file/${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: authHeaders(creds.token),
  })
  if (!res.ok && res.status !== 404) {
    const data = await readJsonSafe(res)
    throw new Error(
      String(data.error || data.message || data.detail || `File delete failed (${res.status})`),
    )
  }
}
