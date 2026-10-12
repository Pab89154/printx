import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import formidable from 'formidable'
import Stripe from 'stripe'
import {
  adminCan,
  getSessionUser,
  parseCookies,
  sanitizeEmail,
  sanitizeText,
  SESSION_COOKIE,
  type SessionAdmin,
} from './auth.ts'
import { getDb, getUploadsDir } from './db.ts'
import { invalidateBootstrapCache } from './bootstrapCache.ts'
import {
  buildSku,
  colorById,
  computeDesignPrice,
  designHasPricableInputs,
  getPricingSettings,
  listPrinters,
  rowToDesign,
  rowToOrder,
  rowToOrderItem,
  sanitizeSkuBase,
  seedCatalogDefaults,
  suggestSkuBase,
  type Design,
} from './catalog.ts'
import { BUILTIN_COLORS, emptyCustomColorSlots, normalizeCustomSlots } from '../shared/colors.ts'
import {
  isModelExt,
  MODEL_EXTS,
  modelContentType,
  SLICEABLE_EXTS,
} from '../shared/modelFormats.ts'
import { roundMoney } from './pricing.ts'
import {
  loadCheckoutShipping,
  parseCheckoutShipping,
  resolveShippingMethodName,
  stripeCheckoutShippingFields,
} from './stripeShipping.ts'
import {
  cloudSlicerConfigured,
  downloadQuoteGcode,
  quoteStlForPrinter,
  type CloudSlicerCreds,
} from './cloudSlicer.ts'
import {
  objectStorageConfigured,
  objectStorageRequired,
  resolveStoredFile,
  sendStoredFile,
  uploadStoredFile,
} from './objectStorage.ts'

const MODEL_MAX_BYTES = 50 * 1024 * 1024

const PRINTER_FIELD: Record<
  string,
  { grams: keyof Design; hours: keyof Design; label: string }
> = {
  pablo_p1s: { grams: 'gramsPabloP1s', hours: 'hoursPabloP1s', label: 'Pablo P1S' },
  court_ender: { grams: 'gramsCourtEnder', hours: 'hoursCourtEnder', label: 'Court Ender 3v2' },
  josh_kobra: { grams: 'gramsJoshKobra', hours: 'hoursJoshKobra', label: 'Josh Anycubic Kobra X' },
}

function designDto(d: Design): Omit<Design, 'stlPath'> & { stlPath: ''; modelExt: string } {
  const modelExt = path.extname(d.stlPath || '').toLowerCase()
  return { ...d, stlPath: '', modelExt }
}

/**
 * Local dev often has DATABASE_URL (same designs) but no SERVICE_ROLE_KEY,
 * so Storage downloads fail. Proxy the public STL from production instead.
 */
function stlFallbackOrigin(): string {
  const explicit = (process.env.PRINTX_STL_FALLBACK_ORIGIN || '').trim().replace(/\/$/, '')
  if (explicit) return explicit
  if (objectStorageConfigured()) return ''
  if (process.env.NODE_ENV === 'production') return ''
  return 'https://printx.pw'
}

async function sendStlWithDevFallback(
  res: ServerResponse,
  designId: string,
  stlPath: string,
  contentType: string,
  cacheControl: string,
): Promise<boolean> {
  const ok = await sendStoredFile(res, stlPath, contentType, cacheControl)
  if (ok) return true

  const origin = stlFallbackOrigin()
  if (!origin) return false

  try {
    const upstream = await fetch(`${origin}/api/public/catalog/${encodeURIComponent(designId)}/stl`)
    if (!upstream.ok) return false
    const buf = Buffer.from(await upstream.arrayBuffer())
    if (!buf.length) return false
    res.statusCode = 200
    res.setHeader('Content-Type', contentType)
    res.setHeader('Cache-Control', cacheControl)
    res.setHeader('X-PrintX-Stl-Fallback', origin)
    res.end(buf)
    return true
  } catch (err) {
    console.warn(
      '[catalog] STL fallback failed:',
      err instanceof Error ? err.message : err,
    )
    return false
  }
}

async function parseModelUpload(req: IncomingMessage): Promise<{ fileName: string; modelExt: string }> {
  const uploadsDir = await getUploadsDir()
  const form = formidable({
    uploadDir: uploadsDir,
    keepExtensions: true,
    maxFileSize: MODEL_MAX_BYTES,
    multiples: false,
  })
  return new Promise((resolve, reject) => {
    form.parse(req, (err, _fields, files) => {
      if (err) return reject(err)
      void (async () => {
        const upload = files.file
        const file = Array.isArray(upload) ? upload[0] : upload
        if (!file?.filepath) return reject(new Error('Model file is required.'))
        const ext = path.extname(file.originalFilename ?? file.filepath).toLowerCase()
        if (!isModelExt(ext)) {
          try {
            fs.unlinkSync(file.filepath)
          } catch {
            /* ignore */
          }
          return reject(
            new Error(`Invalid file type. Upload ${MODEL_EXTS.join(', ')}.`),
          )
        }
        const safeName = `${randomUUID()}${ext}`
        const dest = path.join(uploadsDir, safeName)
        fs.renameSync(file.filepath, dest)
        // Always persist to Supabase when the project uses it (required on Render).
        if (objectStorageRequired()) {
          try {
            await uploadStoredFile(dest, safeName)
          } catch (uploadErr) {
            try {
              fs.unlinkSync(dest)
            } catch {
              /* ignore */
            }
            return reject(uploadErr)
          }
        }
        resolve({ fileName: safeName, modelExt: ext })
      })()
    })
  })
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

async function loadPrinterOwnerCreds(db: Awaited<ReturnType<typeof getDb>>): Promise<OwnerCredsRow[]> {
  // Prefer credentials stored on the printer row (stable across approve / ownership changes).
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

const PRINTER_IDS = ['pablo_p1s', 'court_ender', 'josh_kobra'] as const

function printerHasQuote(d: Design, printerId: string): boolean {
  const fields = PRINTER_FIELD[printerId]
  if (!fields) return false
  return d[fields.grams] != null && d[fields.hours] != null
}

function parseDesignIdMap(raw: unknown): Record<string, string> {
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

function missingPrinterWarning(label: string, detail: string): string {
  return `${label}: ${detail}`
}

/**
 * Quote available Cloud Slicer printers. Missing admin/setup → warning only.
 * By default skips printers that already have grams/hours (fill-in later).
 * Persists quote/file IDs so printers can download G-code from Orders.
 */
async function sliceDesignWithCloudSlicer(
  db: Awaited<ReturnType<typeof getDb>>,
  designId: string,
  stlPath: string,
  opts?: { fillMissingOnly?: boolean },
): Promise<{ ok: true; design: Design; warning?: string } | { ok: false; error: string }> {
  const fillMissingOnly = opts?.fillMissingOnly !== false
  const resolved = await resolveStoredFile(stlPath)
  if (!resolved) {
    return { ok: false, error: 'Model file missing on server. Re-upload the design file.' }
  }
  const localPath = resolved.path

  try {
    const existingRow = await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId)
    if (!existingRow) return { ok: false, error: 'Design not found.' }
    const existing = rowToDesign(existingRow)
    const quoteIds = parseDesignIdMap(existingRow.quote_ids_json)
    const fileIds = parseDesignIdMap(existingRow.file_ids_json)

    const owners = await loadPrinterOwnerCreds(db)
    const setupGaps: string[] = []
    const quoteErrors: string[] = []
    const ready: { printerId: string; label: string; creds: CloudSlicerCreds }[] = []

    for (const id of PRINTER_IDS) {
      const label = PRINTER_FIELD[id]?.label ?? id
      if (fillMissingOnly && printerHasQuote(existing, id)) continue

      const row = owners.find((o) => o.printer_id === id)
      const creds: CloudSlicerCreds = {
        token: String(row?.cloud_slicer_token || ''),
        printerId: String(row?.cloud_slicer_printer_id || ''),
        filamentId: String(row?.cloud_slicer_filament_id || ''),
      }
      if (!cloudSlicerConfigured(creds)) {
        const who = row?.display_name || row?.email
        setupGaps.push(
          missingPrinterWarning(
            label,
            who
              ? `${who} has not finished Cloud Slicer API setup`
              : 'no Cloud Slicer API key on this printer (Settings → Cloud Slicer)',
          ),
        )
        continue
      }
      ready.push({ printerId: id, label, creds })
    }

    // Start from existing quotes so we never wipe successful printers.
    const gramsHours: {
      gramsPabloP1s: number | null
      hoursPabloP1s: number | null
      gramsCourtEnder: number | null
      hoursCourtEnder: number | null
      gramsJoshKobra: number | null
      hoursJoshKobra: number | null
    } = {
      gramsPabloP1s: existing.gramsPabloP1s,
      hoursPabloP1s: existing.hoursPabloP1s,
      gramsCourtEnder: existing.gramsCourtEnder,
      hoursCourtEnder: existing.hoursCourtEnder,
      gramsJoshKobra: existing.gramsJoshKobra,
      hoursJoshKobra: existing.hoursJoshKobra,
    }

    if (ready.length > 0) {
      await db.run(
        `UPDATE designs SET slice_status = 'slicing', updated_at = ? WHERE id = ?`,
        new Date().toISOString(),
        designId,
      )
      for (const item of ready) {
        try {
          const result = await quoteStlForPrinter(item.creds, localPath)
          const fields = PRINTER_FIELD[item.printerId]!
          gramsHours[fields.grams] = result.grams
          gramsHours[fields.hours] = result.hours
          quoteIds[item.printerId] = result.quoteId
          fileIds[item.printerId] = result.fileId
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Cloud Slicer quoting failed'
          quoteErrors.push(`${item.label}: ${msg}`)
        }
      }
    }

    const warningParts: string[] = []
    if (setupGaps.length) {
      warningParts.push(`Waiting on Cloud Slicer setup:\n• ${setupGaps.join('\n• ')}`)
    }
    if (quoteErrors.length) {
      warningParts.push(`Quote errors:\n• ${quoteErrors.join('\n• ')}`)
    }
    const warning = warningParts.join('\n\n')

    const quotedCount = PRINTER_IDS.filter((id) => {
      const fields = PRINTER_FIELD[id]!
      return gramsHours[fields.grams] != null && gramsHours[fields.hours] != null
    }).length

    const sliceStatus = quotedCount === 0 && ready.length === 0 && setupGaps.length > 0
      ? 'error'
      : quotedCount > 0
        ? 'ready'
        : quoteErrors.length
          ? 'error'
          : 'idle'

    const now = new Date().toISOString()
    await db.run(
      `UPDATE designs SET
      grams_pablo_p1s = ?, hours_pablo_p1s = ?,
      grams_court_ender = ?, hours_court_ender = ?,
      grams_josh_kobra = ?, hours_josh_kobra = ?,
      quote_ids_json = ?, file_ids_json = ?,
      slice_status = ?, slice_error = ?, updated_at = ?
     WHERE id = ?`,
      gramsHours.gramsPabloP1s,
      gramsHours.hoursPabloP1s,
      gramsHours.gramsCourtEnder,
      gramsHours.hoursCourtEnder,
      gramsHours.gramsJoshKobra,
      gramsHours.hoursJoshKobra,
      JSON.stringify(quoteIds),
      JSON.stringify(fileIds),
      sliceStatus,
      warning.slice(0, 2000),
      now,
      designId,
    )
    const row = await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId)
    return { ok: true, design: rowToDesign(row!), warning: warning || undefined }
  } finally {
    resolved.cleanup?.()
  }
}

/** Download G-code for a claimed order item's assigned printer (re-slice if quote id missing). */
async function downloadOrderItemGcode(
  db: Awaited<ReturnType<typeof getDb>>,
  itemId: string,
): Promise<{ buffer: Buffer; filename: string }> {
  const item = await db.get<Record<string, unknown>>('SELECT * FROM order_items WHERE id = ?', itemId)
  if (!item) throw new Error('Order item not found.')
  const printerId = String(item.assigned_printer_id || '').trim()
  if (!printerId) throw new Error('Claim this item with a printer before downloading G-code.')

  const designId = String(item.design_id || '')
  const designRow = await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId)
  if (!designRow) throw new Error('Design not found for this order item.')

  let quoteIds = parseDesignIdMap(designRow.quote_ids_json)
  let quoteId = quoteIds[printerId] || ''

  const owners = await loadPrinterOwnerCreds(db)
  const owner = owners.find((o) => o.printer_id === printerId)
  const creds: CloudSlicerCreds = {
    token: String(owner?.cloud_slicer_token || ''),
    printerId: String(owner?.cloud_slicer_printer_id || ''),
    filamentId: String(owner?.cloud_slicer_filament_id || ''),
  }
  if (!cloudSlicerConfigured(creds)) {
    throw new Error('Cloud Slicer is not set up for this printer. Add API keys under Settings.')
  }

  if (!quoteId) {
    const stlPath = String(designRow.stl_path || '')
    if (!stlPath) throw new Error('Design has no model file to slice.')
    const resolved = await resolveStoredFile(stlPath)
    if (!resolved) throw new Error('Model file missing on server. Re-upload the design.')
    try {
      const result = await quoteStlForPrinter(creds, resolved.path)
      const fileIds = parseDesignIdMap(designRow.file_ids_json)
      quoteIds = { ...quoteIds, [printerId]: result.quoteId }
      fileIds[printerId] = result.fileId
      const gramsCol =
        printerId === 'pablo_p1s'
          ? 'grams_pablo_p1s'
          : printerId === 'court_ender'
            ? 'grams_court_ender'
            : printerId === 'josh_kobra'
              ? 'grams_josh_kobra'
              : null
      const hoursCol =
        printerId === 'pablo_p1s'
          ? 'hours_pablo_p1s'
          : printerId === 'court_ender'
            ? 'hours_court_ender'
            : printerId === 'josh_kobra'
              ? 'hours_josh_kobra'
              : null
      if (gramsCol && hoursCol) {
        await db.run(
          `UPDATE designs SET
             quote_ids_json = ?, file_ids_json = ?,
             ${gramsCol} = ?, ${hoursCol} = ?,
             updated_at = ?
           WHERE id = ?`,
          JSON.stringify(quoteIds),
          JSON.stringify(fileIds),
          result.grams,
          result.hours,
          new Date().toISOString(),
          designId,
        )
      } else {
        await db.run(
          `UPDATE designs SET quote_ids_json = ?, file_ids_json = ?, updated_at = ? WHERE id = ?`,
          JSON.stringify(quoteIds),
          JSON.stringify(fileIds),
          new Date().toISOString(),
          designId,
        )
      }
      quoteId = result.quoteId
    } finally {
      resolved.cleanup?.()
    }
  }

  const { buffer, filename } = await downloadQuoteGcode(creds, quoteId)
  const sku = String(item.sku || designId).replace(/[^\w.-]+/g, '_')
  const safeName = `printx-${sku}-${printerId}.gcode`
  return { buffer, filename: filename || safeName }
}

