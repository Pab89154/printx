/**
 * Cloud Slicer quoting + worst-cost pricing for custom print requests.
 */
import path from 'node:path'
import type { DbApi } from './dbClient.ts'
import { getPricingSettings, listPrinters } from './catalog.ts'
import {
  cloudSlicerConfigured,
  deleteCloudSlicerFile,
  deleteQuote,
  GCODE_SAVE_HINT,
  isGcodeOutputMissing,
  quoteAndDownloadGcode,
  quoteStlForPrinter,
  requoteFileAndDownloadGcode,
  type CloudSlicerCreds,
} from './cloudSlicer.ts'
import { loadStoredGcode, storeGcodeBuffer } from './gcodeStorage.ts'
import { resolveStoredFile } from './objectStorage.ts'
import { priceDesign, type PrinterCostInput } from './pricing.ts'
import { SLICEABLE_EXTS } from '../shared/modelFormats.ts'

const PRINTER_IDS = ['pablo_p1s', 'court_ender', 'josh_kobra'] as const

const PRINTER_LABEL: Record<string, string> = {
  pablo_p1s: 'Pablo P1S',
  court_ender: 'Court Ender 3v2',
  josh_kobra: 'Josh Anycubic Kobra X',
}

const GRAMS_COL: Record<string, string> = {
  pablo_p1s: 'grams_pablo_p1s',
  court_ender: 'grams_court_ender',
  josh_kobra: 'grams_josh_kobra',
}

const HOURS_COL: Record<string, string> = {
  pablo_p1s: 'hours_pablo_p1s',
  court_ender: 'hours_court_ender',
  josh_kobra: 'hours_josh_kobra',
}

type OwnerCredsRow = {
  printer_id: string
  owner_label: string
  user_id: string | null
  email: string | null
  display_name: string | null
  cloud_slicer_token: string | null
  cloud_slicer_printer_id: string | null
  cloud_slicer_filament_id: string | null
}

async function loadPrinterOwnerCreds(db: DbApi): Promise<OwnerCredsRow[]> {
  return db.all<OwnerCredsRow>(
    `SELECT p.id as printer_id, p.owner_label, p.owner_user_id as user_id,
            u.email, u.display_name,
            CASE WHEN TRIM(COALESCE(p.cloud_slicer_token, '')) != ''
              THEN p.cloud_slicer_token ELSE u.cloud_slicer_token END as cloud_slicer_token,
            CASE WHEN TRIM(COALESCE(p.cloud_slicer_printer_id, '')) != ''
              THEN p.cloud_slicer_printer_id ELSE u.cloud_slicer_printer_id END as cloud_slicer_printer_id,
            CASE WHEN TRIM(COALESCE(p.cloud_slicer_filament_id, '')) != ''
              THEN p.cloud_slicer_filament_id ELSE u.cloud_slicer_filament_id END as cloud_slicer_filament_id
     FROM printers p
     LEFT JOIN users u ON u.id = p.owner_user_id
     WHERE p.active = 1
     ORDER BY p.owner_label ASC`,
  )
}

function parseIdMap(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'string') return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && v.trim()) out[k] = v.trim()
    }
    return out
  } catch {
    return {}
  }
}

export type CustomRequestQuoteRow = {
  id: string
  uploaded_file: string | null
  slice_status: string
  slice_error: string
  grams_pablo_p1s: number | null
  hours_pablo_p1s: number | null
  grams_court_ender: number | null
  hours_court_ender: number | null
  grams_josh_kobra: number | null
  hours_josh_kobra: number | null
  quote_ids_json: string
  file_ids_json: string
  worst_printer_id: string | null
  worst_cost_usd: number | null
  catalog_price_usd: number | null
  quoted_at: string | null
  status: string
  name: string
  email: string
  school: string
  description: string
  size: string
  created_at: string
  updated_at: string
}