const GRAMS_COLUMN: Record<string, string> = {
  pablo_p1s: 'grams_pablo_p1s',
  court_ender: 'grams_court_ender',
  josh_kobra: 'grams_josh_kobra',
}

/** After an admin finishes Cloud Slicer setup, quote only the printers still missing. */
export async function fillMissingQuotesForPrinter(
  db: Awaited<ReturnType<typeof getDb>>,
  printxPrinterId: string,
): Promise<{ updated: number; warnings: string[] }> {
  const col = GRAMS_COLUMN[printxPrinterId]
  if (!col) return { updated: 0, warnings: [] }

  const rows = await db.all<Record<string, unknown>>(
    `SELECT * FROM designs
     WHERE TRIM(stl_path) != ''
       AND ${col} IS NULL
       AND status IN ('draft', 'pending_review', 'approved', 'rejected')
     ORDER BY updated_at DESC
     LIMIT 40`,
  )

  let updated = 0
  const warnings: string[] = []
  for (const row of rows) {
    const design = rowToDesign(row)
    if (!SLICEABLE_EXTS.has(path.extname(design.stlPath).toLowerCase())) continue
    const sliced = await sliceDesignWithCloudSlicer(db, design.id, design.stlPath, {
      fillMissingOnly: true,
    })
    if (sliced.ok) {
      if (printerHasQuote(sliced.design, printxPrinterId)) updated++
      if (sliced.warning) warnings.push(`${design.name}: ${sliced.warning}`)
    } else {
      warnings.push(`${design.name}: ${sliced.error}`)
    }
  }
  return { updated, warnings }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

async function readRaw(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks)
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  try {
    return JSON.parse((await readRaw(req)).toString('utf8') || '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}

async function requireAdmin(req: IncomingMessage): Promise<SessionAdmin | null> {
  const cookies = parseCookies(req.headers.cookie)
  return getSessionUser(cookies[SESSION_COOKIE] ?? null)
}

export function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  if (!key) return null
  return new Stripe(key)
}

export function publicOrigin(req: IncomingMessage): string {
  const env = process.env.PRINTX_PUBLIC_ORIGIN?.trim()
  if (env) return env.replace(/\/$/, '')
  const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || 'http'
  const host =
    (req.headers['x-forwarded-host'] as string)?.split(',')[0]?.trim() ||
    (req.headers.host as string) ||
    'localhost:5221'
  return `${proto}://${host}`
}

function parseDesignBody(body: Record<string, unknown>, existing?: Design) {
  const name = sanitizeText(String(body.name ?? existing?.name ?? ''), 120)
  let skuBase = sanitizeSkuBase(String(body.skuBase ?? existing?.skuBase ?? suggestSkuBase(name)))
  if (!skuBase) skuBase = suggestSkuBase(name || 'DESIGN')
  const description = sanitizeText(String(body.description ?? existing?.description ?? ''), 2000)
  const category = sanitizeText(String(body.category ?? existing?.category ?? 'General'), 60) || 'General'
  const imageUrl = String(body.imageUrl ?? existing?.imageUrl ?? '').trim().slice(0, 500)
  let availableColorIds: string[] = existing?.availableColorIds ?? []
  if (Array.isArray(body.availableColorIds)) {
    availableColorIds = body.availableColorIds.map((x) => String(x)).filter(Boolean).slice(0, 20)
  }
  const num = (key: string, fallback: number | null) => {
    if (body[key] === undefined || body[key] === null || body[key] === '') return fallback
    const n = Number(body[key])
    return Number.isFinite(n) && n >= 0 ? n : fallback
  }
  return {
    name,
    skuBase,
    description,
    category,
    imageUrl,
    availableColorIds,
    gramsPabloP1s: num('gramsPabloP1s', existing?.gramsPabloP1s ?? null),
    hoursPabloP1s: num('hoursPabloP1s', existing?.hoursPabloP1s ?? null),
    gramsCourtEnder: num('gramsCourtEnder', existing?.gramsCourtEnder ?? null),
    hoursCourtEnder: num('hoursCourtEnder', existing?.hoursCourtEnder ?? null),
    gramsJoshKobra: num('gramsJoshKobra', existing?.gramsJoshKobra ?? null),
    hoursJoshKobra: num('hoursJoshKobra', existing?.hoursJoshKobra ?? null),
  }
}

async function settleOrderItem(
  database: Awaited<ReturnType<typeof getDb>>,
  itemId: string,
  adminUserId: string,
) {
  const item = await database.get<Record<string, unknown>>(
    'SELECT * FROM order_items WHERE id = ?',
    itemId,
  )
  if (!item) return { ok: false as const, error: 'Item not found' }
  if (item.print_status === 'done') return { ok: false as const, error: 'Already completed' }
  if (item.assigned_admin_user_id !== adminUserId) {
    return { ok: false as const, error: 'Only the claiming admin can mark this done.' }
  }

  const qty = Number(item.qty) || 1
  const worst = Number(item.worst_cost_unit_usd) || 0
  const unit = Number(item.unit_price_usd) || 0
  const reimburse = roundMoney(worst * qty)
  const profit = roundMoney(Math.max(0, (unit - worst) * qty))
  const now = new Date().toISOString()

  await database.run(
    `UPDATE order_items SET print_status = ?, completed_at = ?, reimburse_usd = ?, profit_usd = ? WHERE id = ?`,
    'done',
    now,
    reimburse,
    profit,
    itemId,
  )

  // Printer reimbursement only — profit stays with PrintX in Stripe (no partner split).
  await database.run(
    `INSERT INTO profit_ledger (id, order_item_id, user_id, entry_type, amount_usd, note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    randomUUID(),
    itemId,
    adminUserId,
    'reimburse',
    reimburse,
    'Worst-case manufacturing reimbursement',
    now,
  )

  // Roll up order status
  const orderId = item.order_id as string
  const remaining = await database.get<{ c: number | string }>(
    `SELECT COUNT(*) as c FROM order_items WHERE order_id = ? AND print_status != 'done'`,
    orderId,
  )
  const left = Number(remaining?.c ?? 0)
  await database.run(
    `UPDATE orders SET status = ?, updated_at = ? WHERE id = ?`,
    left === 0 ? 'fulfilled' : 'in_production',
    now,
    orderId,
  )

  return { ok: true as const }
}

export async function handleCatalogApi(
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
  method: string,
): Promise<boolean> {
  const db = await getDb()
  await seedCatalogDefaults(db)

  // ----- Public catalog -----
  if (urlPath === '/api/public/catalog' && method === 'GET') {
    const settings = await getPricingSettings(db)
    const rows = await db.all<Record<string, unknown>>(
      `SELECT * FROM designs WHERE status = 'approved' ORDER BY name ASC`,
    )
    const designs = rows.map(rowToDesign).map((d) => {
      const modelExt = path.extname(d.stlPath || '').toLowerCase()
      return {
        id: d.id,
        skuBase: d.skuBase,
        name: d.name,
        description: d.description,
        category: d.category,
        imageUrl: '',
        hasModel: d.hasStl,
        modelExt,
        /** Public STL preview for approved catalog items. */
        modelUrl: d.hasStl && modelExt === '.stl' ? `/api/public/catalog/${d.id}/stl` : '',
        catalogPriceUsd: d.catalogPriceUsd,
        availableColors: d.availableColorIds
          .map((id) => colorById(id, settings.customColors))
          .filter(Boolean),
      }
    })
    send(res, 200, {
      designs,
      colors: [
        ...BUILTIN_COLORS.map((c) => ({
          id: c.id,
          code: c.code,
          name: c.name,
          hex: c.hex,
          builtin: true,
        })),
        ...settings.customColors
          .filter((c) => c.name.trim())
          .map((c) => ({ id: c.id, code: c.code, name: c.name, hex: c.hex, builtin: false })),
      ],
    })
    return true
  }

  const publicStlMatch = /^\/api\/public\/catalog\/([^/]+)\/stl$/.exec(urlPath)
  if (publicStlMatch && method === 'GET') {
    const designId = publicStlMatch[1]!
    const row = await db.get<{ stl_path: string; status: string }>(
      `SELECT stl_path, status FROM designs WHERE id = ?`,
      designId,
    )
    if (!row || row.status !== 'approved') {
      send(res, 404, { error: 'Model not found' })
      return true
    }
    const stlPath = row.stl_path?.trim()
    if (!stlPath || stlPath.includes('..') || stlPath.includes('/') || stlPath.includes('\\')) {
      send(res, 404, { error: 'Model not found' })
      return true
    }
    if (path.extname(stlPath).toLowerCase() !== '.stl') {
      send(res, 404, { error: 'Interactive preview is STL-only.' })
      return true
    }
    const ok = await sendStlWithDevFallback(
      res,
      designId,
      stlPath,
      'model/stl',
      'public, max-age=120, stale-while-revalidate=300',
    )
    if (!ok) {
      send(res, 404, {
        error: objectStorageConfigured()
          ? 'Model not found'
          : 'Model file missing locally. Add SUPABASE_SERVICE_ROLE_KEY to .env, or re-upload the STL.',
      })
      return true
    }
    return true
  }

  if (urlPath === '/api/public/checkout' && method === 'POST') {
    const stripe = stripeClient()
    if (!stripe) {
      send(res, 503, { error: 'Stripe is not configured (STRIPE_SECRET_KEY).' })
      return true
    }
    const body = await readJson(req)
    // Name/email are collected by Stripe Checkout — optional if the client still sends them.
    const customerName = sanitizeText(String(body.customerName ?? ''), 120)
    const customerEmail = sanitizeEmail(String(body.customerEmail ?? ''))
    const itemsIn = Array.isArray(body.items) ? body.items : []
    if (itemsIn.length === 0) {
      send(res, 400, { error: 'At least one item is required.' })
      return true
    }
    const settings = await getPricingSettings(db)
    const lineItems: {
      design: Design
      colorId: string
      colorName: string
      sku: string
      qty: number
      unit: number
      worst: number
    }[] = []

    for (const raw of itemsIn.slice(0, 20)) {
      if (!raw || typeof raw !== 'object') continue
      const row = raw as Record<string, unknown>
      const designId = String(row.designId ?? '')
      const colorId = String(row.colorId ?? '')
      const qty = Math.min(20, Math.max(1, Math.floor(Number(row.qty) || 1)))
      const designRow = await db.get<Record<string, unknown>>(
        `SELECT * FROM designs WHERE id = ? AND status = 'approved'`,
        designId,
      )
      if (!designRow) {
        send(res, 400, { error: 'One or more designs are unavailable.' })
        return true
      }
      const design = rowToDesign(designRow)
      if (!design.availableColorIds.includes(colorId) || design.catalogPriceUsd == null) {
        send(res, 400, { error: `Color unavailable for ${design.name}.` })
        return true
      }
      const color = colorById(colorId, settings.customColors)
      if (!color) {
        send(res, 400, { error: 'Invalid color.' })
        return true
      }
      lineItems.push({
        design,
        colorId,
        colorName: color.name,
        sku: buildSku(design.skuBase, color.code),
        qty,
        unit: design.catalogPriceUsd,
        worst: design.worstCostUsd ?? 0,
      })
    }
    if (lineItems.length === 0) {
      send(res, 400, { error: 'Cart is empty.' })
      return true
    }

    const subtotal = roundMoney(lineItems.reduce((s, i) => s + i.unit * i.qty, 0))
    const now = new Date().toISOString()
    const orderId = randomUUID()
    await db.run(
      `INSERT INTO orders (
        id, customer_name, customer_email, status, stripe_session_id, stripe_payment_intent,
        subtotal_usd, total_usd, currency, created_at, updated_at, paid_at
      ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, 'usd', ?, ?, NULL)`,
      orderId,
      customerName || 'Customer',
      customerEmail || '',
      'pending_payment',
      subtotal,
      subtotal,
      now,
      now,
    )
    for (const item of lineItems) {
      await db.run(
        `INSERT INTO order_items (
          id, order_id, design_id, sku, color_id, color_name, qty,
          unit_price_usd, worst_cost_unit_usd, line_total_usd, print_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unclaimed')`,
        randomUUID(),
        orderId,
        item.design.id,
        item.sku,
        item.colorId,
        item.colorName,
        item.qty,
        item.unit,
        item.worst,
        roundMoney(item.unit * item.qty),
      )
    }

    const origin = publicOrigin(req)
    const successUrl =
      process.env.STRIPE_SUCCESS_URL?.trim() ||
      `${origin}/order/success?session_id={CHECKOUT_SESSION_ID}`
    const cancelUrl = process.env.STRIPE_CANCEL_URL?.trim() || `${origin}/cart`

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      // Let Stripe collect name/email on the Checkout page.
      ...(customerEmail ? { customer_email: customerEmail } : {}),
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: orderId,
      metadata: { orderId },
      ...stripeCheckoutShippingFields(),
      // Ad-hoc price_data only — catalog lives in Supabase, never Stripe Products.
      line_items: lineItems.map((i) => ({
        quantity: i.qty,
        price_data: {
          currency: 'usd',
          unit_amount: Math.round(i.unit * 100),
          product_data: {
            name: `${i.design.name} (${i.colorName})`,
            description: i.sku,
            images: i.design.imageUrl?.startsWith('http') ? [i.design.imageUrl] : undefined,
          },
        },
      })),
    })

    await db.run(
      `UPDATE orders SET stripe_session_id = ?, updated_at = ? WHERE id = ?`,
      session.id,
      now,
      orderId,
    )

    send(res, 200, { url: session.url, orderId, sessionId: session.id })
    return true
  }

  if (urlPath === '/api/public/stripe-webhook' && method === 'POST') {
    const stripe = stripeClient()
    const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim()
    if (!stripe || !secret) {
      send(res, 503, { error: 'Stripe webhook not configured.' })
      return true
    }
    const raw = await readRaw(req)
    const sig = req.headers['stripe-signature']
    if (typeof sig !== 'string') {
      send(res, 400, { error: 'Missing signature.' })
      return true
    }
    let event: Stripe.Event
    try {
      event = stripe.webhooks.constructEvent(raw, sig, secret)
    } catch (err) {
      send(res, 400, { error: err instanceof Error ? err.message : 'Invalid signature' })
      return true
    }
    if (event.type === 'checkout.session.completed') {
      let session = event.data.object as Stripe.Checkout.Session
      const now = new Date().toISOString()
      const paymentIntent =
        typeof session.payment_intent === 'string' ? session.payment_intent : null
      // Webhook payload may omit nested ship-to; re-fetch session + PI for a durable address.
      let ship = parseCheckoutShipping(session)
      if (!ship.shippingLine1 && !ship.shippingCity && !ship.shippingPostal && session.id) {
        try {
          const loaded = await loadCheckoutShipping(stripe, session.id)
          session = loaded.session
          ship = loaded.ship
        } catch (err) {
          console.warn(
            '[printx] Could not re-fetch Checkout shipping after webhook',
            session.id,
            err instanceof Error ? err.message : err,
          )
        }
      }
      const shippingMethod = await resolveShippingMethodName(
        stripe,
        session,
        ship.shippingMethod,
      )
      const stripeEmail = ship.customerEmail
      const stripeName = ship.customerName
      const customRequestId = session.metadata?.customRequestId?.trim()
      if (customRequestId) {
        await db.run(
          `UPDATE custom_requests SET
            status = 'new',
            name = CASE WHEN ? != '' THEN ? ELSE name END,
            email = CASE WHEN ? != '' THEN ? ELSE email END,
            shipping_name = ?,
            shipping_line1 = ?,
            shipping_line2 = ?,
            shipping_city = ?,
            shipping_state = ?,
            shipping_postal = ?,
            shipping_country = ?,
            shipping_method = ?,
            shipping_usd = ?,
            stripe_session_id = ?,
            paid_at = ?,
            updated_at = ?
           WHERE id = ? AND status = 'awaiting_payment'`,
          stripeName,
          stripeName,
          stripeEmail,
          stripeEmail,
          ship.shippingName || stripeName,
          ship.shippingLine1,
          ship.shippingLine2,
          ship.shippingCity,
          ship.shippingState,
          ship.shippingPostal,
          ship.shippingCountry,
          shippingMethod,
          ship.shippingUsd,
          session.id,
          now,
          now,
          customRequestId,
        )
      } else {
        const orderId = session.metadata?.orderId || session.client_reference_id
        if (orderId) {
          await db.run(
            `UPDATE orders SET
              status = 'paid',
              customer_name = CASE WHEN ? != '' THEN ? ELSE customer_name END,
              customer_email = CASE WHEN ? != '' THEN ? ELSE customer_email END,
              shipping_name = ?,
              shipping_line1 = ?,
              shipping_line2 = ?,
              shipping_city = ?,
              shipping_state = ?,
              shipping_postal = ?,
              shipping_country = ?,
              shipping_method = ?,
              shipping_usd = ?,
              total_usd = COALESCE(?, total_usd),
              stripe_session_id = COALESCE(stripe_session_id, ?),
              stripe_payment_intent = ?,
              paid_at = ?,
              updated_at = ?
             WHERE id = ? AND status = 'pending_payment'`,
            stripeName,
            stripeName,
            stripeEmail,
            stripeEmail,
            ship.shippingName || stripeName,
            ship.shippingLine1,
            ship.shippingLine2,
            ship.shippingCity,
            ship.shippingState,
            ship.shippingPostal,
            ship.shippingCountry,
            shippingMethod,
            ship.shippingUsd,
            ship.amountTotalUsd,
            session.id,
            paymentIntent,
            now,
            now,
            orderId,
          )
        }
      }
    }
    send(res, 200, { received: true })
    return true
  }

  // ----- Admin: pricing (main only) -----
  if (urlPath === '/api/admin/pricing' && method === 'GET') {
    const admin = await requireAdmin(req)
    if (!admin) {
      send(res, 401, { error: 'Unauthorized' })
      return true
    }
    if (!admin.isMainAdmin && !adminCan(admin, 'products')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    const settings = await getPricingSettings(db)
    const printers = await listPrinters(db)
    send(res, 200, { settings, printers, customColors: settings.customColors })
    return true
  }

  if (urlPath === '/api/admin/pricing' && method === 'PATCH') {
    const admin = await requireAdmin(req)
    if (!admin?.isMainAdmin) {
      send(res, 403, { error: 'Only the main admin can edit pricing.' })
      return true
    }
    const body = await readJson(req)
    const settings = await getPricingSettings(db)
    const num = (k: string, cur: number) => {
      if (body[k] === undefined) return cur
      const n = Number(body[k])
      return Number.isFinite(n) && n >= 0 ? n : cur
    }
    let customColors = settings.customColors
    if (body.customColors !== undefined) {
      customColors = normalizeCustomSlots(body.customColors)
    }
    const now = new Date().toISOString()
    await db.run(
      `UPDATE pricing_settings SET
        filament_usd_per_gram = ?, electricity_usd_per_kwh = ?, margin_pct = ?,
        unproductive_adder_usd = ?, fixing_adder_usd = ?, sales_tax_pct = ?,
        custom_colors_json = ?, updated_at = ?, updated_by = ?
       WHERE id = 'default'`,
      num('filamentUsdPerGram', settings.filamentUsdPerGram),
      num('electricityUsdPerKwh', settings.electricityUsdPerKwh),
      num('marginPct', settings.marginPct),
      num('unproductiveAdderUsd', settings.unproductiveAdderUsd),
      num('fixingAdderUsd', settings.fixingAdderUsd),
      num('salesTaxPct', settings.salesTaxPct),
      JSON.stringify(customColors.length ? customColors : emptyCustomColorSlots()),
      now,
      admin.id,
    )
    if (Array.isArray(body.printers)) {
      for (const raw of body.printers) {
        if (!raw || typeof raw !== 'object') continue
        const p = raw as Record<string, unknown>
        const id = String(p.id ?? '')
        if (!id) continue
        if (p.avgPowerKw !== undefined) {
          const kw = Number(p.avgPowerKw)
          if (Number.isFinite(kw) && kw > 0) {
            await db.run(`UPDATE printers SET avg_power_kw = ? WHERE id = ?`, kw, id)
          }
        }
      }
    }
    const next = await getPricingSettings(db)
    const printers = await listPrinters(db)
    send(res, 200, { settings: next, printers, customColors: next.customColors })
    return true
  }

  // ----- Designs -----
  if (urlPath === '/api/admin/designs' && method === 'GET') {
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'products')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    const rows = await db.all<Record<string, unknown>>(
      `SELECT * FROM designs ORDER BY updated_at DESC`,
    )
    send(res, 200, rows.map(rowToDesign).map(designDto))
    return true
  }

  if (
    (urlPath === '/api/admin/designs/upload-stl' || urlPath === '/api/admin/designs/upload-model') &&
    method === 'POST'
  ) {
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'products')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    try {
      const { fileName, modelExt } = await parseModelUpload(req)
      send(res, 201, { stlPath: fileName, hasStl: true, modelExt })
      return true
    } catch (err) {
      send(res, 400, { error: err instanceof Error ? err.message : 'Model upload failed' })
      return true
    }
  }

  if (urlPath === '/api/admin/designs' && method === 'POST') {
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'products')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    const body = await readJson(req)
    const parsed = parseDesignBody(body)
    if (!parsed.name) {
      send(res, 400, { error: 'Name is required.' })
      return true
    }
    const stlPath = sanitizeText(String(body.stlPath ?? ''), 200)
    if (!stlPath || stlPath.includes('..') || stlPath.includes('/') || stlPath.includes('\\')) {
      send(res, 400, { error: 'Upload a 3D model before saving the design.' })
      return true
    }
    const now = new Date().toISOString()
    const id = randomUUID()
    try {
      await db.run(
        `INSERT INTO designs (
          id, sku_base, name, description, category, image_url, stl_path, slice_status, slice_error,
          status, created_by,
          submitted_at, reviewed_by, reviewed_at, review_note,
          grams_pablo_p1s, hours_pablo_p1s, grams_court_ender, hours_court_ender,
          grams_josh_kobra, hours_josh_kobra, available_color_ids,
          worst_cost_usd, catalog_price_usd, priced_at, pricing_inputs_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'idle', '', 'draft', ?, NULL, NULL, NULL, '', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, '{}', ?, ?)`,
        id,
        parsed.skuBase,
        parsed.name,
        parsed.description,
        parsed.category,
        parsed.imageUrl,
        stlPath,
        admin.id,
        parsed.gramsPabloP1s,
        parsed.hoursPabloP1s,
        parsed.gramsCourtEnder,
        parsed.hoursCourtEnder,
        parsed.gramsJoshKobra,
        parsed.hoursJoshKobra,
        JSON.stringify(parsed.availableColorIds),
        now,
        now,
      )
    } catch {
      send(res, 400, { error: 'Could not create design (SKU may already exist).' })
      return true
    }
    const row = await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', id)
    send(res, 201, designDto(rowToDesign(row!)))
    return true
  }

  const designStlMatch = /^\/api\/admin\/designs\/([^/]+)\/stl$/.exec(urlPath)
  if (designStlMatch && method === 'GET') {
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'products')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    const designId = designStlMatch[1]!
    const row = await db.get<{ stl_path: string }>(
      'SELECT stl_path FROM designs WHERE id = ?',
      designId,
    )
    const stlPath = row?.stl_path?.trim()
    if (!stlPath || stlPath.includes('..') || stlPath.includes('/') || stlPath.includes('\\')) {
      send(res, 404, { error: 'Model not found' })
      return true
    }
    const ext = path.extname(stlPath).toLowerCase()
    const ok =
      ext === '.stl'
        ? await sendStlWithDevFallback(
            res,
            designId,
            stlPath,
            modelContentType(ext),
            'private, max-age=60',
          )
        : await sendStoredFile(res, stlPath, modelContentType(ext), 'private, max-age=60')
    if (!ok) {
      send(res, 404, { error: 'Model not found' })
      return true
    }
    return true
  }

  const designMatch =
    /^\/api\/admin\/designs\/([^/]+)(?:\/(submit|requote|approve|reject|reprice))?$/.exec(urlPath)
  if (designMatch) {
    const designId = designMatch[1]!
    const action = designMatch[2]
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'products')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    const existingRow = await db.get<Record<string, unknown>>(
      'SELECT * FROM designs WHERE id = ?',
      designId,
    )
    if (!existingRow) {
      send(res, 404, { error: 'Design not found' })
      return true
    }
    let design = rowToDesign(existingRow)

    if (method === 'GET' && !action) {
      const priced = designHasPricableInputs(design)
        ? await computeDesignPrice(db, design).catch(() => null)
        : null
      send(res, 200, { design: designDto(design), preview: priced?.result ?? null })
      return true
    }

    if (method === 'PATCH' && !action) {
      const body = await readJson(req)
      const parsed = parseDesignBody(body, design)
      // Ignore empty stlPath so a stale client field cannot wipe an existing model.
      const incomingStl =
        body.stlPath !== undefined ? sanitizeText(String(body.stlPath ?? ''), 200) : ''
      const stlPath =
        incomingStl && !incomingStl.includes('..') && !incomingStl.includes('/') && !incomingStl.includes('\\')
          ? incomingStl
          : design.stlPath
      const stlChanged = stlPath !== design.stlPath
      const now = new Date().toISOString()
      try {
        await db.run(
          `UPDATE designs SET
            sku_base = ?, name = ?, description = ?, category = ?, image_url = ?,
            stl_path = ?,
            slice_status = ?,
            slice_error = ?,
            grams_pablo_p1s = ?, hours_pablo_p1s = ?, grams_court_ender = ?, hours_court_ender = ?,
            grams_josh_kobra = ?, hours_josh_kobra = ?, available_color_ids = ?,
            quote_ids_json = CASE WHEN ? THEN '{}' ELSE quote_ids_json END,
            file_ids_json = CASE WHEN ? THEN '{}' ELSE file_ids_json END,
            updated_at = ?
           WHERE id = ?`,
          parsed.skuBase,
          parsed.name,
          parsed.description,
          parsed.category,
          parsed.imageUrl,
          stlPath,
          stlChanged ? 'idle' : design.sliceStatus,
          stlChanged ? '' : design.sliceError,
          stlChanged ? null : parsed.gramsPabloP1s,
          stlChanged ? null : parsed.hoursPabloP1s,
          stlChanged ? null : parsed.gramsCourtEnder,
          stlChanged ? null : parsed.hoursCourtEnder,
          stlChanged ? null : parsed.gramsJoshKobra,
          stlChanged ? null : parsed.hoursJoshKobra,
          JSON.stringify(parsed.availableColorIds),
          stlChanged ? 1 : 0,
          stlChanged ? 1 : 0,
          now,
          designId,
        )
      } catch {
        send(res, 400, { error: 'Update failed (SKU conflict?).' })
        return true
      }
      design = rowToDesign(
        (await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId))!,
      )
      send(res, 200, designDto(design))
      return true
    }

    if (method === 'DELETE' && !action) {
      if (!admin.isMainAdmin && design.createdBy !== admin.id) {
        send(res, 403, { error: 'Only the creator or main admin can delete.' })
        return true
      }
      if (design.status === 'approved') {
        await db.run(
          `UPDATE designs SET status = 'archived', updated_at = ? WHERE id = ?`,
          new Date().toISOString(),
          designId,
        )
      } else {
        await db.run(`DELETE FROM designs WHERE id = ?`, designId)
      }
      invalidateBootstrapCache()
      send(res, 200, { ok: true })
      return true
    }

    if (method === 'POST' && action === 'submit') {
      if (!design.hasStl || !design.stlPath) {
        send(res, 400, { error: 'Upload a 3D model before submitting.' })
        return true
      }
      if (design.availableColorIds.length === 0) {
        send(res, 400, { error: 'Pick at least one color before submitting.' })
        return true
      }

      const modelExt = path.extname(design.stlPath).toLowerCase()
      const now = new Date().toISOString()
      // Queue for Approvals immediately — Cloud Slicer can take minutes and must not
      // block the submit response (UI was freezing waiting on quotes).
      let sliceWarning = ''
      if (SLICEABLE_EXTS.has(modelExt)) {
        await db.run(
          `UPDATE designs SET
            status = 'pending_review', submitted_at = ?, updated_at = ?, review_note = '',
            slice_status = 'slicing', slice_error = ''
           WHERE id = ?`,
          now,
          now,
          designId,
        )
        const stlPath = design.stlPath
        void (async () => {
          try {
            const bg = await getDb()
            await sliceDesignWithCloudSlicer(bg, designId, stlPath, { fillMissingOnly: true })
          } catch (err) {
            console.error('[catalog] background slice after submit failed:', err)
          }
        })()
        sliceWarning = 'Cloud Slicer quoting in the background — refresh Approvals shortly.'
      } else {
        sliceWarning =
          'Model is not .stl/.3mf — Cloud Slicer could not auto-quote. Convert and re-quote before approving.'
        await db.run(
          `UPDATE designs SET
            status = 'pending_review', submitted_at = ?, updated_at = ?, review_note = '',
            slice_status = 'error', slice_error = ?
           WHERE id = ?`,
          now,
          now,
          sliceWarning.slice(0, 2000),
          designId,
        )
      }

      design = rowToDesign(
        (await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId))!,
      )
      send(res, 200, { ...designDto(design), sliceWarning: sliceWarning || undefined })
      return true
    }

    if (method === 'POST' && action === 'requote') {
      if (!design.hasStl || !design.stlPath) {
        send(res, 400, { error: 'Upload a 3D model before quoting.' })
        return true
      }
      const modelExt = path.extname(design.stlPath).toLowerCase()
      if (!SLICEABLE_EXTS.has(modelExt)) {
        send(res, 400, {
          error: 'Cloud Slicer needs .stl or .3mf to auto-quote.',
        })
        return true
      }
      // Fill only printers still missing quotes — never wipe ones that already succeeded.
      const sliced = await sliceDesignWithCloudSlicer(db, designId, design.stlPath, {
        fillMissingOnly: true,
      })
      if (!sliced.ok) {
        send(res, 400, { error: sliced.error })
        return true
      }
      send(res, 200, { ...designDto(sliced.design), sliceWarning: sliced.warning || undefined })
      return true
    }

    if (method === 'POST' && (action === 'approve' || action === 'reprice')) {
      if (!admin.isMainAdmin) {
        send(res, 403, { error: 'Only the main admin can approve designs.' })
        return true
      }
      if (!designHasPricableInputs(design)) {
        send(res, 400, {
          error:
            'Need colors and at least one printer quote. Link Cloud Slicer and use Re-quote missing.',
        })
        return true
      }
      const { result, settings, printers } = await computeDesignPrice(db, design)
      const now = new Date().toISOString()
      await db.run(
        `UPDATE designs SET
          status = 'approved', reviewed_by = ?, reviewed_at = ?, review_note = ?,
          worst_cost_usd = ?, catalog_price_usd = ?, priced_at = ?,
          pricing_inputs_json = ?, updated_at = ?
         WHERE id = ?`,
        admin.id,
        now,
        action === 'reprice' ? 'Repriced' : 'Approved',
        result.worstCostUsd,
        result.catalogPriceUsd,
        now,
        JSON.stringify({ result, settings, printers }),
        now,
        designId,
      )
      invalidateBootstrapCache()
      design = rowToDesign(
        (await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId))!,
      )
      send(res, 200, { design: designDto(design), pricing: result })
      return true
    }

    if (method === 'POST' && action === 'reject') {
      if (!admin.isMainAdmin) {
        send(res, 403, { error: 'Only the main admin can reject designs.' })
        return true
      }
      const body = await readJson(req)
      const note = sanitizeText(String(body.note ?? ''), 500)
      const now = new Date().toISOString()
      await db.run(
        `UPDATE designs SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, review_note = ?, updated_at = ? WHERE id = ?`,
        admin.id,
        now,
        note || 'Rejected',
        now,
        designId,
      )
      design = rowToDesign(
        (await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId))!,
      )
      send(res, 200, designDto(design))
      return true
    }
  }

  // ----- Orders -----
  async function backfillOrderShippingFromStripe(
    row: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (String(row.shipping_line1 || '').trim()) return row
    let sessionId = String(row.stripe_session_id || '').trim()
    const piId = String(row.stripe_payment_intent || '').trim()
    const stripe = stripeClient()
    if (!stripe) {
      console.warn('[printx] Shipping backfill skipped — STRIPE_SECRET_KEY not configured')
      return row
    }
    try {
      if (!sessionId && piId) {
        const listed = await stripe.checkout.sessions.list({
          payment_intent: piId,
          limit: 1,
        })
        sessionId = listed.data[0]?.id?.trim() || ''
        if (sessionId) {
          await db.run(
            `UPDATE orders SET stripe_session_id = ?, updated_at = ? WHERE id = ?`,
            sessionId,
            new Date().toISOString(),
            String(row.id),
          )
        }
      }

      let ship: ReturnType<typeof parseCheckoutShipping>
      let session: Stripe.Checkout.Session | null = null
      if (sessionId) {
        const loaded = await loadCheckoutShipping(stripe, sessionId)
        ship = loaded.ship
        session = loaded.session
      } else if (piId) {
        const paymentIntent = await stripe.paymentIntents.retrieve(piId, {
          expand: ['latest_charge'],
        })
        ship = parseCheckoutShipping(
          { customer_details: null, shipping_cost: null } as Stripe.Checkout.Session,
          paymentIntent,
        )
      } else {
        return row
      }

      if (!ship.shippingLine1 && !ship.shippingCity && !ship.shippingPostal) {
        console.warn('[printx] Stripe has no ship-to address for order', String(row.id), {
          sessionId: sessionId || null,
          piId: piId || null,
          hasCollected: Boolean(
            session &&
              (session as { collected_information?: unknown }).collected_information,
          ),
          shippingCost: session?.shipping_cost?.amount_total ?? null,
        })
        return row
      }
      const shippingMethod = session
        ? await resolveShippingMethodName(stripe, session, ship.shippingMethod)
        : ship.shippingMethod
      const now = new Date().toISOString()
      await db.run(
        `UPDATE orders SET
           shipping_name = CASE WHEN ? != '' THEN ? ELSE shipping_name END,
           shipping_line1 = CASE WHEN ? != '' THEN ? ELSE shipping_line1 END,
           shipping_line2 = CASE WHEN ? != '' THEN ? ELSE shipping_line2 END,
           shipping_city = CASE WHEN ? != '' THEN ? ELSE shipping_city END,
           shipping_state = CASE WHEN ? != '' THEN ? ELSE shipping_state END,
           shipping_postal = CASE WHEN ? != '' THEN ? ELSE shipping_postal END,
           shipping_country = CASE WHEN ? != '' THEN ? ELSE shipping_country END,
           shipping_method = CASE WHEN ? != '' THEN ? ELSE shipping_method END,
           shipping_usd = CASE WHEN ? > 0 THEN ? ELSE shipping_usd END,
           updated_at = ?
         WHERE id = ?`,
        ship.shippingName,
        ship.shippingName,
        ship.shippingLine1,
        ship.shippingLine1,
        ship.shippingLine2,
        ship.shippingLine2,
        ship.shippingCity,
        ship.shippingCity,
        ship.shippingState,
        ship.shippingState,
        ship.shippingPostal,
        ship.shippingPostal,
        ship.shippingCountry,
        ship.shippingCountry,
        shippingMethod,
        shippingMethod,
        ship.shippingUsd,
        ship.shippingUsd,
        now,
        String(row.id),
      )
      return (
        (await db.get<Record<string, unknown>>('SELECT * FROM orders WHERE id = ?', String(row.id))) ||
        row
      )
    } catch (err) {
      console.warn(
        '[printx] Could not backfill shipping from Stripe',
        sessionId || piId || String(row.id),
        err instanceof Error ? err.message : err,
      )
      return row
    }
  }

  if (urlPath === '/api/admin/orders' && method === 'GET') {
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'orders')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    const rows = await db.all<Record<string, unknown>>(
      `SELECT * FROM orders WHERE status IN ('paid', 'in_production', 'ready', 'fulfilled', 'refunded')
       ORDER BY COALESCE(paid_at, created_at) DESC LIMIT 200`,
    )
    const orders = []
    for (const raw of rows) {
      const row = await backfillOrderShippingFromStripe(raw)
      const order = rowToOrder(row)
      const items = await db.all<Record<string, unknown>>(
        `SELECT oi.*, d.name as design_name
         FROM order_items oi
         JOIN designs d ON d.id = oi.design_id
         WHERE oi.order_id = ?
         ORDER BY oi.sku ASC`,
        order.id,
      )
      order.items = items.map(rowToOrderItem)
      orders.push(order)
    }
    const printers = await listPrinters(db)
    send(res, 200, { orders, printers })
    return true
  }

  const orderDeleteMatch = /^\/api\/admin\/orders\/([^/]+)$/.exec(urlPath)
  if (orderDeleteMatch && method === 'DELETE') {
    const orderId = orderDeleteMatch[1]!
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'orders')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    const order = await db.get<{ id: string; status: string }>(
      'SELECT id, status FROM orders WHERE id = ?',
      orderId,
    )
    if (!order) {
      send(res, 404, { error: 'Order not found' })
      return true
    }
    // Ledger rows cascade via order_items; settlements are month snapshots and stay.
    await db.run('DELETE FROM orders WHERE id = ?', orderId)
    send(res, 200, { ok: true, id: orderId })
    return true
  }

  const orderRefundMatch = /^\/api\/admin\/orders\/([^/]+)\/refund$/.exec(urlPath)
  if (orderRefundMatch && method === 'POST') {
    const orderId = orderRefundMatch[1]!
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'orders')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    const stripe = stripeClient()
    if (!stripe) {
      send(res, 503, {
        error:
          'Stripe is not configured. Set STRIPE_SECRET_KEY in the server environment (Render Runtime, or local .env) and restart.',
      })
      return true
    }
    const order = await db.get<Record<string, unknown>>('SELECT * FROM orders WHERE id = ?', orderId)
    if (!order) {
      send(res, 404, { error: 'Order not found' })
      return true
    }
    const status = String(order.status || '')
    if (status === 'refunded') {
      const items = await db.all<Record<string, unknown>>(
        `SELECT oi.*, d.name as design_name FROM order_items oi
         JOIN designs d ON d.id = oi.design_id WHERE oi.order_id = ? ORDER BY oi.sku ASC`,
        orderId,
      )
      const result = rowToOrder(order)
      result.items = items.map(rowToOrderItem)
      send(res, 200, result)
      return true
    }
    if (!['paid', 'in_production', 'ready', 'fulfilled'].includes(status)) {
      send(res, 400, { error: 'Only paid orders can be refunded.' })
      return true
    }

    const stripeErrText = (err: unknown): string => {
      if (!err || typeof err !== 'object') return String(err)
      const e = err as {
        message?: string
        code?: string
        raw?: { message?: string; code?: string; decline_code?: string }
      }
      return e.raw?.message || e.message || String(err)
    }
    const isAlreadyRefunded = (err: unknown): boolean => {
      const e = err as { code?: string; raw?: { code?: string } }
      const code = e.code || e.raw?.code || ''
      if (code === 'charge_already_refunded') return true
      return /already been refunded|has already been refunded|charge.*?fully refunded/i.test(
        stripeErrText(err),
      )
    }

    let paymentIntent =
      typeof order.stripe_payment_intent === 'string' && order.stripe_payment_intent.trim()
        ? order.stripe_payment_intent.trim()
        : ''
    const sessionId =
      typeof order.stripe_session_id === 'string' ? order.stripe_session_id.trim() : ''

    // Prefer live session lookup so we always have the current PaymentIntent id.
    if (sessionId) {
      try {
        const session = await stripe.checkout.sessions.retrieve(sessionId)
        if (typeof session.payment_intent === 'string' && session.payment_intent) {
          paymentIntent = session.payment_intent
        } else if (
          session.payment_intent &&
          typeof session.payment_intent === 'object' &&
          'id' in session.payment_intent
        ) {
          paymentIntent = String(session.payment_intent.id)
        }
      } catch (err) {
        if (!paymentIntent) {
          send(res, 400, {
            error: `Could not load Stripe Checkout session: ${stripeErrText(err)}`,
          })
          return true
        }
        console.warn('[printx] refund: session retrieve failed, using stored payment_intent', err)
      }
    }

    if (!paymentIntent) {
      send(res, 400, {
        error:
          'No Stripe payment found for this order. The Checkout webhook may not have recorded payment_intent — check STRIPE_WEBHOOK_SECRET and checkout.session.completed.',
      })
      return true
    }

    let alreadyRefundedOnStripe = false
    try {
      const pi = await stripe.paymentIntents.retrieve(paymentIntent, {
        expand: ['latest_charge'],
      })
      const charge = pi.latest_charge
      const chargeFullyRefunded =
        charge && typeof charge === 'object' && Boolean(charge.refunded)

      if (chargeFullyRefunded) {
        alreadyRefundedOnStripe = true
      } else {
        // Full refund of the Checkout total (items + shipping).
        await stripe.refunds.create({
          payment_intent: paymentIntent,
          reason: 'requested_by_customer',
        })
      }
    } catch (err) {
      if (isAlreadyRefunded(err)) {
        alreadyRefundedOnStripe = true
      } else {
        console.error('[printx] Stripe refund failed', paymentIntent, err)
        send(res, 400, { error: stripeErrText(err) || 'Refund failed' })
        return true
      }
    }

    const now = new Date().toISOString()
    await db.run(
      `UPDATE orders SET
         status = 'refunded',
         stripe_payment_intent = ?,
         updated_at = ?
       WHERE id = ?`,
      paymentIntent,
      now,
      orderId,
    )
    const updated = await db.get<Record<string, unknown>>('SELECT * FROM orders WHERE id = ?', orderId)
    const result = rowToOrder(updated!)
    const items = await db.all<Record<string, unknown>>(
      `SELECT oi.*, d.name as design_name
       FROM order_items oi
       JOIN designs d ON d.id = oi.design_id
       WHERE oi.order_id = ?
       ORDER BY oi.sku ASC`,
      orderId,
    )
    result.items = items.map(rowToOrderItem)
    if (alreadyRefundedOnStripe) {
      console.log('[printx] Order marked refunded; Stripe charge was already refunded', orderId)
    }
    send(res, 200, result)
    return true
  }

  const orderItemGcodeMatch = /^\/api\/admin\/order-items\/([^/]+)\/gcode$/.exec(urlPath)
  if (orderItemGcodeMatch && method === 'GET') {
    const itemId = orderItemGcodeMatch[1]!
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'orders')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    try {
      const { buffer, filename } = await downloadOrderItemGcode(db, itemId)
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/octet-stream')
      res.setHeader('Content-Disposition', `attachment; filename="${filename.replace(/"/g, '')}"`)
      res.setHeader('Cache-Control', 'private, no-store')
      res.end(buffer)
    } catch (err) {
      send(res, 400, { error: err instanceof Error ? err.message : 'G-code download failed' })
    }
    return true
  }

  const claimMatch = /^\/api\/admin\/order-items\/([^/]+)\/(claim|complete)$/.exec(urlPath)
  if (claimMatch && method === 'POST') {
    const itemId = claimMatch[1]!
    const action = claimMatch[2]!
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'orders')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    if (action === 'claim') {
      const body = await readJson(req)
      const printerId = String(body.printerId ?? '')
      const printers = await listPrinters(db)
      if (!printers.some((p) => p.id === printerId && p.active)) {
        send(res, 400, { error: 'Choose a valid printer.' })
        return true
      }
      const item = await db.get<Record<string, unknown>>(
        'SELECT * FROM order_items WHERE id = ?',
        itemId,
      )
      if (!item) {
        send(res, 404, { error: 'Item not found' })
        return true
      }
      if (item.print_status !== 'unclaimed') {
        send(res, 400, { error: 'Item is already claimed.' })
        return true
      }
      const order = await db.get<Record<string, unknown>>(
        'SELECT * FROM orders WHERE id = ?',
        item.order_id,
      )
      if (!order || !['paid', 'in_production', 'ready'].includes(String(order.status))) {
        send(res, 400, { error: 'Order is not ready to print.' })
        return true
      }
      const now = new Date().toISOString()
      await db.run(
        `UPDATE order_items SET print_status = 'claimed', assigned_printer_id = ?,
         assigned_admin_user_id = ?, claimed_at = ? WHERE id = ?`,
        printerId,
        admin.id,
        now,
        itemId,
      )
      await db.run(`UPDATE orders SET status = 'in_production', updated_at = ? WHERE id = ?`, now, item.order_id)
      const updated = await db.get<Record<string, unknown>>(
        `SELECT oi.*, d.name as design_name FROM order_items oi
         JOIN designs d ON d.id = oi.design_id WHERE oi.id = ?`,
        itemId,
      )
      send(res, 200, rowToOrderItem(updated!))
      return true
    }
    if (action === 'complete') {
      const result = await settleOrderItem(db, itemId, admin.id)
      if (!result.ok) {
        send(res, 400, { error: result.error })
        return true
      }
      const updated = await db.get<Record<string, unknown>>(
        `SELECT oi.*, d.name as design_name FROM order_items oi
         JOIN designs d ON d.id = oi.design_id WHERE oi.id = ?`,
        itemId,
      )
      send(res, 200, rowToOrderItem(updated!))
      return true
    }
  }

  if (urlPath === '/api/admin/ledger' && method === 'GET') {
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'orders')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    const rows = await db.all<Record<string, unknown>>(
      `SELECT l.*, u.email as user_email, u.display_name as user_display_name
       FROM profit_ledger l
       JOIN users u ON u.id = l.user_id
       ORDER BY l.created_at DESC LIMIT 300`,
    )
    send(res, 200, rows)
    return true
  }

  if (urlPath === '/api/admin/money' && method === 'GET') {
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'orders')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    const qs = (req.url ?? '').split('?')[1] ?? ''
    const monthParam = new URLSearchParams(qs).get('month')?.trim() || ''
    const now = new Date()
    const yearMonth =
      /^\d{4}-\d{2}$/.test(monthParam)
        ? monthParam
        : `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
    const [yStr, mStr] = yearMonth.split('-')
    const y = Number(yStr)
    const m = Number(mStr)
    const rangeStart = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0)).toISOString()
    const rangeEnd = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0)).toISOString()
    const calendarYear = now.getUTCFullYear()
    const yearStart = new Date(Date.UTC(calendarYear, 0, 1, 0, 0, 0, 0)).toISOString()
    const yearEnd = new Date(Date.UTC(calendarYear + 1, 0, 1, 0, 0, 0, 0)).toISOString()

    const sumStripeInRange = async (start: string | null, end: string | null) => {
      const shopParams: unknown[] = []
      let shopSql = `SELECT COALESCE(SUM(total_usd), 0) as total FROM orders
        WHERE paid_at IS NOT NULL
          AND status IN ('paid', 'in_production', 'ready', 'fulfilled')`
      if (start) {
        shopSql += ` AND paid_at >= ?`
        shopParams.push(start)
      }
      if (end) {
        shopSql += ` AND paid_at < ?`
        shopParams.push(end)
      }
      const customParams: unknown[] = []
      let customSql = `SELECT COALESCE(SUM(catalog_price_usd), 0) as total FROM custom_requests
        WHERE paid_at IS NOT NULL AND catalog_price_usd IS NOT NULL`
      if (start) {
        customSql += ` AND paid_at >= ?`
        customParams.push(start)
      }
      if (end) {
        customSql += ` AND paid_at < ?`
        customParams.push(end)
      }
      const shopRow = await db.get<{ total: number | string | null }>(shopSql, ...shopParams)
      const customRow = await db.get<{ total: number | string | null }>(customSql, ...customParams)
      return roundMoney((Number(shopRow?.total) || 0) + (Number(customRow?.total) || 0))
    }

    const sumReimburseInRange = async (
      start: string | null,
      end: string | null,
      userId?: string,
    ) => {
      const params: unknown[] = []
      let sql = `SELECT COALESCE(SUM(amount_usd), 0) as total FROM profit_ledger
        WHERE entry_type = 'reimburse'`
      if (userId) {
        sql += ` AND user_id = ?`
        params.push(userId)
      }
      if (start) {
        sql += ` AND created_at >= ?`
        params.push(start)
      }
      if (end) {
        sql += ` AND created_at < ?`
        params.push(end)
      }
      const row = await db.get<{ total: number | string | null }>(sql, ...params)
      return roundMoney(Number(row?.total) || 0)
    }

    const shopOrders = await db.all<Record<string, unknown>>(
      `SELECT id, customer_name, customer_email, total_usd, status, paid_at, stripe_session_id
       FROM orders
       WHERE paid_at IS NOT NULL
         AND paid_at >= ? AND paid_at < ?
         AND status IN ('paid', 'in_production', 'ready', 'fulfilled')
       ORDER BY paid_at DESC`,
      rangeStart,
      rangeEnd,
    )
    const customPaid = await db.all<Record<string, unknown>>(
      `SELECT id, name, email, catalog_price_usd, status, paid_at, stripe_session_id
       FROM custom_requests
       WHERE paid_at IS NOT NULL
         AND paid_at >= ? AND paid_at < ?
         AND catalog_price_usd IS NOT NULL
       ORDER BY paid_at DESC`,
      rangeStart,
      rangeEnd,
    )

    const shopEarnings = roundMoney(
      shopOrders.reduce((sum, o) => sum + (Number(o.total_usd) || 0), 0),
    )
    const customEarnings = roundMoney(
      customPaid.reduce((sum, o) => sum + (Number(o.catalog_price_usd) || 0), 0),
    )
    const earningsTotalUsd = roundMoney(shopEarnings + customEarnings)

    const ledgerRows = await db.all<Record<string, unknown>>(
      `SELECT l.id, l.user_id, l.amount_usd, l.note, l.created_at, l.order_item_id,
              u.email as user_email, u.display_name as user_display_name,
              oi.qty, oi.sku, oi.color_name, oi.order_id,
              d.name as design_name
       FROM profit_ledger l
       JOIN users u ON u.id = l.user_id
       LEFT JOIN order_items oi ON oi.id = l.order_item_id
       LEFT JOIN designs d ON d.id = oi.design_id
       WHERE l.entry_type = 'reimburse'
         AND l.created_at >= ? AND l.created_at < ?
       ORDER BY l.created_at DESC`,
      rangeStart,
      rangeEnd,
    )

    const byUser = new Map<
      string,
      {
        userId: string
        email: string
        displayName: string | null
        totalOwedUsd: number
        lines: {
          id: string
          amountUsd: number
          note: string
          createdAt: string
          orderId: string | null
          designName: string | null
          sku: string | null
          colorName: string | null
          qty: number | null
        }[]
      }
    >()
    for (const row of ledgerRows) {
      const userId = String(row.user_id)
      let bucket = byUser.get(userId)
      if (!bucket) {
        bucket = {
          userId,
          email: String(row.user_email ?? ''),
          displayName:
            typeof row.user_display_name === 'string' && row.user_display_name.trim()
              ? row.user_display_name.trim()
              : null,
          totalOwedUsd: 0,
          lines: [],
        }
        byUser.set(userId, bucket)
      }
      const amount = Number(row.amount_usd) || 0
      bucket.totalOwedUsd = roundMoney(bucket.totalOwedUsd + amount)
      bucket.lines.push({
        id: String(row.id),
        amountUsd: roundMoney(amount),
        note: String(row.note ?? ''),
        createdAt: String(row.created_at ?? ''),
        orderId: row.order_id != null ? String(row.order_id) : null,
        designName: row.design_name != null ? String(row.design_name) : null,
        sku: row.sku != null ? String(row.sku) : null,
        colorName: row.color_name != null ? String(row.color_name) : null,
        qty: row.qty != null ? Number(row.qty) || null : null,
      })
    }

    const settlements = await db.all<Record<string, unknown>>(
      `SELECT s.*, u.email as user_email, u.display_name as user_display_name
       FROM printer_settlements s
       JOIN users u ON u.id = s.user_id
       WHERE s.year_month = ?`,
      yearMonth,
    )
    const settledByUser = new Map(
      settlements.map((s) => [
        String(s.user_id),
        {
          id: String(s.id),
          amountUsd: roundMoney(Number(s.amount_usd) || 0),
          markedPaidAt: String(s.marked_paid_at ?? ''),
          note: String(s.note ?? ''),
        },
      ]),
    )

    const owedByPerson = [...byUser.values()]
      .map((p) => ({
        ...p,
        settlement: settledByUser.get(p.userId) ?? null,
      }))
      .sort((a, b) => b.totalOwedUsd - a.totalOwedUsd)

    const reimbursementsTotalUsd = roundMoney(
      owedByPerson.reduce((sum, p) => sum + p.totalOwedUsd, 0),
    )

    // Sequential — session pooler has one client; parallel queries queue/saturate it.
    const yearStripeUsd = await sumStripeInRange(yearStart, yearEnd)
    const yearOwedToMeUsd = await sumReimburseInRange(yearStart, yearEnd, admin.id)
    const yearReimbursementsUsd = await sumReimburseInRange(yearStart, yearEnd)
    const allTimeStripeUsd = await sumStripeInRange(null, null)
    const allTimeOwedToMeUsd = await sumReimburseInRange(null, null, admin.id)
    const allTimeReimbursementsUsd = await sumReimburseInRange(null, null)

    // ISO timestamps → YYYY-MM via substr works on both SQLite and Postgres.
    const shopByMonth = await db.all<{ ym: string; total: number | string | null }>(
      `SELECT substr(paid_at, 1, 7) as ym, COALESCE(SUM(total_usd), 0) as total
       FROM orders
       WHERE paid_at IS NOT NULL
         AND length(paid_at) >= 7
         AND status IN ('paid', 'in_production', 'ready', 'fulfilled')
       GROUP BY substr(paid_at, 1, 7)`,
    )
    const customByMonth = await db.all<{ ym: string; total: number | string | null }>(
      `SELECT substr(paid_at, 1, 7) as ym, COALESCE(SUM(catalog_price_usd), 0) as total
       FROM custom_requests
       WHERE paid_at IS NOT NULL
         AND catalog_price_usd IS NOT NULL
         AND length(paid_at) >= 7
       GROUP BY substr(paid_at, 1, 7)`,
    )
    const reimburseByMonth = await db.all<{ ym: string; total: number | string | null }>(
      `SELECT substr(created_at, 1, 7) as ym, COALESCE(SUM(amount_usd), 0) as total
       FROM profit_ledger
       WHERE entry_type = 'reimburse' AND length(created_at) >= 7
       GROUP BY substr(created_at, 1, 7)`,
    )
    const owedToMeByMonth = await db.all<{ ym: string; total: number | string | null }>(
      `SELECT substr(created_at, 1, 7) as ym, COALESCE(SUM(amount_usd), 0) as total
       FROM profit_ledger
       WHERE entry_type = 'reimburse'
         AND user_id = ?
         AND length(created_at) >= 7
       GROUP BY substr(created_at, 1, 7)`,
      admin.id,
    )
    const mySettlements = await db.all<Record<string, unknown>>(
      `SELECT year_month, amount_usd, marked_paid_at
       FROM printer_settlements
       WHERE user_id = ?`,
      admin.id,
    )

    type HistBucket = {
      month: string
      stripeUsd: number
      owedToMeUsd: number
      reimbursementsUsd: number
      mySettlement: { amountUsd: number; markedPaidAt: string } | null
    }
    const historyMap = new Map<string, HistBucket>()
    const ensureMonth = (ym: string) => {
      const key = String(ym || '').trim()
      if (!/^\d{4}-\d{2}$/.test(key)) return null
      let bucket = historyMap.get(key)
      if (!bucket) {
        bucket = {
          month: key,
          stripeUsd: 0,
          owedToMeUsd: 0,
          reimbursementsUsd: 0,
          mySettlement: null,
        }
        historyMap.set(key, bucket)
      }
      return bucket
    }
    for (const row of shopByMonth) {
      const bucket = ensureMonth(row.ym)
      if (bucket) bucket.stripeUsd = roundMoney(bucket.stripeUsd + (Number(row.total) || 0))
    }
    for (const row of customByMonth) {
      const bucket = ensureMonth(row.ym)
      if (bucket) bucket.stripeUsd = roundMoney(bucket.stripeUsd + (Number(row.total) || 0))
    }
    for (const row of reimburseByMonth) {
      const bucket = ensureMonth(row.ym)
      if (bucket) {
        bucket.reimbursementsUsd = roundMoney(bucket.reimbursementsUsd + (Number(row.total) || 0))
      }
    }
    for (const row of owedToMeByMonth) {
      const bucket = ensureMonth(row.ym)
      if (bucket) bucket.owedToMeUsd = roundMoney(bucket.owedToMeUsd + (Number(row.total) || 0))
    }
    for (const row of mySettlements) {
      const bucket = ensureMonth(String(row.year_month || ''))
      if (bucket) {
        bucket.mySettlement = {
          amountUsd: roundMoney(Number(row.amount_usd) || 0),
          markedPaidAt: String(row.marked_paid_at ?? ''),
        }
      }
    }
    // Always include the selected month even if empty so history feels continuous.
    ensureMonth(yearMonth)

    const monthHistory = [...historyMap.values()].sort((a, b) => b.month.localeCompare(a.month))

    send(res, 200, {
      month: yearMonth,
      earnings: {
        totalUsd: earningsTotalUsd,
        shopUsd: shopEarnings,
        customUsd: customEarnings,
        shopOrders: shopOrders.map((o) => ({
          id: String(o.id),
          kind: 'shop' as const,
          label: String(o.customer_name || o.customer_email || 'Customer'),
          email: String(o.customer_email ?? ''),
          amountUsd: roundMoney(Number(o.total_usd) || 0),
          status: String(o.status ?? ''),
          paidAt: o.paid_at != null ? String(o.paid_at) : null,
          stripeSessionId: o.stripe_session_id != null ? String(o.stripe_session_id) : null,
        })),
        customOrders: customPaid.map((o) => ({
          id: String(o.id),
          kind: 'custom' as const,
          label: String(o.name || o.email || 'Custom print'),
          email: String(o.email ?? ''),
          amountUsd: roundMoney(Number(o.catalog_price_usd) || 0),
          status: String(o.status ?? ''),
          paidAt: o.paid_at != null ? String(o.paid_at) : null,
          stripeSessionId: o.stripe_session_id != null ? String(o.stripe_session_id) : null,
        })),
      },
      owedByPerson,
      reimbursementsTotalUsd,
      businessKeptUsd: roundMoney(earningsTotalUsd - reimbursementsTotalUsd),
      canSettle: admin.isMainAdmin,
      totals: {
        year: {
          year: calendarYear,
          stripeUsd: yearStripeUsd,
          owedToMeUsd: yearOwedToMeUsd,
          reimbursementsUsd: yearReimbursementsUsd,
        },
        allTime: {
          stripeUsd: allTimeStripeUsd,
          owedToMeUsd: allTimeOwedToMeUsd,
          reimbursementsUsd: allTimeReimbursementsUsd,
        },
      },
      monthHistory,
    })
    return true
  }

  if (urlPath === '/api/admin/money/settle' && method === 'POST') {
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'orders')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    if (!admin.isMainAdmin) {
      send(res, 403, { error: 'Only the main admin can mark settlements paid.' })
      return true
    }
    const body = await readJson(req)
    const userId = sanitizeText(String(body.userId ?? ''), 80)
    const yearMonth = String(body.yearMonth ?? '').trim()
    const note = sanitizeText(String(body.note ?? ''), 240)
    if (!userId || !/^\d{4}-\d{2}$/.test(yearMonth)) {
      send(res, 400, { error: 'userId and yearMonth (YYYY-MM) are required.' })
      return true
    }
    const user = await db.get<{ id: string }>('SELECT id FROM users WHERE id = ?', userId)
    if (!user) {
      send(res, 404, { error: 'User not found.' })
      return true
    }
    const [yStr, mStr] = yearMonth.split('-')
    const y = Number(yStr)
    const m = Number(mStr)
    const rangeStart = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0)).toISOString()
    const rangeEnd = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0)).toISOString()
    const sumRow = await db.get<{ total: number | string | null }>(
      `SELECT COALESCE(SUM(amount_usd), 0) as total
       FROM profit_ledger
       WHERE entry_type = 'reimburse'
         AND user_id = ?
         AND created_at >= ? AND created_at < ?`,
      userId,
      rangeStart,
      rangeEnd,
    )
    const amountUsd = roundMoney(Number(sumRow?.total ?? 0))
    if (amountUsd <= 0) {
      send(res, 400, { error: 'Nothing owed to this person for that month.' })
      return true
    }
    const now = new Date().toISOString()
    const existing = await db.get<{ id: string }>(
      'SELECT id FROM printer_settlements WHERE user_id = ? AND year_month = ?',
      userId,
      yearMonth,
    )
    if (existing) {
      await db.run(
        `UPDATE printer_settlements
         SET amount_usd = ?, marked_paid_at = ?, marked_by = ?, note = ?
         WHERE id = ?`,
        amountUsd,
        now,
        admin.id,
        note,
        existing.id,
      )
      send(res, 200, {
        ok: true,
        id: existing.id,
        userId,
        yearMonth,
        amountUsd,
        markedPaidAt: now,
        note,
      })
      return true
    }
    const id = randomUUID()
    await db.run(
      `INSERT INTO printer_settlements
         (id, user_id, year_month, amount_usd, marked_paid_at, marked_by, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      userId,
      yearMonth,
      amountUsd,
      now,
      admin.id,
      note,
    )
    send(res, 200, {
      ok: true,
      id,
      userId,
      yearMonth,
      amountUsd,
      markedPaidAt: now,
      note,
    })
    return true
  }

  if (urlPath === '/api/admin/catalog-stats' && method === 'GET') {
    const admin = await requireAdmin(req)
    if (!admin) {
      send(res, 401, { error: 'Unauthorized' })
      return true
    }
    const pending = await db.get<{ c: number | string }>(
      `SELECT COUNT(*) as c FROM designs WHERE status = 'pending_review'`,
    )
    const unclaimed = await db.get<{ c: number | string }>(
      `SELECT COUNT(*) as c FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE oi.print_status = 'unclaimed' AND o.status IN ('paid', 'in_production')`,
    )
    send(res, 200, {
      pendingApprovals: Number(pending?.c ?? 0),
      unclaimedItems: Number(unclaimed?.c ?? 0),
    })
    return true
  }

  return false
}