export function mapCustomRequestRow(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    name: String(row.name || ''),
    email: String(row.email || ''),
    school: String(row.school || ''),
    description: String(row.description || ''),
    size: String(row.size || ''),
    uploaded_file: (row.uploaded_file as string | null) ?? null,
    status: String(row.status || 'new'),
    slice_status: String(row.slice_status || 'idle'),
    slice_error: String(row.slice_error || ''),
    grams_pablo_p1s: row.grams_pablo_p1s == null ? null : Number(row.grams_pablo_p1s),
    hours_pablo_p1s: row.hours_pablo_p1s == null ? null : Number(row.hours_pablo_p1s),
    grams_court_ender: row.grams_court_ender == null ? null : Number(row.grams_court_ender),
    hours_court_ender: row.hours_court_ender == null ? null : Number(row.hours_court_ender),
    grams_josh_kobra: row.grams_josh_kobra == null ? null : Number(row.grams_josh_kobra),
    hours_josh_kobra: row.hours_josh_kobra == null ? null : Number(row.hours_josh_kobra),
    quote_ids: parseIdMap(row.quote_ids_json),
    file_ids: parseIdMap(row.file_ids_json),
    worst_printer_id: (row.worst_printer_id as string | null) ?? null,
    worst_cost_usd: row.worst_cost_usd == null ? null : Number(row.worst_cost_usd),
    catalog_price_usd: row.catalog_price_usd == null ? null : Number(row.catalog_price_usd),
    quoted_at: (row.quoted_at as string | null) ?? null,
    shipping_name: String(row.shipping_name || ''),
    shipping_line1: String(row.shipping_line1 || ''),
    shipping_line2: String(row.shipping_line2 || ''),
    shipping_city: String(row.shipping_city || ''),
    shipping_state: String(row.shipping_state || ''),
    shipping_postal: String(row.shipping_postal || ''),
    shipping_country: String(row.shipping_country || ''),
    shipping_method: String(row.shipping_method || ''),
    shipping_usd: Number(row.shipping_usd) || 0,
    tracking_number: String(row.tracking_number || ''),
    tracking_carrier: String(row.tracking_carrier || ''),
    tracking_url: String(row.tracking_url || ''),
    shipped_at: (row.shipped_at as string | null) ?? null,
    paid_at: (row.paid_at as string | null) ?? null,
    created_at: String(row.created_at || ''),
    updated_at: String(row.updated_at || ''),
  }
}

async function credsForPrinter(
  db: DbApi,
  printerId: string,
): Promise<CloudSlicerCreds | null> {
  const owners = await loadPrinterOwnerCreds(db)
  const row = owners.find((o) => o.printer_id === printerId)
  if (!row) return null
  const creds: CloudSlicerCreds = {
    token: String(row.cloud_slicer_token || ''),
    printerId: String(row.cloud_slicer_printer_id || ''),
    filamentId: String(row.cloud_slicer_filament_id || ''),
  }
  return cloudSlicerConfigured(creds) ? creds : null
}

/** Background quote for a custom request — worst-cost price across available printers. */
export async function quoteCustomRequest(db: DbApi, requestId: string): Promise<void> {
  const row = await db.get<Record<string, unknown>>(
    'SELECT * FROM custom_requests WHERE id = ?',
    requestId,
  )
  if (!row) return

  const fileName = String(row.uploaded_file || '').trim()
  if (!fileName) {
    await db.run(
      `UPDATE custom_requests SET slice_status = 'error', slice_error = ?, updated_at = ? WHERE id = ?`,
      'A .stl or .3mf model is required to estimate cost.',
      new Date().toISOString(),
      requestId,
    )
    return
  }

  const ext = path.extname(fileName).toLowerCase()
  if (!SLICEABLE_EXTS.has(ext)) {
    await db.run(
      `UPDATE custom_requests SET slice_status = 'error', slice_error = ?, updated_at = ? WHERE id = ?`,
      'Upload a .stl or .3mf file so Cloud Slicer can quote. .obj is not auto-quoted.',
      new Date().toISOString(),
      requestId,
    )
    return
  }

  const resolved = await resolveStoredFile(fileName)
  if (!resolved) {
    await db.run(
      `UPDATE custom_requests SET slice_status = 'error', slice_error = ?, updated_at = ? WHERE id = ?`,
      'Model file missing on server. Please submit again with the file attached.',
      new Date().toISOString(),
      requestId,
    )
    return
  }

  try {
    await db.run(
      `UPDATE custom_requests SET slice_status = 'slicing', slice_error = '', updated_at = ? WHERE id = ?`,
      new Date().toISOString(),
      requestId,
    )

    const owners = await loadPrinterOwnerCreds(db)
    const setupGaps: string[] = []
    const quoteErrors: string[] = []
    const quoteIds: Record<string, string> = {}
    const fileIds: Record<string, string> = {}
    const gcodePaths: Record<string, string> = {}
    const gramsHours: Record<string, number | null> = {
      grams_pablo_p1s: null,
      hours_pablo_p1s: null,
      grams_court_ender: null,
      hours_court_ender: null,
      grams_josh_kobra: null,
      hours_josh_kobra: null,
    }

    for (const id of PRINTER_IDS) {
      const label = PRINTER_LABEL[id] ?? id
      const owner = owners.find((o) => o.printer_id === id)
      const creds: CloudSlicerCreds = {
        token: String(owner?.cloud_slicer_token || ''),
        printerId: String(owner?.cloud_slicer_printer_id || ''),
        filamentId: String(owner?.cloud_slicer_filament_id || ''),
      }
      if (!cloudSlicerConfigured(creds)) {
        const who = owner?.display_name || owner?.email
        setupGaps.push(
          who
            ? `${label}: ${who} has not finished Cloud Slicer setup`
            : `${label}: no Cloud Slicer API key saved (Settings → Cloud Slicer)`,
        )
        continue
      }
      try {
        const result = await quoteStlForPrinter(creds, resolved.path)
        gramsHours[GRAMS_COL[id]!] = result.grams
        gramsHours[HOURS_COL[id]!] = result.hours
        quoteIds[id] = result.quoteId
        fileIds[id] = result.fileId
        if (result.gcodeBuffer?.length) {
          try {
            gcodePaths[id] = await storeGcodeBuffer(result.gcodeBuffer, {
              hint: `custom-${requestId.slice(0, 8)}-${id}`,
            })
          } catch (storeErr) {
            console.warn(
              '[gcode] custom store at quote time failed:',
              storeErr instanceof Error ? storeErr.message : storeErr,
            )
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Cloud Slicer quoting failed'
        quoteErrors.push(`${label}: ${msg}`)
      }
    }

    const printers = await listPrinters(db)
    const byId = Object.fromEntries(printers.map((p) => [p.id, p]))
    const inputs: PrinterCostInput[] = PRINTER_IDS.filter(
      (id) => gramsHours[GRAMS_COL[id]!] != null && gramsHours[HOURS_COL[id]!] != null,
    ).map((id) => ({
      printerId: id,
      grams: gramsHours[GRAMS_COL[id]!] as number,
      hours: gramsHours[HOURS_COL[id]!] as number,
      avgPowerKw: byId[id]?.avgPowerKw ?? 0.22,
    }))

    const warningParts: string[] = []
    if (setupGaps.length) warningParts.push(`Waiting on setup:\n• ${setupGaps.join('\n• ')}`)
    if (quoteErrors.length) warningParts.push(`Quote errors:\n• ${quoteErrors.join('\n• ')}`)

    const now = new Date().toISOString()
    if (inputs.length === 0) {
      await db.run(
        `UPDATE custom_requests SET
          grams_pablo_p1s = ?, hours_pablo_p1s = ?,
          grams_court_ender = ?, hours_court_ender = ?,
          grams_josh_kobra = ?, hours_josh_kobra = ?,
          quote_ids_json = ?, file_ids_json = ?, gcode_paths_json = ?,
          worst_printer_id = NULL, worst_cost_usd = NULL, catalog_price_usd = NULL,
          slice_status = 'error', slice_error = ?, quoted_at = NULL, updated_at = ?
         WHERE id = ?`,
        gramsHours.grams_pablo_p1s,
        gramsHours.hours_pablo_p1s,
        gramsHours.grams_court_ender,
        gramsHours.hours_court_ender,
        gramsHours.grams_josh_kobra,
        gramsHours.hours_josh_kobra,
        JSON.stringify(quoteIds),
        JSON.stringify(fileIds),
        JSON.stringify(gcodePaths),
        (warningParts.join('\n\n') || 'No Cloud Slicer quotes available yet.').slice(0, 2000),
        now,
        requestId,
      )
      return
    }

    const settings = await getPricingSettings(db)
    const priced = priceDesign(inputs, settings)
    await db.run(
      `UPDATE custom_requests SET
        grams_pablo_p1s = ?, hours_pablo_p1s = ?,
        grams_court_ender = ?, hours_court_ender = ?,
        grams_josh_kobra = ?, hours_josh_kobra = ?,
        quote_ids_json = ?, file_ids_json = ?, gcode_paths_json = ?,
        worst_printer_id = ?, worst_cost_usd = ?, catalog_price_usd = ?,
        slice_status = 'ready', slice_error = ?, quoted_at = ?, updated_at = ?
       WHERE id = ?`,
      gramsHours.grams_pablo_p1s,
      gramsHours.hours_pablo_p1s,
      gramsHours.grams_court_ender,
      gramsHours.hours_court_ender,
      gramsHours.grams_josh_kobra,
      gramsHours.hours_josh_kobra,
      JSON.stringify(quoteIds),
      JSON.stringify(fileIds),
      JSON.stringify(gcodePaths),
      priced.worstPrinterId,
      priced.worstCostUsd,
      priced.catalogPriceUsd,
      warningParts.join('\n\n').slice(0, 2000),
      now,
      now,
      requestId,
    )
  } finally {
    resolved.cleanup?.()
  }
}

/** Best-effort delete Cloud Slicer quotes/files; keep the DB request row. */
export async function clearCustomRequestSliceArtifacts(
  db: DbApi,
  requestId: string,
): Promise<void> {
  const row = await db.get<Record<string, unknown>>(
    'SELECT quote_ids_json, file_ids_json FROM custom_requests WHERE id = ?',
    requestId,
  )
  if (!row) return
  const quoteIds = parseIdMap(row.quote_ids_json)
  const fileIds = parseIdMap(row.file_ids_json)

  for (const printerId of Object.keys({ ...quoteIds, ...fileIds })) {
    const creds = await credsForPrinter(db, printerId)
    if (!creds) continue
    if (quoteIds[printerId]) {
      try {
        await deleteQuote(creds, quoteIds[printerId]!)
      } catch (err) {
        console.warn(
          '[custom-request] delete quote failed:',
          err instanceof Error ? err.message : err,
        )
      }
    }
    if (fileIds[printerId]) {
      try {
        await deleteCloudSlicerFile(creds, fileIds[printerId]!)
      } catch (err) {
        console.warn(
          '[custom-request] delete CS file failed:',
          err instanceof Error ? err.message : err,
        )
      }
    }
  }

  await db.run(
    `UPDATE custom_requests SET
      quote_ids_json = '{}', file_ids_json = '{}', gcode_paths_json = '{}',
      updated_at = ?
     WHERE id = ?`,
    new Date().toISOString(),
    requestId,
  )
}

function printersWithQuoteOrGrams(row: Record<string, unknown>, quoteIds: Record<string, string>) {
  return PRINTER_IDS.filter((id) => {
    if (quoteIds[id]) return true
    const grams = row[GRAMS_COL[id]!]
    return grams != null && Number.isFinite(Number(grams))
  })
}

/**
 * Download G-code for one chosen printer only (not all printers).
 * Re-slices that printer if the stored quote’s output was cleaned up.
 */
export async function downloadCustomRequestGcode(
  db: DbApi,
  requestId: string,
  printerIdInput?: string | null,
): Promise<{ buffer: Buffer; filename: string }> {
  const row = await db.get<Record<string, unknown>>(
    'SELECT * FROM custom_requests WHERE id = ?',
    requestId,
  )
  if (!row) throw new Error('Request not found.')
  const quoteIds = parseIdMap(row.quote_ids_json)
  const fileIds = parseIdMap(row.file_ids_json)
  const gcodePaths = parseIdMap(row.gcode_paths_json)
  const available = printersWithQuoteOrGrams(row, quoteIds)
  if (available.length === 0) {
    throw new Error('No sliced G-code available. Quote may have been cleared after decline.')
  }

  const requested = String(printerIdInput || '').trim()
  const worst = String(row.worst_printer_id || '')
  const avail = available as string[]
  if (requested && !avail.includes(requested)) {
    throw new Error(
      `Pick a printer that was quoted for this request (${available.map((id) => PRINTER_LABEL[id] ?? id).join(', ')}).`,
    )
  }
  const printerId =
    (requested && avail.includes(requested) ? requested : null) ||
    (worst && avail.includes(worst) ? worst : null) ||
    available[0]!

  const creds = await credsForPrinter(db, printerId)
  if (!creds) throw new Error('Cloud Slicer credentials missing for the selected printer.')

  const safeName = `printx-custom-${requestId.slice(0, 8)}-${printerId}.gcode`

  const stored = gcodePaths[printerId]
  if (stored) {
    const local = await loadStoredGcode(stored)
    if (local) return { buffer: local.buffer, filename: safeName }
  }

  async function persistAndReturn(result: {
    buffer: Buffer
    filename: string
    quoteId: string
    fileId: string
    grams: number
    hours: number
  }) {
    quoteIds[printerId] = result.quoteId
    fileIds[printerId] = result.fileId
    try {
      gcodePaths[printerId] = await storeGcodeBuffer(result.buffer, {
        hint: `custom-${requestId.slice(0, 8)}-${printerId}`,
      })
    } catch (err) {
      console.warn('[gcode] custom persist failed:', err instanceof Error ? err.message : err)
    }
    const gramsCol = GRAMS_COL[printerId]
    const hoursCol = HOURS_COL[printerId]
    await db.run(
      `UPDATE custom_requests SET
         quote_ids_json = ?, file_ids_json = ?, gcode_paths_json = ?,
         ${gramsCol} = ?, ${hoursCol} = ?,
         updated_at = ?
       WHERE id = ?`,
      JSON.stringify(quoteIds),
      JSON.stringify(fileIds),
      JSON.stringify(gcodePaths),
      result.grams,
      result.hours,
      new Date().toISOString(),
      requestId,
    )
    return { buffer: result.buffer, filename: result.filename || safeName }
  }

  const existingFileId = fileIds[printerId] || ''
  if (existingFileId) {
    try {
      return await persistAndReturn(await requoteFileAndDownloadGcode(creds, existingFileId))
    } catch (err) {
      console.warn(
        '[gcode] custom requote existing file failed, will re-upload:',
        err instanceof Error ? err.message : err,
      )
    }
  }

  const fileName = String(row.uploaded_file || '').trim()
  if (!fileName) throw new Error('Source model missing — cannot re-slice for download.')
  const resolved = await resolveStoredFile(fileName)
  if (!resolved) throw new Error('Source model missing on server — cannot re-slice for download.')
  try {
    return await persistAndReturn(await quoteAndDownloadGcode(creds, resolved.path))
  } catch (err) {
    if (isGcodeOutputMissing(err)) throw new Error(GCODE_SAVE_HINT)
    throw err
  } finally {
    resolved.cleanup?.()
  }
}
