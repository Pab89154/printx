import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import formidable from 'formidable'
import Stripe from 'stripe'
import {
  adminCan,
  CUSTOMER_SESSION_COOKIE,
  getSessionCustomer,
  getSessionUser,
  parseCookies,
  sanitizeEmail,
  sanitizeText,
  setCustomerStripeId,
  SESSION_COOKIE,
  type SessionAdmin,
  type SessionCustomer,
} from './auth.ts'
import { upsTrackUrl } from './shippingUrls.ts'
import { notifyAdminsWithPermission, notifyAdminUsers, notifyMainAdmins } from './pushNotify.ts'
import { runInBackground } from './background.ts'
import { permissionsForUser } from '../shared/permissions.ts'
import { advanceArrivedOrders, ensureOrderTrackCode } from './trackCodes.ts'
import {
  arrivedEtaIso,
  normalizeTrackCode,
  publicOrderStatusLabel,
  publicPrintStatusLabel,
} from '../shared/orderTracking.ts'
import { getDb, getUploadsDir, migrateShippingToProfit } from './db.ts'
import { stripeFeeOnChargeUsd } from '../shared/stripeFees.ts'
import {
  cashAgreementText,
  cashSaleItemNotice,
  stripeAgreementText,
} from '../shared/checkoutConsent.ts'
import { invalidateBootstrapCache } from './bootstrapCache.ts'
import {
  buildSku,
  colorById,
  computeDesignPrice,
  applyAdminOwnedColors,
  compareByPopularity,
  designBuyerCounts,
  designHasPricableInputs,
  filamentStock,
  getPricingSettings,
  listPrinters,
  rowToDesign,
  rowToOrder,
  rowToOrderItem,
  parsePartsJson,
  sanitizeSkuBase,
  seedCatalogDefaults,
  suggestSkuBase,
  type Design,
  type DesignPart,
} from './catalog.ts'
import {
  BUILTIN_COLORS,
  clampMulticolorSlotCount,
  defaultMulticolorPartLabel,
  emptyCustomColorSlots,
  formatMulticolorSelection,
  isMulticolorColorId,
  isOfferedFilament,
  MULTICOLOR_COLOR,
  MULTICOLOR_COLOR_ID,
  normalizeCustomSlots,
  solidBuiltinColors,
} from '../shared/colors.ts'
import {
  isModelExt,
  MODEL_EXTS,
  modelContentType,
  SLICEABLE_EXTS,
} from '../shared/modelFormats.ts'
import { boundsSizeMm, measureStlBuffer, unionBounds, type StlBounds } from './stlFit.ts'
import { parseGcodeMetrics, writeGcodePreviewStl } from './gcodeToStl.ts'
import { roundMoney } from './pricing.ts'
import {
  loadCheckoutShipping,
  parseCheckoutShipping,
  probeCheckoutShippingSources,
  resolveShippingMethodName,
  stripeAccountSavedPaymentFields,
  standardShippingCents,
  stripeCheckoutShippingFields,
  stripeTermsConsentFields,
  type ShippingSourceProbe,
} from './stripeShipping.ts'
import {
  advancePrinterQuote,
  cloudSlicerConfigured,
  type CloudSlicerCreds,
} from './cloudSlicer.ts'
import { loadStoredGcode, openStoredGcode, storeGcodeBuffer } from './gcodeStorage.ts'
import {
  designGcodePrepareInFlight,
  dispatchGcodePrepareJob,
  GCODE_PREPARE_STALE_MS,
  isPreparingGcodeMessage,
  markDesignGcodePreparing,
} from './gcodePrepare.ts'
import {
  designGcodeSliceTargets,
  gcodeReadyPrinterIds,
  printerHasStoredGcodes,
  safeGcodeFilenamePart,
} from './gcodePartPaths.ts'
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

function designDto(
  d: Design,
): Omit<Design, 'stlPath' | 'parts' | 'gcodePathsJson'> & {
  stlPath: ''
  modelExt: string
  parts: { label: string; stlPath: ''; hasStl: boolean; modelExt: string }[]
  gcodeReadyPrinters: string[]
  fromGcode: boolean
} {
  const modelExt = path.extname(d.stlPath || '').toLowerCase()
  const gcodePaths = parseDesignIdMap(d.gcodePathsJson)
  const partCount = designGcodeSliceTargets(d).length
  const { gcodePathsJson: _drop, ...rest } = d
  return {
    ...rest,
    stlPath: '',
    modelExt,
    parts: d.parts.map((p) => ({
      label: p.label,
      stlPath: '' as const,
      hasStl: Boolean(p.stlPath.trim()),
      modelExt: path.extname(p.stlPath || '').toLowerCase(),
    })),
    gcodeReadyPrinters: gcodeReadyPrinterIds(gcodePaths, Math.max(1, partCount)),
    fromGcode: Boolean(gcodePaths.source),
  }
}

function safeGcodePath(raw: unknown): string {
  const p = safeStlPath(raw)
  return p.toLowerCase().endsWith('.gcode') ? p : ''
}

function designUploadedGcode(design: Design): string {
  try {
    const parsed = JSON.parse(design.gcodePathsJson || '{}') as Record<string, unknown>
    return typeof parsed.source === 'string' ? parsed.source : ''
  } catch {
    return ''
  }
}

/** Copy uploaded G-code grams/hours onto every printer and store the file for orders. */
async function persistUploadedGcodeQuote(
  db: Awaited<ReturnType<typeof getDb>>,
  designId: string,
  gcodeName: string,
): Promise<void> {
  const resolved = await resolveStoredFile(gcodeName)
  if (!resolved) throw new Error('G-code file is missing. Upload it again.')
  try {
    const text = fs.readFileSync(resolved.path, 'utf8')
    const metrics = parseGcodeMetrics(text)
    if (metrics.grams == null || metrics.hours == null) {
      throw new Error('This G-code has no filament weight or print time. Export it from the slicer again.')
    }
    const paths = {
      source: gcodeName,
      pablo_p1s: gcodeName,
      court_ender: gcodeName,
      josh_kobra: gcodeName,
    }
    await db.run(
      `UPDATE designs SET
        grams_pablo_p1s = ?, hours_pablo_p1s = ?,
        grams_court_ender = ?, hours_court_ender = ?,
        grams_josh_kobra = ?, hours_josh_kobra = ?,
        gcode_paths_json = ?,
        slice_status = 'ready', slice_error = '', updated_at = ?
       WHERE id = ?`,
      metrics.grams,
      metrics.hours,
      metrics.grams,
      metrics.hours,
      metrics.grams,
      metrics.hours,
      JSON.stringify(paths),
      new Date().toISOString(),
      designId,
    )
  } finally {
    resolved.cleanup?.()
  }
}

function safeStlPath(raw: unknown): string {
  const p = sanitizeText(String(raw ?? ''), 200)
  if (!p || p.includes('..') || p.includes('/') || p.includes('\\')) return ''
  return p
}

/** Merge client part payloads with existing paths (empty stlPath keeps previous). */
function mergeDesignParts(
  bodyParts: unknown,
  existing: DesignPart[],
  slotCount: number,
  multicolorOnly: boolean,
): DesignPart[] {
  if (!multicolorOnly) return []
  const slots = clampMulticolorSlotCount(slotCount)
  const incoming = Array.isArray(bodyParts) ? bodyParts : null
  if (!incoming) {
    return parsePartsJson(JSON.stringify(existing), slots)
  }
  const out: DesignPart[] = []
  for (let i = 0; i < slots; i++) {
    const row = incoming[i] as { label?: unknown; stlPath?: unknown } | undefined
    const label =
      sanitizeText(String(row?.label ?? existing[i]?.label ?? ''), 40) ||
      defaultMulticolorPartLabel(i)
    const nextPath = row?.stlPath !== undefined ? safeStlPath(row.stlPath) : ''
    const stlPath = nextPath || existing[i]?.stlPath || ''
    out.push({ label, stlPath })
  }
  return out
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

type ModelUploadResult = {
  fileName: string
  modelExt: string
  sourceGcodePath?: string
  grams?: number
  hours?: number
  fromGcode?: boolean
}

async function parseModelUpload(req: IncomingMessage): Promise<ModelUploadResult> {
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
        if (ext === '.gcode') {
          let text = ''
          try {
            text = fs.readFileSync(dest, 'utf8')
          } catch (readErr) {
            try {
              fs.unlinkSync(dest)
            } catch {
              /* ignore */
            }
            return reject(readErr)
          }
          const metrics = parseGcodeMetrics(text)
          if (metrics.grams == null || metrics.hours == null) {
            try {
              fs.unlinkSync(dest)
            } catch {
              /* ignore */
            }
            return reject(
              new Error(
                'This G-code has no filament weight or print time. Export it from the slicer again.',
              ),
            )
          }
          const previewName = `${randomUUID()}.stl`
          const previewPath = path.join(uploadsDir, previewName)
          try {
            writeGcodePreviewStl(text, previewPath)
            if (objectStorageRequired()) {
              await uploadStoredFile(dest, safeName)
              await uploadStoredFile(previewPath, previewName)
            }
          } catch (uploadErr) {
            try {
              fs.unlinkSync(dest)
            } catch {
              /* ignore */
            }
            try {
              fs.unlinkSync(previewPath)
            } catch {
              /* ignore */
            }
            return reject(uploadErr instanceof Error ? uploadErr : new Error('G-code upload failed'))
          }
          resolve({
            fileName: previewName,
            modelExt: '.stl',
            sourceGcodePath: safeName,
            grams: metrics.grams,
            hours: metrics.hours,
            fromGcode: true,
          })
          return
        }
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

type BoundsRow = {
  min_x: number
  min_y: number
  min_z: number
  max_x: number
  max_y: number
  max_z: number
}

function rowToBounds(row: BoundsRow): StlBounds {
  return {
    minX: Number(row.min_x),
    minY: Number(row.min_y),
    minZ: Number(row.min_z),
    maxX: Number(row.max_x),
    maxY: Number(row.max_y),
    maxZ: Number(row.max_z),
  }
}

async function rememberStlFile(
  db: Awaited<ReturnType<typeof getDb>>,
  fileName: string,
): Promise<StlBounds | null> {
  const safe = path.basename(fileName)
  if (!safe.toLowerCase().endsWith('.stl')) return null
  const candidates = [
    path.join(await getUploadsDir(), safe),
    path.join(process.cwd(), 'models', safe),
  ]
  const found = candidates.find((p) => fs.existsSync(p))
  if (!found) return null
  let bounds: StlBounds | null = null
  try {
    bounds = measureStlBuffer(fs.readFileSync(found))
  } catch {
    return null
  }
  if (!bounds || !boundsSizeMm(bounds)) return null
  await db.run(
    `INSERT INTO model_bounds (file_name, min_x, min_y, min_z, max_x, max_y, max_z)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(file_name) DO UPDATE SET
       min_x = excluded.min_x, min_y = excluded.min_y, min_z = excluded.min_z,
       max_x = excluded.max_x, max_y = excluded.max_y, max_z = excluded.max_z`,
    safe,
    bounds.minX,
    bounds.minY,
    bounds.minZ,
    bounds.maxX,
    bounds.maxY,
    bounds.maxZ,
  )
  return bounds
}

/** Measure the design STL (or the union of multicolor parts) and store millimeters. */
async function refreshDesignSize(
  db: Awaited<ReturnType<typeof getDb>>,
  designId: string,
  stlPath: string,
  parts: { stlPath: string }[],
  multicolorOnly: boolean,
): Promise<void> {
  const names = (multicolorOnly ? parts.map((p) => p.stlPath) : [stlPath])
    .map((name) => path.basename(String(name || '').trim()))
    .filter((name) => name.toLowerCase().endsWith('.stl'))
  const boxes: StlBounds[] = []
  for (const name of names) {
    let row = await db.get<BoundsRow>(
      `SELECT min_x, min_y, min_z, max_x, max_y, max_z FROM model_bounds WHERE file_name = ?`,
      name,
    )
    if (!row) {
      await rememberStlFile(db, name)
      row = await db.get<BoundsRow>(
        `SELECT min_x, min_y, min_z, max_x, max_y, max_z FROM model_bounds WHERE file_name = ?`,
        name,
      )
    }
    if (row) boxes.push(rowToBounds(row))
  }
  const box = unionBounds(boxes)
  const size = box ? boundsSizeMm(box) : null
  if (!size) return
  await db.run(
    `UPDATE designs SET size_x_mm = ?, size_y_mm = ?, size_z_mm = ? WHERE id = ?`,
    size.xMm,
    size.yMm,
    size.zMm,
    designId,
  )
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
async function markDesignSliceError(
  db: Awaited<ReturnType<typeof getDb>>,
  designId: string,
  error: string,
): Promise<void> {
  try {
    await db.run(
      `UPDATE designs SET slice_status = 'error', slice_error = ?, updated_at = ? WHERE id = ?`,
      error.slice(0, 2000),
      new Date().toISOString(),
      designId,
    )
  } catch (err) {
    console.error('[catalog] failed to persist slice error:', err)
  }
}

async function sliceDesignWithCloudSlicer(
  db: Awaited<ReturnType<typeof getDb>>,
  designId: string,
  stlPath: string,
  opts?: { fillMissingOnly?: boolean },
): Promise<{ ok: true; design: Design; warning?: string } | { ok: false; error: string }> {
  const fillMissingOnly = opts?.fillMissingOnly !== false
  let resolved: { path: string; cleanup?: () => void } | null = null

  try {
    const existingRow = await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId)
    if (!existingRow) {
      const error = 'Design not found.'
      await markDesignSliceError(db, designId, error)
      return { ok: false, error }
    }
    const existing = rowToDesign(existingRow)
    const quoteIds = parseDesignIdMap(existingRow.quote_ids_json)
    const fileIds = parseDesignIdMap(existingRow.file_ids_json)
    const gcodePaths = parseDesignIdMap(existingRow.gcode_paths_json)

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
      const canCloud = cloudSlicerConfigured(creds)
      // Pricing uses Cloud Slicer only — local Bambu freezes the Render web process.
      if (!canCloud) {
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

    // Workers are killed around 30s. Advance quotes in short ticks and persist ids
    // so the next page load or cron continues the same Cloud Slicer job.
    const tickStarted = Date.now()
    const TICK_BUDGET_MS = 18_000
    let deferred = false
    let localPath = ''
    if (ready.some((item) => !fileIds[item.printerId])) {
      resolved = await resolveStoredFile(stlPath)
      if (!resolved) {
        const error = 'Model file missing on server. Re-upload the design file.'
        await markDesignSliceError(db, designId, error)
        return { ok: false, error }
      }
      localPath = resolved.path
    }
    if (ready.length > 0) {
      await db.run(
        `UPDATE designs SET slice_status = 'slicing', updated_at = ? WHERE id = ?`,
        new Date().toISOString(),
        designId,
      )
      for (const item of ready) {
        const remaining = TICK_BUDGET_MS - (Date.now() - tickStarted)
        if (remaining < 1500) {
          deferred = true
          break
        }
        try {
          const result = await advancePrinterQuote(
            item.creds,
            localPath,
            { fileId: fileIds[item.printerId], quoteId: quoteIds[item.printerId] },
            remaining,
          )
          if (result.fileId) fileIds[item.printerId] = result.fileId
          if (result.phase === 'failed') {
            delete quoteIds[item.printerId]
            quoteErrors.push(`${item.label}: ${result.error}`)
          } else {
            quoteIds[item.printerId] = result.quoteId
            if (result.phase === 'success') {
              const fields = PRINTER_FIELD[item.printerId]!
              gramsHours[fields.grams] = result.grams
              gramsHours[fields.hours] = result.hours
            } else {
              deferred = true
            }
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Slicer quoting failed'
          quoteErrors.push(`${item.label}: ${msg}`)
        }
        await db.run(
          `UPDATE designs SET
            grams_pablo_p1s = ?, hours_pablo_p1s = ?,
            grams_court_ender = ?, hours_court_ender = ?,
            grams_josh_kobra = ?, hours_josh_kobra = ?,
            quote_ids_json = ?, file_ids_json = ?, gcode_paths_json = ?,
            slice_status = 'slicing', updated_at = ?
           WHERE id = ?`,
          gramsHours.gramsPabloP1s,
          gramsHours.hoursPabloP1s,
          gramsHours.gramsCourtEnder,
          gramsHours.hoursCourtEnder,
          gramsHours.gramsJoshKobra,
          gramsHours.hoursJoshKobra,
          JSON.stringify(quoteIds),
          JSON.stringify(fileIds),
          JSON.stringify(gcodePaths),
          new Date().toISOString(),
          designId,
        )
        if (deferred) break
      }
    }

    const warningParts: string[] = []
    if (setupGaps.length) {
      warningParts.push(`Waiting on slicer setup:\n• ${setupGaps.join('\n• ')}`)
    }
    if (quoteErrors.length) {
      warningParts.push(`Quote errors:\n• ${quoteErrors.join('\n• ')}`)
    }
    const warning = warningParts.join('\n\n')

    const quotedCount = PRINTER_IDS.filter((id) => {
      const fields = PRINTER_FIELD[id]!
      return gramsHours[fields.grams] != null && gramsHours[fields.hours] != null
    }).length

    // Never return to 'idle' after a quote attempt — idle looks like "never approved" in Approvals
    // and blocks Re-quote (pending_review + idle). Stay on 'slicing' when this tick ran out of time.
    const sliceStatus: 'slicing' | 'ready' | 'error' = deferred
      ? 'slicing'
      : quotedCount > 0
        ? 'ready'
        : 'error'
    const finalWarning = deferred
      ? 'Still quoting via Cloud Slicer…'
      : warning ||
        (quotedCount === 0
          ? 'Quoting finished with no printer grams/hours. Check Cloud Slicer keys, then Re-quote missing.'
          : '')
    const reviewNote = /quoting/i.test(existing.reviewNote)
      ? existing.reviewNote.replace(/\s*[—-]\s*quoting\b.*/i, '').trim() || 'Accepted'
      : existing.reviewNote

    const now = new Date().toISOString()
    await db.run(
      `UPDATE designs SET
      grams_pablo_p1s = ?, hours_pablo_p1s = ?,
      grams_court_ender = ?, hours_court_ender = ?,
      grams_josh_kobra = ?, hours_josh_kobra = ?,
      quote_ids_json = ?, file_ids_json = ?, gcode_paths_json = ?,
      slice_status = ?, slice_error = ?, review_note = ?, updated_at = ?
     WHERE id = ?`,
      gramsHours.gramsPabloP1s,
      gramsHours.hoursPabloP1s,
      gramsHours.gramsCourtEnder,
      gramsHours.hoursCourtEnder,
      gramsHours.gramsJoshKobra,
      gramsHours.hoursJoshKobra,
      JSON.stringify(quoteIds),
      JSON.stringify(fileIds),
      JSON.stringify(gcodePaths),
      sliceStatus,
      finalWarning.slice(0, 2000),
      reviewNote,
      now,
      designId,
    )
    const row = await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId)
    return { ok: true, design: rowToDesign(row!), warning: finalWarning || undefined }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'Quoting failed'
    await markDesignSliceError(db, designId, error)
    return { ok: false, error }
  } finally {
    resolved.cleanup?.()
  }
}

/** Persist one printer’s Cloud Slicer ids + stored G-code path on a design. */
async function saveDesignPrinterQuote(
  db: Awaited<ReturnType<typeof getDb>>,
  designId: string,
  designRow: Record<string, unknown>,
  printerId: string,
  result: {
    quoteId: string
    fileId: string
    grams: number
    hours: number
    gcodePath?: string
  },
) {
  const quoteIds = { ...parseDesignIdMap(designRow.quote_ids_json), [printerId]: result.quoteId }
  const fileIds = { ...parseDesignIdMap(designRow.file_ids_json), [printerId]: result.fileId }
  const gcodePaths = { ...parseDesignIdMap(designRow.gcode_paths_json) }
  if (result.gcodePath) gcodePaths[printerId] = result.gcodePath
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
      designId,
    )
  } else {
    await db.run(
      `UPDATE designs SET quote_ids_json = ?, file_ids_json = ?, gcode_paths_json = ?, updated_at = ? WHERE id = ?`,
      JSON.stringify(quoteIds),
      JSON.stringify(fileIds),
      JSON.stringify(gcodePaths),
      new Date().toISOString(),
      designId,
    )
  }
  designRow.quote_ids_json = JSON.stringify(quoteIds)
  designRow.file_ids_json = JSON.stringify(fileIds)
  designRow.gcode_paths_json = JSON.stringify(gcodePaths)
}

type GcodePrepJob = {
  status: 'running' | 'ready' | 'error'
  error?: string
  /** Only kept briefly when persist failed — prefer disk/storage. */
  buffer?: Buffer
  filename?: string
  updatedAt: number
}

/**
 * Optional same-isolate cache only. Cloudflare Workers do not keep this Map across
 * requests — durable prepare state lives on designs.slice_status / slice_error.
 */
const orderGcodeJobs = new Map<string, GcodePrepJob>()

/** Drop ready/error job entries (and any leftover buffers) quickly on free-tier RAM. */
const GCODE_JOB_KEEP_MS = 2 * 60_000

function pruneOrderGcodeJobs() {
  const now = Date.now()
  for (const [id, job] of orderGcodeJobs) {
    const age = now - job.updatedAt
    if (job.status === 'running') {
      // Running is authoritative in DB now; drop orphan RAM markers quickly.
      if (age > GCODE_JOB_KEEP_MS) orderGcodeJobs.delete(id)
      continue
    }
    if (age > GCODE_JOB_KEEP_MS) orderGcodeJobs.delete(id)
  }
}

async function orderItemIsShipped(
  db: Awaited<ReturnType<typeof getDb>>,
  itemId: string,
): Promise<boolean> {
  const row = await db.get<{ shipped_at: string | null }>(
    `SELECT o.shipped_at
     FROM order_items oi
     JOIN orders o ON o.id = oi.order_id
     WHERE oi.id = ?`,
    itemId,
  )
  return Boolean(row?.shipped_at)
}

type OrderItemGcodeFileMeta = {
  storedName: string
  downloadName: string
  partIndex: number
  label: string
}

async function orderItemGcodePartMeta(
  db: Awaited<ReturnType<typeof getDb>>,
  itemId: string,
): Promise<{
  printerId: string
  sku: string
  targets: ReturnType<typeof designGcodeSliceTargets>
  gcodePaths: Record<string, string>
  files: OrderItemGcodeFileMeta[]
} | null> {
  const item = await db.get<Record<string, unknown>>('SELECT * FROM order_items WHERE id = ?', itemId)
  if (!item) return null
  const printerId = String(item.assigned_printer_id || '').trim()
  if (!printerId) return null
  const designId = String(item.design_id || '')
  const designRow = await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId)
  if (!designRow) return null
  const design = rowToDesign(designRow)
  const targets = designGcodeSliceTargets(design)
  if (!targets.length) return null
  const gcodePaths = parseDesignIdMap(designRow.gcode_paths_json)
  const sku = String(item.sku || designId).replace(/[^\w.-]+/g, '_')
  const files: OrderItemGcodeFileMeta[] = []
  for (const target of targets) {
    const key = target.storageKey(printerId)
    const storedName = gcodePaths[key] || ''
    if (!storedName) continue
    const partIndex = target.partIndex ?? 0
    const label = target.label
    const downloadName =
      target.partIndex != null
        ? `printx-${sku}-${printerId}-${safeGcodeFilenamePart(label, partIndex)}.gcode`
        : `printx-${sku}-${printerId}.gcode`
    files.push({ storedName, downloadName, partIndex, label })
  }
  return { printerId, sku, targets, gcodePaths, files }
}

async function orderItemStoredGcodeName(
  db: Awaited<ReturnType<typeof getDb>>,
  itemId: string,
  partIndex = 0,
): Promise<OrderItemGcodeFileMeta | null> {
  const meta = await orderItemGcodePartMeta(db, itemId)
  if (!meta) return null
  if (!printerHasStoredGcodes(meta.gcodePaths, meta.printerId, meta.targets.length)) {
    return null
  }
  return meta.files.find((f) => f.partIndex === partIndex) || meta.files[partIndex] || null
}

async function peekStoredOrderItemGcode(
  db: Awaited<ReturnType<typeof getDb>>,
  itemId: string,
  partIndex = 0,
): Promise<{ buffer: Buffer; filename: string } | null> {
  const file = await orderItemStoredGcodeName(db, itemId, partIndex)
  if (!file) return null
  const local = await loadStoredGcode(file.storedName)
  if (!local) return null
  return { buffer: local.buffer, filename: file.downloadName }
}

async function openOrderItemGcode(
  db: Awaited<ReturnType<typeof getDb>>,
  itemId: string,
  partIndex = 0,
): Promise<
  | { kind: 'stream'; path: string; filename: string; cleanup?: () => void }
  | { kind: 'buffer'; buffer: Buffer; filename: string }
  | null
> {
  pruneOrderGcodeJobs()
  const file = await orderItemStoredGcodeName(db, itemId, partIndex)
  if (file) {
    const opened = await openStoredGcode(file.storedName)
    if (opened) {
      return {
        kind: 'stream',
        path: opened.path,
        filename: file.downloadName,
        cleanup: opened.cleanup,
      }
    }
  }
  // In-memory job buffer is single-file only (legacy / non-multicolor).
  if (partIndex === 0) {
    const job = orderGcodeJobs.get(itemId)
    if (job?.status === 'ready' && job.buffer?.length) {
      const buffer = job.buffer
      const filename = job.filename || `printx-${itemId.slice(0, 8)}.gcode`
      // Keep the buffer until we have durable storage — dropping it made the next
      // Download click return 409 while status still said "ready".
      return { kind: 'buffer', buffer, filename }
    }
  }
  return null
}

/** True when G-code is available without loading the file into RAM. */
async function orderItemGcodeReady(
  db: Awaited<ReturnType<typeof getDb>>,
  itemId: string,
): Promise<boolean> {
  pruneOrderGcodeJobs()
  const meta = await orderItemGcodePartMeta(db, itemId)
  if (meta && printerHasStoredGcodes(meta.gcodePaths, meta.printerId, meta.targets.length)) {
    if (objectStorageConfigured()) return true
    const uploadsDir = await getUploadsDir()
    return meta.files.every((f) => fs.existsSync(path.join(uploadsDir, f.storedName)))
  }
  const job = orderGcodeJobs.get(itemId)
  // Filename alone is not enough — openOrderItemGcode needs a RAM buffer or storage.
  return Boolean(job?.status === 'ready' && job.buffer?.length)
}

/**
 * Serve pre-stored G-code only — never run Bambu/Cloud Slicer on the web host
 * (free-tier OOM/timeouts). Missing files are prepared via GitHub Actions.
 */
async function ensureOrderItemGcode(
  db: Awaited<ReturnType<typeof getDb>>,
  itemId: string,
  partIndex = 0,
): Promise<{ buffer: Buffer; filename: string }> {
  const existing = await peekStoredOrderItemGcode(db, itemId, partIndex)
  if (existing) return existing

  const item = await db.get<Record<string, unknown>>('SELECT * FROM order_items WHERE id = ?', itemId)
  if (!item) throw new Error('Order item not found.')
  const printerId = String(item.assigned_printer_id || '').trim()
  if (!printerId) throw new Error('Claim this item with a printer before downloading G-code.')

  const designId = String(item.design_id || '')
  const designRow = await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId)
  if (!designRow) throw new Error('Design not found for this order item.')

  const design = rowToDesign(designRow)
  const targets = designGcodeSliceTargets(design)
  const gcodePaths = parseDesignIdMap(designRow.gcode_paths_json)
  if (printerHasStoredGcodes(gcodePaths, printerId, targets.length)) {
    const again = await peekStoredOrderItemGcode(db, itemId, partIndex)
    if (again) return again
  }

  throw new Error(
    'G-code is not ready yet. Use Prepare G-code on Designs (runs the free GitHub Actions slicer), then tap Download again.',
  )
}

/**
 * Dispatch GitHub Actions prepare and persist "running" on the design row.
 * Never long-poll in the Worker — isolates die and the old in-memory Map looked "idle".
 */
async function startOrderGcodePrep(
  db: Awaited<ReturnType<typeof getDb>>,
  itemId: string,
): Promise<{ status: 'ready' | 'running' }> {
  pruneOrderGcodeJobs()
  if (await orderItemGcodeReady(db, itemId)) {
    orderGcodeJobs.set(itemId, { status: 'ready', updatedAt: Date.now() })
    return { status: 'ready' }
  }

  const item = await db.get<{ design_id: string; assigned_printer_id: string | null }>(
    'SELECT design_id, assigned_printer_id FROM order_items WHERE id = ?',
    itemId,
  )
  if (!item) throw new Error('Order item not found.')
  const printerId = String(item.assigned_printer_id || '').trim()
  if (!printerId) throw new Error('Claim this item with a printer before downloading G-code.')
  const designId = String(item.design_id || '')
  const designRow = await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId)
  if (!designRow) throw new Error('Design not found for this order item.')
  const design = rowToDesign(designRow)
  const targets = designGcodeSliceTargets(design)
  if (!targets.length) {
    throw new Error(
      design.multicolorOnly
        ? 'Multicolor design is missing part STLs to slice.'
        : 'Design has no model file to slice.',
    )
  }

  // Already dispatched recently — don't spam GitHub Actions on every status poll.
  if (designGcodePrepareInFlight(designRow)) {
    orderGcodeJobs.set(itemId, { status: 'running', updatedAt: Date.now() })
    return { status: 'running' }
  }

  await markDesignGcodePreparing(db, designId, printerId)
  const dispatched = await dispatchGcodePrepareJob({ designId, printerId })
  if (!dispatched.ok) {
    const now = new Date().toISOString()
    await db.run(
      `UPDATE designs SET slice_status = 'error', slice_error = ?, updated_at = ? WHERE id = ?`,
      dispatched.error,
      now,
      designId,
    )
    orderGcodeJobs.set(itemId, {
      status: 'error',
      error: dispatched.error,
      updatedAt: Date.now(),
    })
    throw new Error(dispatched.error)
  }

  orderGcodeJobs.set(itemId, { status: 'running', updatedAt: Date.now() })
  return { status: 'running' }
}

async function orderItemGcodePartCount(
  db: Awaited<ReturnType<typeof getDb>>,
  itemId: string,
): Promise<{ partCount: number; parts: { index: number; label: string }[] }> {
  const meta = await orderItemGcodePartMeta(db, itemId)
  if (!meta?.targets.length) return { partCount: 1, parts: [{ index: 0, label: '' }] }
  return {
    partCount: meta.targets.length,
    parts: meta.targets.map((t, i) => ({
      index: t.partIndex ?? i,
      label: t.label,
    })),
  }
}

async function orderItemGcodeStatus(
  db: Awaited<ReturnType<typeof getDb>>,
  itemId: string,
): Promise<{
  status: 'idle' | 'running' | 'ready' | 'error'
  error?: string
  partCount?: number
  parts?: { index: number; label: string }[]
}> {
  pruneOrderGcodeJobs()
  const partInfo = await orderItemGcodePartCount(db, itemId)
  if (await orderItemGcodeReady(db, itemId)) {
    return { status: 'ready', ...partInfo }
  }

  const item = await db.get<{ design_id: string; assigned_printer_id: string | null }>(
    'SELECT design_id, assigned_printer_id FROM order_items WHERE id = ?',
    itemId,
  )
  if (!item) return { status: 'error', error: 'Order item not found.', ...partInfo }

  const designRow = await db.get<Record<string, unknown>>(
    'SELECT slice_status, slice_error, updated_at FROM designs WHERE id = ?',
    String(item.design_id || ''),
  )
  if (!designRow) {
    return { status: 'error', error: 'Design not found for this order item.', ...partInfo }
  }

  const sliceError = String(designRow.slice_error || '').trim()
  const updatedAt = Date.parse(String(designRow.updated_at || '')) || 0
  const age = Number.isFinite(updatedAt) ? Date.now() - updatedAt : 0

  if (designGcodePrepareInFlight(designRow)) {
    return { status: 'running', ...partInfo }
  }

  // Stale "Preparing…" left behind when GH Actions never finished.
  if (isPreparingGcodeMessage(sliceError) && age >= GCODE_PREPARE_STALE_MS) {
    return {
      status: 'error',
      error:
        'G-code prepare timed out waiting for GitHub Actions. Check the prepare-gcode workflow, then tap Download again.',
      ...partInfo,
    }
  }

  if (sliceError && !isPreparingGcodeMessage(sliceError)) {
    const status = String(designRow.slice_status || '').trim()
    if (status === 'error' || status === 'slicing') {
      return { status: 'error', error: sliceError, ...partInfo }
    }
  }

  const job = orderGcodeJobs.get(itemId)
  if (job?.status === 'running') return { status: 'running', ...partInfo }
  if (job?.status === 'error') {
    return { status: 'error', error: job.error || 'G-code prepare failed', ...partInfo }
  }

  return { status: 'idle', ...partInfo }
}

/** Prepare stored G-code for a design+printer via GitHub Actions (admin Designs UI). */
export async function startDesignGcodePrepare(
  db: Awaited<ReturnType<typeof getDb>>,
  designId: string,
  printerId: string,
): Promise<{ status: 'ready' | 'running'; error?: string }> {
  const designRow = await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId)
  if (!designRow) throw new Error('Design not found.')
  const design = rowToDesign(designRow)
  const targets = designGcodeSliceTargets(design)
  const gcodePaths = parseDesignIdMap(designRow.gcode_paths_json)
  if (printerHasStoredGcodes(gcodePaths, printerId, targets.length)) {
    if (objectStorageConfigured()) return { status: 'ready' }
    const uploadsDir = await getUploadsDir()
    const allLocal = targets.every((t) => {
      const name = gcodePaths[t.storageKey(printerId)]
      return Boolean(name && fs.existsSync(path.join(uploadsDir, name)))
    })
    if (allLocal) return { status: 'ready' }
  }
  if (!targets.length) {
    throw new Error(
      design.multicolorOnly
        ? 'Multicolor design is missing part STLs to slice.'
        : 'Design has no model file to slice.',
    )
  }
  await markDesignGcodePreparing(db, designId, printerId)
  const dispatched = await dispatchGcodePrepareJob({ designId, printerId })
  if (!dispatched.ok) throw new Error(dispatched.error)
  return { status: 'running' }
}

const GRAMS_COLUMN: Record<string, string> = {
  pablo_p1s: 'grams_pablo_p1s',
  court_ender: 'grams_court_ender',
  josh_kobra: 'grams_josh_kobra',
}

/** Serialize long local/cloud quote jobs so the Postgres session pool (max 1) stays usable. */
let quoteJobChain: Promise<void> = Promise.resolve()

const quoteJobsInflight = new Set<string>()

function enqueueQuoteJob(label: string, work: () => Promise<void>): void {
  if (quoteJobsInflight.has(label)) return
  quoteJobsInflight.add(label)
  quoteJobChain = quoteJobChain
    .then(async () => {
      try {
        await work()
      } catch (err) {
        console.error(`[catalog] quote job "${label}" failed:`, err)
      } finally {
        quoteJobsInflight.delete(label)
      }
    })
    .catch((err) => {
      quoteJobsInflight.delete(label)
      console.error(`[catalog] quote job chain error after "${label}":`, err)
    })
  // Cloudflare drops work that is not passed to waitUntil after the response.
  runInBackground(label, () => quoteJobChain)
}

/** After an admin finishes Cloud Slicer setup, quote only the printers still missing. */
export async function fillMissingQuotesForPrinter(
  printxPrinterId: string,
): Promise<{ updated: number; warnings: string[] }> {
  const col = GRAMS_COLUMN[printxPrinterId]
  if (!col) return { updated: 0, warnings: [] }

  const db = await getDb()
  const rows = await db.all<Record<string, unknown>>(
    `SELECT id, stl_path, name FROM designs
     WHERE TRIM(stl_path) != ''
       AND ${col} IS NULL
       AND (
         status = 'approved'
         OR (status = 'pending_review' AND slice_status IN ('slicing', 'ready', 'error'))
       )
     ORDER BY updated_at DESC
     LIMIT 12`,
  )

  let updated = 0
  const warnings: string[] = []
  for (const row of rows) {
    const designId = String(row.id || '')
    const stlPath = String(row.stl_path || '')
    const name = String(row.name || designId)
    if (!designId || !stlPath) continue
    if (!SLICEABLE_EXTS.has(path.extname(stlPath).toLowerCase())) continue
    // Re-acquire DB per design so idle pool time stays available to the site.
    const sliceDb = await getDb()
    const sliced = await sliceDesignWithCloudSlicer(sliceDb, designId, stlPath, {
      fillMissingOnly: true,
    })
    if (sliced.ok) {
      if (printerHasQuote(sliced.design, printxPrinterId)) updated++
      if (sliced.warning) warnings.push(`${name}: ${sliced.warning}`)
    } else {
      warnings.push(`${name}: ${sliced.error}`)
    }
  }
  return { updated, warnings }
}

/** Non-blocking: keep Settings save fast; quoting runs after credentials are stored. */
export function scheduleFillMissingQuotesForPrinter(printxPrinterId: string): void {
  enqueueQuoteJob(`fill-missing:${printxPrinterId}`, async () => {
    const result = await fillMissingQuotesForPrinter(printxPrinterId)
    console.warn(
      `[catalog] fill-missing for ${printxPrinterId}: updated=${result.updated}` +
        (result.warnings.length ? `; warnings=${result.warnings.length}` : ''),
    )
  })
}

const GITHUB_QUOTE_NOTE = 'Quoting on GitHub Actions… leave this page open. This usually takes a few minutes.'

/** Workers cannot hold a Cloud Slicer quote open. Slice on GitHub Actions instead. */
async function dispatchDesignQuote(
  db: Awaited<ReturnType<typeof getDb>>,
  designId: string,
): Promise<Design> {
  const existingRow = await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId)
  if (!existingRow) throw new Error('Design not found.')
  let design = rowToDesign(existingRow)
  const quoted = PRINTER_IDS.filter((id) => printerHasQuote(design, id))
  const now = new Date().toISOString()
  const reviewNote = /quoting/i.test(design.reviewNote)
    ? design.reviewNote.replace(/\s*[—-]\s*quoting\b.*/i, '').trim() || 'Accepted'
    : design.reviewNote

  if (quoted.length === 0 && designUploadedGcode(design)) {
    await markDesignSliceError(
      db,
      designId,
      'Uploaded G-code is missing filament weight or print time.',
    )
    const row = await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId)
    return rowToDesign(row!)
  }

  if (quoted.length > 0) {
    await db.run(
      `UPDATE designs SET slice_status = 'ready', slice_error = '', review_note = ?, updated_at = ? WHERE id = ?`,
      reviewNote,
      now,
      designId,
    )
    const row = await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId)
    return rowToDesign(row!)
  }

  const updatedAt = Date.parse(design.updatedAt)
  const recentlyTouched = Number.isFinite(updatedAt) && Date.now() - updatedAt < 20 * 60_000
  const githubInFlight =
    design.sliceStatus === 'slicing' &&
    /GitHub Actions/i.test(design.sliceError) &&
    recentlyTouched
  // A failed run used to flip the row to error, and the page immediately dispatched again.
  const recentFailure = design.sliceStatus === 'error' && recentlyTouched
  if (githubInFlight || recentFailure) return design

  const printerId = PRINTER_IDS.find((id) => !printerHasQuote(design, id)) ?? 'pablo_p1s'
  const dispatched = await dispatchGcodePrepareJob({ designId, printerId })
  if (!dispatched.ok) {
    await markDesignSliceError(db, designId, dispatched.error)
    const row = await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId)
    return rowToDesign(row!)
  }

  await db.run(
    `UPDATE designs SET slice_status = 'slicing', slice_error = ?, review_note = ?, updated_at = ? WHERE id = ?`,
    GITHUB_QUOTE_NOTE,
    reviewNote,
    now,
    designId,
  )
  const row = await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId)
  return rowToDesign(row!)
}

export function scheduleDesignSlice(designId: string, _stlPath: string): void {
  enqueueQuoteJob(`design-slice:${designId}`, async () => {
    const bg = await getDb()
    try {
      await dispatchDesignQuote(bg, designId)
    } catch (err) {
      console.error(`[catalog] design-slice ${designId} failed:`, err)
    }
  })
}

/** Do not auto-restart GitHub quote runs. A retry loop was starting a new failure every minute. */
export async function resumeInterruptedDesignQuotes(): Promise<void> {
  return
}

export function scheduleCustomRequestQuote(requestId: string): void {
  enqueueQuoteJob(`custom-quote:${requestId}`, async () => {
    const { quoteCustomRequest } = await import('./customRequestSlice.ts')
    const bg = await getDb()
    await quoteCustomRequest(bg, requestId)
  })
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

async function requireCustomer(req: IncomingMessage): Promise<SessionCustomer | null> {
  const cookies = parseCookies(req.headers.cookie)
  return getSessionCustomer(cookies[CUSTOMER_SESSION_COOKIE] ?? null)
}

async function ensureStripeCustomer(
  stripe: Stripe,
  customer: SessionCustomer,
): Promise<string> {
  if (customer.stripeCustomerId) {
    try {
      const existing = await stripe.customers.retrieve(customer.stripeCustomerId)
      if (!('deleted' in existing && existing.deleted)) return customer.stripeCustomerId
    } catch {
      /* recreate below */
    }
  }
  const created = await stripe.customers.create({
    email: customer.email || undefined,
    name: customer.displayName || undefined,
    metadata: { printxUserId: customer.id },
  })
  await setCustomerStripeId(customer.id, created.id)
  customer.stripeCustomerId = created.id
  return created.id
}

export function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  if (!key) return null
  return new Stripe(key)
}

/** Mark a shop order paid from a Checkout Session (webhook + success-page recovery). */
async function confirmShopOrderFromCheckoutSession(
  db: Awaited<ReturnType<typeof getDb>>,
  stripe: Stripe,
  sessionId: string,
): Promise<boolean> {
  const loaded = await loadCheckoutShipping(stripe, sessionId)
  const session = loaded.session
  if (session.payment_status !== 'paid' && session.status !== 'complete') return false

  const orderId = session.metadata?.orderId || session.client_reference_id
  if (!orderId) return false

  const existing = await db.get<{ status: string }>(
    `SELECT status FROM orders WHERE id = ?`,
    orderId,
  )
  if (!existing) return false

  const ship = loaded.ship
  const shippingMethod = await resolveShippingMethodName(stripe, session, ship.shippingMethod)
  const now = new Date().toISOString()
  const paymentIntent =
    typeof session.payment_intent === 'string' ? session.payment_intent : null
  const stripeEmail = ship.customerEmail
  const stripeName = ship.customerName
  const customerUserId = session.metadata?.customerUserId?.trim() || ''

  if (existing.status === 'pending_payment') {
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
        subtotal_usd = COALESCE(?, subtotal_usd),
        total_usd = COALESCE(?, total_usd),
        stripe_session_id = COALESCE(stripe_session_id, ?),
        stripe_payment_intent = ?,
        paid_at = ?,
        updated_at = ?,
        user_id = COALESCE(user_id, NULLIF(?, '')),
        agreement_name = CASE
          WHEN TRIM(COALESCE(agreement_name, '')) = '' AND ? != '' THEN ?
          ELSE agreement_name
        END,
        agreement_text = CASE
          WHEN TRIM(COALESCE(agreement_text, '')) = '' THEN ?
          ELSE agreement_text
        END,
        agreement_terms_checked = 1,
        agreement_at = COALESCE(agreement_at, ?)
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
      ship.amountTotalUsd != null
        ? Math.max(0, roundMoney(ship.amountTotalUsd - (ship.shippingUsd || 0)))
        : null,
      ship.amountTotalUsd,
      session.id,
      paymentIntent,
      now,
      now,
      customerUserId,
      stripeName,
      stripeName,
      stripeAgreementText(),
      now,
      orderId,
    )
    try {
      await ensureOrderTrackCode(db, String(orderId))
    } catch (err) {
      console.warn(
        '[printx] Could not assign track code',
        orderId,
        err instanceof Error ? err.message : err,
      )
    }
  }

  // Always attempt push once per paid order (webhook may have paid without waitUntil finishing).
  await notifyShopOrderPaidOnce(db, String(orderId), stripeName || stripeEmail || 'Customer')
  return true
}

/** Push new-order alert at most once per order (orders perm + main admin). */
async function notifyShopOrderPaidOnce(
  db: Awaited<ReturnType<typeof getDb>>,
  orderId: string,
  who: string,
): Promise<void> {
  const row = await db.get<{ paid_notified_at: string | null; status: string }>(
    `SELECT paid_notified_at, status FROM orders WHERE id = ?`,
    orderId,
  )
  if (!row || row.status === 'pending_payment' || row.status === 'cancelled') return
  if (row.paid_notified_at) return
  const now = new Date().toISOString()
  await db.run(`UPDATE orders SET paid_notified_at = ? WHERE id = ? AND paid_notified_at IS NULL`, now, orderId)
  const marked = await db.get<{ paid_notified_at: string | null }>(
    `SELECT paid_notified_at FROM orders WHERE id = ?`,
    orderId,
  )
  // Lost the race — another confirm already queued the push.
  if (marked?.paid_notified_at && marked.paid_notified_at !== now) return

  const payload = {
    title: 'New shop order',
    body: `${who} placed a paid order`,
    url: '/orders',
  }
  runInBackground('push-order-paid', async () => {
    await notifyAdminsWithPermission(db, 'orders', payload)
    await notifyMainAdmins(db, payload)
  })
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
  const multicolorOnly =
    body.multicolorOnly !== undefined
      ? Boolean(body.multicolorOnly)
      : Boolean(existing?.multicolorOnly)
  let availableColorIds: string[] = existing?.availableColorIds ?? []
  if (Array.isArray(body.availableColorIds)) {
    availableColorIds = body.availableColorIds.map((x) => String(x)).filter(Boolean).slice(0, 20)
  }
  // Multicolor mode: availableColorIds = solid filaments customers may pick (not the MLT badge).
  availableColorIds = availableColorIds.filter((id) => !isMulticolorColorId(id))
  let mainColorId = String(body.mainColorId ?? existing?.mainColorId ?? '').trim()
  if (!availableColorIds.includes(mainColorId)) mainColorId = availableColorIds[0] || ''
  const multicolorSlotCount = clampMulticolorSlotCount(
    body.multicolorSlotCount !== undefined
      ? body.multicolorSlotCount
      : existing?.multicolorSlotCount,
  )
  if (multicolorOnly && availableColorIds.length < multicolorSlotCount) {
    availableColorIds = solidBuiltinColors().map((c) => c.id)
  }
  const parts = mergeDesignParts(
    body.parts,
    existing?.parts ?? [],
    multicolorSlotCount,
    multicolorOnly,
  )
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
    mainColorId,
    multicolorOnly,
    multicolorSlotCount,
    parts,
    gramsPabloP1s: num('gramsPabloP1s', existing?.gramsPabloP1s ?? null),
    hoursPabloP1s: num('hoursPabloP1s', existing?.hoursPabloP1s ?? null),
    gramsCourtEnder: num('gramsCourtEnder', existing?.gramsCourtEnder ?? null),
    hoursCourtEnder: num('hoursCourtEnder', existing?.hoursCourtEnder ?? null),
    gramsJoshKobra: num('gramsJoshKobra', existing?.gramsJoshKobra ?? null),
    hoursJoshKobra: num('hoursJoshKobra', existing?.hoursJoshKobra ?? null),
  }
}

/** What the customer actually paid for items (excludes shipping), after discounts. */
function orderItemsPaidUsd(order: Record<string, unknown>): number {
  const total = Number(order.total_usd) || 0
  const shipping = Number(order.shipping_usd) || 0
  const subtotal = Number(order.subtotal_usd) || 0
  // Prefer total − shipping (post-discount). If subtotal was already corrected to paid items, use the min
  // so pre-discount catalog subtotals cannot inflate printer pay.
  const fromTotal = Math.max(0, total - shipping)
  if (subtotal > 0) return roundMoney(Math.min(subtotal, fromTotal))
  return roundMoney(fromTotal)
}

async function itemPaidShareUsd(
  database: Awaited<ReturnType<typeof getDb>>,
  item: Record<string, unknown>,
): Promise<number> {
  const orderId = String(item.order_id || '')
  const order = await database.get<Record<string, unknown>>(
    'SELECT total_usd, subtotal_usd, shipping_usd FROM orders WHERE id = ?',
    orderId,
  )
  if (!order) return 0
  const itemsPaid = orderItemsPaidUsd(order)
  if (itemsPaid <= 0) return 0

  const siblings = await database.all<{ line_total_usd: number | string | null }>(
    'SELECT line_total_usd FROM order_items WHERE order_id = ?',
    orderId,
  )
  const lineSum = siblings.reduce((s, r) => s + (Number(r.line_total_usd) || 0), 0)
  const line = Number(item.line_total_usd) || 0
  if (lineSum <= 0) {
    // Equal split if line totals missing
    const n = Math.max(1, siblings.length)
    return roundMoney(itemsPaid / n)
  }
  return roundMoney(itemsPaid * (line / lineSum))
}

/** Fix pre-discount subtotals and shrink ledger payouts above what the customer paid. */
async function repairDiscountCappedPayouts(database: Awaited<ReturnType<typeof getDb>>) {
  await database.run(
    `UPDATE orders
     SET subtotal_usd = CASE
       WHEN COALESCE(total_usd, 0) < COALESCE(subtotal_usd, 0)
       THEN GREATEST(0, COALESCE(total_usd, 0) - COALESCE(shipping_usd, 0))
       ELSE subtotal_usd
     END
     WHERE paid_at IS NOT NULL
       AND COALESCE(total_usd, 0) < COALESCE(subtotal_usd, 0)`,
  )
  const oversized = await database.all<Record<string, unknown>>(
    `SELECT l.id, l.amount_usd, l.order_item_id, oi.order_id, oi.line_total_usd, oi.qty,
            oi.worst_cost_unit_usd
     FROM profit_ledger l
     JOIN order_items oi ON oi.id = l.order_item_id
     WHERE l.entry_type = 'reimburse'`,
  )
  for (const row of oversized) {
    const paidShare = await itemPaidShareUsd(database, {
      order_id: row.order_id,
      line_total_usd: row.line_total_usd,
    })
    const worstPay = roundMoney(
      Math.max(0, (Number(row.worst_cost_unit_usd) || 0) * (Number(row.qty) || 1)),
    )
    const correct = roundMoney(Math.min(worstPay, paidShare))
    const current = roundMoney(Number(row.amount_usd) || 0)
    if (Math.abs(current - correct) < 0.005) continue
    await database.run(
      `UPDATE profit_ledger SET amount_usd = ?, note = ? WHERE id = ?`,
      correct,
      paidShare <= 0
        ? 'No printer pay — customer paid $0 after discounts'
        : 'Manufacturing reimbursement (capped by amount customer paid)',
      String(row.id),
    )
    await database.run(
      `UPDATE order_items SET reimburse_usd = ?, profit_usd = ? WHERE id = ?`,
      correct,
      roundMoney(Math.max(0, paidShare - correct)),
      String(row.order_item_id),
    )
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
  if (item.print_status === 'done' || item.print_status === 'printed') {
    return { ok: false as const, error: 'Already marked printed.' }
  }
  if (item.assigned_admin_user_id !== adminUserId) {
    return { ok: false as const, error: 'Only the claiming admin can mark this printed.' }
  }

  const qty = Number(item.qty) || 1
  const worst = Number(item.worst_cost_unit_usd) || 0
  const paidShare = await itemPaidShareUsd(database, item)
  // Never reimburse more than the customer actually paid for this line (discounts / free orders).
  const reimburse = roundMoney(Math.min(Math.max(0, worst * qty), paidShare))
  const profit = roundMoney(Math.max(0, paidShare - reimburse))
  const now = new Date().toISOString()

  await database.run(
    `UPDATE order_items SET print_status = ?, completed_at = ?, reimburse_usd = ?, profit_usd = ? WHERE id = ?`,
    'printed',
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
    paidShare <= 0
      ? 'No printer pay — customer paid $0 after discounts'
      : 'Manufacturing reimbursement (capped by amount customer paid)',
    now,
  )

  // Roll up order status — printed means all items printed (not shipped/fulfilled yet).
  const orderId = item.order_id as string
  const remaining = await database.get<{ c: number | string }>(
    `SELECT COUNT(*) as c FROM order_items
     WHERE order_id = ? AND print_status NOT IN ('printed', 'done')`,
    orderId,
  )
  const left = Number(remaining?.c ?? 0)
  const order = await database.get<{ status: string; shipped_at: string | null }>(
    'SELECT status, shipped_at FROM orders WHERE id = ?',
    orderId,
  )
  // Don't overwrite shipped/arrived/fulfilled.
  if (
    order &&
    !['shipped', 'arrived', 'fulfilled', 'refunded', 'cancelled'].includes(String(order.status))
  ) {
    await database.run(
      `UPDATE orders SET status = ?, updated_at = ? WHERE id = ?`,
      left === 0 ? 'printed' : 'in_production',
      now,
      orderId,
    )
  }

  return { ok: true as const }
}

/** Light IP throttle for public track lookups (in-memory). */
const trackThrottle = new Map<string, { count: number; resetAt: number }>()

function trackClientIp(req: IncomingMessage): string {
  const xf = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    ?.trim()
  return xf || req.socket.remoteAddress || 'unknown'
}

function allowTrackLookup(ip: string): boolean {
  const now = Date.now()
  const windowMs = 60_000
  const max = 30
  if (trackThrottle.size > 500) {
    for (const [k, v] of trackThrottle) {
      if (now >= v.resetAt) trackThrottle.delete(k)
    }
    if (trackThrottle.size > 500) trackThrottle.clear()
  }
  const cur = trackThrottle.get(ip)
  if (!cur || now >= cur.resetAt) {
    trackThrottle.set(ip, { count: 1, resetAt: now + windowMs })
    return true
  }
  if (cur.count >= max) return false
  cur.count += 1
  return true
}

const SHOP_ORDER_LIST_STATUSES = [
  'awaiting_cash',
  'paid',
  'in_production',
  'printed',
  'shipped',
  'arrived',
  'ready',
  'fulfilled',
  'refunded',
] as const

const SHOP_ORDER_MONEY_STATUSES = [
  'paid',
  'in_production',
  'printed',
  'shipped',
  'arrived',
  'ready',
  'fulfilled',
] as const

const SHOP_ORDER_MONEY_STATUS_SQL = SHOP_ORDER_MONEY_STATUSES.map((s) => `'${s}'`).join(', ')

export async function resumeArrivedOrderChecks(): Promise<void> {
  try {
    const db = await getDb()
    const n = await advanceArrivedOrders(db)
    if (n > 0) console.log(`[printx] Advanced ${n} shipped order(s) to arrived/fulfilled`)
  } catch (err) {
    console.warn('[printx] Arrived-order advance failed', err instanceof Error ? err.message : err)
  }
}

export async function handleCatalogApi(
  req: IncomingMessage,
  res: ServerResponse,
  urlPath: string,
  method: string,
): Promise<boolean> {
  const db = await getDb()
  await seedCatalogDefaults(db)

  // ----- Public order success (one-time track code reveal) -----
  if (urlPath === '/api/public/order-success' && method === 'GET') {
    const u = new URL(req.url || '', 'http://localhost')
    const sessionId = String(u.searchParams.get('session_id') || '').trim()
    if (!sessionId || sessionId.length > 200) {
      send(res, 400, { error: 'session_id is required.' })
      return true
    }
    let row = await db.get<Record<string, unknown>>(
      `SELECT * FROM orders WHERE stripe_session_id = ? LIMIT 1`,
      sessionId,
    )
    if (!row) {
      send(res, 404, { error: 'Order not found for this checkout session.' })
      return true
    }
    let status = String(row.status || '')
    // Webhook can lag (or miss after host moves). Confirm from Stripe on the success page.
    if (status === 'pending_payment') {
      const stripe = stripeClient()
      if (stripe) {
        try {
          const confirmed = await confirmShopOrderFromCheckoutSession(db, stripe, sessionId)
          if (confirmed) {
            row = (await db.get<Record<string, unknown>>(
              `SELECT * FROM orders WHERE stripe_session_id = ? LIMIT 1`,
              sessionId,
            ))!
            status = String(row?.status || '')
          }
        } catch (err) {
          console.warn(
            '[printx] order-success Stripe confirm failed',
            sessionId,
            err instanceof Error ? err.message : err,
          )
        }
      }
    }
    if (status === 'pending_payment') {
      send(res, 404, { error: 'Payment not confirmed yet. Refresh in a moment.' })
      return true
    }
    try {
      await ensureOrderTrackCode(db, String(row.id))
    } catch (err) {
      console.warn('[printx] order-success track code', err instanceof Error ? err.message : err)
    }
    await advanceArrivedOrders(db)
    row = (await db.get<Record<string, unknown>>('SELECT * FROM orders WHERE id = ?', row.id))!
    const order = rowToOrder(row)
    const items = await db.all<Record<string, unknown>>(
      `SELECT oi.*, d.name as design_name FROM order_items oi
       JOIN designs d ON d.id = oi.design_id WHERE oi.order_id = ? ORDER BY oi.sku ASC`,
      order.id,
    )
    const alreadyShown = Boolean(order.trackCodeShownAt)
    let trackCode: string | null = null
    if (!alreadyShown && /^\d{6}$/.test(order.trackCode)) {
      trackCode = order.trackCode
      const now = new Date().toISOString()
      await db.run(
        `UPDATE orders SET track_code_shown_at = ?, updated_at = ? WHERE id = ? AND track_code_shown_at IS NULL`,
        now,
        now,
        order.id,
      )
    }
    send(res, 200, {
      orderId: order.id,
      status: order.status,
      statusLabel: publicOrderStatusLabel(order.status),
      totalUsd: order.totalUsd,
      shippingMethod: order.shippingMethod,
      trackCode,
      trackCodeAlreadyShown: alreadyShown || trackCode == null,
      items: items.map((it) => {
        const mapped = rowToOrderItem(it)
        return {
          designName: String(it.design_name || mapped.sku),
          colorName: mapped.colorName,
          qty: mapped.qty,
          printStatus: mapped.printStatus,
          printStatusLabel: publicPrintStatusLabel(mapped.printStatus),
        }
      }),
    })
    return true
  }

  // ----- Public track-by-code -----
  if (urlPath === '/api/public/track' && method === 'POST') {
    if (!allowTrackLookup(trackClientIp(req))) {
      send(res, 429, { error: 'Too many attempts. Try again in a minute.' })
      return true
    }
    const body = await readJson(req)
    const code = normalizeTrackCode(body.code)
    if (!code) {
      send(res, 400, { error: 'Enter a valid 6-digit track code.' })
      return true
    }
    await advanceArrivedOrders(db)
    const row = await db.get<Record<string, unknown>>(
      `SELECT * FROM orders WHERE track_code = ? LIMIT 1`,
      code,
    )
    if (!row) {
      send(res, 404, { error: 'No order found for that code.' })
      return true
    }
    const order = rowToOrder(row)
    const items = await db.all<Record<string, unknown>>(
      `SELECT oi.*, d.name as design_name FROM order_items oi
       JOIN designs d ON d.id = oi.design_id WHERE oi.order_id = ? ORDER BY oi.sku ASC`,
      order.id,
    )
    const eta = arrivedEtaIso(order.shippedAt, order.shippingMethod)
    send(res, 200, {
      status: order.status,
      statusLabel: publicOrderStatusLabel(order.status),
      shippingMethod: order.shippingMethod,
      trackingNumber: order.trackingNumber,
      trackingCarrier: order.trackingCarrier,
      trackingUrl: order.trackingUrl,
      shippedAt: order.shippedAt,
      arrivedEta: eta,
      items: items.map((it) => {
        const mapped = rowToOrderItem(it)
        return {
          designName: String(it.design_name || mapped.sku),
          colorName: mapped.colorName,
          qty: mapped.qty,
          printStatus: mapped.printStatus,
          printStatusLabel: publicPrintStatusLabel(mapped.printStatus),
        }
      }),
    })
    return true
  }

  // ----- Public catalog -----
  if (urlPath === '/api/public/catalog' && method === 'GET') {
    const settings = await getPricingSettings(db)
    const stockIds = await filamentStock(db)
    const rows = await db.all<Record<string, unknown>>(
      `SELECT * FROM designs WHERE status = 'approved'`,
    )
    const buyers = await designBuyerCounts(db)
    const designs = rows
      .map(rowToDesign)
      .map((d) => ({ ...d, buyerCount: buyers.get(d.id) || 0 }))
      .sort(compareByPopularity)
      .map((d) => {
      const modelExt = path.extname(d.stlPath || '').toLowerCase()
      const parts = d.multicolorOnly
        ? d.parts.map((p, index) => {
            const partExt = path.extname(p.stlPath || '').toLowerCase()
            return {
              label: p.label || defaultMulticolorPartLabel(index),
              modelUrl:
                p.stlPath.trim() && partExt === '.stl'
                  ? `/api/public/catalog/${d.id}/parts/${index}/stl`
                  : '',
            }
          })
        : []
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
        sizeXMm: d.sizeXMm,
        sizeYMm: d.sizeYMm,
        sizeZMm: d.sizeZMm,
        popular: d.popular,
        buyerCount: d.buyerCount || 0,
        multicolorOnly: d.multicolorOnly,
        multicolorSlotCount: d.multicolorSlotCount,
        parts,
        availableColors: (() => {
          // Legacy rows stored only `multicolor` — fall back to every solid filament.
          const solidIds = d.availableColorIds.filter((id) => !isMulticolorColorId(id))
          const ids =
            d.multicolorOnly && solidIds.length < d.multicolorSlotCount
              ? [
                  ...solidBuiltinColors().map((c) => c.id),
                  ...settings.customColors.filter((c) => c.name.trim()).map((c) => c.id),
                ]
              : solidIds.length
                ? solidIds
                : d.availableColorIds
          const offered = ids.filter((id) => isOfferedFilament(id, stockIds))
          const main = d.mainColorId
          const ordered =
            main && offered.includes(main)
              ? [main, ...offered.filter((id) => id !== main)]
              : offered
          return ordered
            .map((id) => colorById(id, settings.customColors))
            .filter(Boolean)
        })(),
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

  const publicPartStlMatch = /^\/api\/public\/catalog\/([^/]+)\/parts\/(\d+)\/stl$/.exec(urlPath)
  if (publicPartStlMatch && method === 'GET') {
    const designId = publicPartStlMatch[1]!
    const partIndex = Number(publicPartStlMatch[2])
    const row = await db.get<Record<string, unknown>>(
      `SELECT * FROM designs WHERE id = ?`,
      designId,
    )
    if (!row || String(row.status) !== 'approved') {
      send(res, 404, { error: 'Model not found' })
      return true
    }
    const design = rowToDesign(row)
    const part = design.parts[partIndex]
    const stlPath = part?.stlPath?.trim() ?? ''
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
      send(res, 404, { error: 'Model not found' })
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
    // Signed-in optional — guests can pay; Stripe collects email + shipping.
    const account = await requireCustomer(req)
    const body = await readJson(req)
    const customerName = account?.displayName || sanitizeText(String(body.customerName ?? ''), 120)
    const customerEmail = account?.email || sanitizeEmail(String(body.customerEmail ?? ''))
    const itemsIn = Array.isArray(body.items) ? body.items : []
    if (itemsIn.length === 0) {
      send(res, 400, { error: 'At least one item is required.' })
      return true
    }
    const settings = await getPricingSettings(db)
    const stockIds = await filamentStock(db)
    const lineItems: {
      design: Design
      colorId: string
      colorName: string
      filamentColorIds: string[]
      sku: string
      qty: number
      unit: number
      worst: number
    }[] = []

    for (const raw of itemsIn.slice(0, 20)) {
      if (!raw || typeof raw !== 'object') continue
      const row = raw as Record<string, unknown>
      const designId = String(row.designId ?? '')
      let colorId = String(row.colorId ?? '')
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
      if (design.catalogPriceUsd == null) {
        send(res, 400, { error: `${design.name} is not priced yet.` })
        return true
      }

      let filamentColorIds: string[] = []
      let colorName = ''
      let colorCode = ''

      if (design.multicolorOnly) {
        colorId = MULTICOLOR_COLOR_ID
        const rawFilaments = Array.isArray(row.filamentColorIds) ? row.filamentColorIds : []
        filamentColorIds = rawFilaments.map((x) => String(x)).filter(Boolean)
        const slotCount = design.multicolorSlotCount
        if (filamentColorIds.length !== slotCount) {
          send(res, 400, {
            error: `${design.name} needs ${slotCount} filament colors selected.`,
          })
          return true
        }
        const allowedSolids = design.availableColorIds.filter((id) => !isMulticolorColorId(id))
        const pool =
          allowedSolids.length >= slotCount
            ? allowedSolids
            : [
                ...solidBuiltinColors().map((c) => c.id),
                ...settings.customColors.filter((c) => c.name.trim()).map((c) => c.id),
              ]
        const names: string[] = []
        for (const fid of filamentColorIds) {
          if (!pool.includes(fid) || !isOfferedFilament(fid, stockIds)) {
            send(res, 400, { error: `Invalid filament color for ${design.name}.` })
            return true
          }
          const fc = colorById(fid, settings.customColors)
          if (!fc || isMulticolorColorId(fc.id)) {
            send(res, 400, { error: `Invalid filament color for ${design.name}.` })
            return true
          }
          names.push(fc.name)
        }
        const slotLabels = design.parts.map((p) => p.label)
        colorName = formatMulticolorSelection(
          names,
          slotLabels.length === names.length ? slotLabels : undefined,
        )
        colorCode = MULTICOLOR_COLOR.code
      } else {
        if (!design.availableColorIds.includes(colorId) || !isOfferedFilament(colorId, stockIds)) {
          send(res, 400, { error: `Color unavailable for ${design.name}.` })
          return true
        }
        const color = colorById(colorId, settings.customColors)
        if (!color || isMulticolorColorId(color.id)) {
          send(res, 400, { error: 'Invalid color.' })
          return true
        }
        colorName = color.name
        colorCode = color.code
      }

      lineItems.push({
        design,
        colorId,
        colorName,
        filamentColorIds,
        sku: buildSku(design.skuBase, colorCode),
        qty,
        unit: design.catalogPriceUsd,
        worst: design.worstCostUsd ?? 0,
      })
    }
    if (lineItems.length === 0) {
      send(res, 400, { error: 'Cart is empty.' })
      return true
    }

    const promoCode = sanitizeText(String(body.promoCode ?? ''), 40)
      .toUpperCase()
      .replace(/\s+/g, '')
    let appliedPromo: {
      stripePromotionCodeId: string
      kind: string
      code: string
    } | null = null
    if (promoCode) {
      const promoRow = await db.get<{
        stripe_promotion_code_id: string
        kind: string
        code: string
        active: number | string
      }>(
        `SELECT stripe_promotion_code_id, kind, code, active FROM discounts
         WHERE UPPER(REPLACE(code, ' ', '')) = ? LIMIT 1`,
        promoCode,
      )
      if (String(promoRow?.kind || '') === 'school_pickup') {
        send(res, 400, {
          error: 'That code is only for school pickup cash sales. It does not apply at Checkout.',
        })
        return true
      }
      if (!promoRow || !Number(promoRow.active) || !promoRow.stripe_promotion_code_id) {
        send(res, 400, { error: 'That promo code is invalid or inactive.' })
        return true
      }
      appliedPromo = {
        stripePromotionCodeId: String(promoRow.stripe_promotion_code_id),
        kind: String(promoRow.kind || 'percent'),
        code: String(promoRow.code || promoCode),
      }
    }
    const freeStandardShipping =
      appliedPromo?.kind === 'free_shipping' ||
      appliedPromo?.kind === 'percent_and_shipping' ||
      appliedPromo?.kind === 'amount_and_shipping'
    // free_shipping is handled only via $0 Standard shipping — do not also apply a Stripe coupon.
    const stripePromoId =
      appliedPromo && appliedPromo.kind !== 'free_shipping'
        ? appliedPromo.stripePromotionCodeId
        : ''

    if (stripePromoId) {
      try {
        const pc = await stripe.promotionCodes.retrieve(stripePromoId)
        if (!pc.active) {
          send(res, 400, {
            error: `Promo code ${appliedPromo!.code} is no longer active. Remove it or try another code.`,
          })
          return true
        }
        const max = pc.max_redemptions
        const used = pc.times_redeemed ?? 0
        if (max != null && used >= max) {
          send(res, 400, {
            error: `Promo code ${appliedPromo!.code} has already been fully redeemed. Remove it or try another code.`,
          })
          return true
        }
      } catch (err) {
        console.warn('[checkout] promotion code check failed:', err instanceof Error ? err.message : err)
        send(res, 400, {
          error: `Promo code ${appliedPromo!.code} could not be verified with Stripe. Remove it or try another code.`,
        })
        return true
      }
    }

    const subtotal = roundMoney(lineItems.reduce((s, i) => s + i.unit * i.qty, 0))
    const now = new Date().toISOString()
    const orderId = randomUUID()
    await db.run(
      `INSERT INTO orders (
        id, customer_name, customer_email, status, stripe_session_id, stripe_payment_intent,
        subtotal_usd, total_usd, currency, created_at, updated_at, paid_at, user_id,
        payment_method, agreement_name, agreement_text,
        agreement_payment_checked, agreement_terms_checked, agreement_at
      ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, 'usd', ?, ?, NULL, ?, 'stripe', ?, ?, 0, 0, NULL)`,
      orderId,
      customerName || 'Customer',
      customerEmail || '',
      'pending_payment',
      subtotal,
      subtotal,
      now,
      now,
      account?.id ?? null,
      customerName || '',
      stripeAgreementText(),
    )
    for (const item of lineItems) {
      await db.run(
        `INSERT INTO order_items (
          id, order_id, design_id, sku, color_id, color_name, filament_color_ids, qty,
          unit_price_usd, worst_cost_unit_usd, line_total_usd, print_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unclaimed')`,
        randomUUID(),
        orderId,
        item.design.id,
        item.sku,
        item.colorId,
        item.colorName,
        JSON.stringify(item.filamentColorIds),
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

    let session: Stripe.Checkout.Session
    try {
      const stripeCustomerId = account ? await ensureStripeCustomer(stripe, account) : null
      session = await stripe.checkout.sessions.create({
        mode: 'payment',
        ...(stripeCustomerId
          ? {
              customer: stripeCustomerId,
              ...stripeAccountSavedPaymentFields(),
            }
          : {
              // Guest: Stripe collects email; create a Customer when needed for the payment.
              customer_creation: 'if_required',
              ...(customerEmail ? { customer_email: customerEmail } : {}),
            }),
        // Promo codes only from the cart (before Checkout) — never the Stripe Checkout field.
        ...(stripePromoId ? { discounts: [{ promotion_code: stripePromoId }] } : {}),
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: orderId,
        metadata: {
          orderId,
          ...(account ? { customerUserId: account.id } : { guest: '1' }),
          ...(appliedPromo ? { promoCode: appliedPromo.code, promoKind: appliedPromo.kind } : {}),
        },
        ...stripeCheckoutShippingFields({
          freeStandard: freeStandardShipping,
          guest: !account,
        }),
        ...stripeTermsConsentFields(`${origin}/terms-and-conditions`),
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
    } catch (err) {
      const stripeMsg =
        err && typeof err === 'object' && 'raw' in err
          ? String((err as { raw?: { message?: string } }).raw?.message || '')
          : ''
      const msg = stripeMsg || (err instanceof Error ? err.message : 'Checkout failed')
      console.error('[checkout] Stripe session create failed:', msg)
      try {
        await db.run(
          `UPDATE orders SET status = 'cancelled', updated_at = ? WHERE id = ? AND status = 'pending_payment'`,
          new Date().toISOString(),
          orderId,
        )
      } catch {
        /* ignore cleanup */
      }
      send(res, 400, {
        error: appliedPromo
          ? `Could not apply promo ${appliedPromo.code}: ${msg}`
          : `Checkout failed: ${msg}`,
      })
      return true
    }

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
      // Use exact UTF-8 bytes Stripe signed (Workers Buffer → string).
      event = stripe.webhooks.constructEvent(raw.toString('utf8'), sig, secret.trim())
    } catch (err) {
      console.warn('[stripe-webhook] signature', err instanceof Error ? err.message : err)
      send(res, 400, { error: err instanceof Error ? err.message : 'Invalid signature' })
      return true
    }
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session
      const customRequestId = session.metadata?.customRequestId?.trim()
      if (customRequestId) {
        const now = new Date().toISOString()
        let ship = parseCheckoutShipping(session)
        let fullSession = session
        if (session.id) {
          try {
            const loaded = await loadCheckoutShipping(stripe, session.id)
            fullSession = loaded.session
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
          fullSession,
          ship.shippingMethod,
        )
        const stripeEmail = ship.customerEmail
        const stripeName = ship.customerName
        const customerUserId = fullSession.metadata?.customerUserId?.trim() || ''
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
            updated_at = ?,
            user_id = COALESCE(user_id, NULLIF(?, '')),
            agreement_terms_checked = 1,
            agreement_at = COALESCE(agreement_at, ?)
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
          fullSession.id,
          now,
          now,
          customerUserId,
          now,
          customRequestId,
        )
        runInBackground('push-custom-paid', () =>
          notifyAdminsWithPermission(db, 'requests', {
            title: 'Custom print paid',
            body: `${stripeName || stripeEmail || 'Customer'} paid for a custom print`,
            url: '/requests',
          }),
        )
      } else if (session.id) {
        await confirmShopOrderFromCheckoutSession(db, stripe, session.id)
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
      `SELECT * FROM designs WHERE status != 'archived' ORDER BY updated_at DESC`,
    )
    const buyers = await designBuyerCounts(db)
    send(
      res,
      200,
      rows.map((row) => {
        const design = rowToDesign(row)
        design.buyerCount = buyers.get(design.id) || 0
        return designDto(design)
      }),
    )
    return true
  }

  const designGcodePrepareMatch = /^\/api\/admin\/designs\/([^/]+)\/gcode\/prepare$/.exec(urlPath)
  if (designGcodePrepareMatch && method === 'POST') {
    const designId = designGcodePrepareMatch[1]!
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'products')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    const body = await readJson(req)
    const printerId = String(body.printerId || 'pablo_p1s').trim()
    if (!PRINTER_FIELD[printerId]) {
      send(res, 400, { error: 'Choose a valid printer.' })
      return true
    }
    try {
      const result = await startDesignGcodePrepare(db, designId, printerId)
      send(res, 200, result)
    } catch (err) {
      send(res, 400, { error: err instanceof Error ? err.message : 'Prepare failed' })
    }
    return true
  }

  const designGcodeStatusMatch = /^\/api\/admin\/designs\/([^/]+)\/gcode\/status$/.exec(urlPath)
  if (designGcodeStatusMatch && method === 'GET') {
    const designId = designGcodeStatusMatch[1]!
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'products')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    const printerId = String(new URL(req.url || '', 'http://local').searchParams.get('printerId') || 'pablo_p1s')
    const designRow = await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId)
    if (!designRow) {
      send(res, 404, { error: 'Design not found' })
      return true
    }
    const design = rowToDesign(designRow)
    const targets = designGcodeSliceTargets(design)
    const gcodePaths = parseDesignIdMap(designRow.gcode_paths_json)
    if (printerHasStoredGcodes(gcodePaths, printerId, targets.length)) {
      const storedNames = targets.map((t) => gcodePaths[t.storageKey(printerId)]!).filter(Boolean)
      send(res, 200, {
        status: 'ready' as const,
        storedName: storedNames[0] || '',
        partCount: targets.length,
        storedNames,
      })
      return true
    }
    send(res, 200, { status: 'idle' as const, partCount: Math.max(1, targets.length) })
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
      const uploaded = await parseModelUpload(req)
      const bounds = await rememberStlFile(db, uploaded.fileName)
      const size = bounds ? boundsSizeMm(bounds) : null
      send(res, 201, {
        stlPath: uploaded.fileName,
        hasStl: true,
        modelExt: uploaded.modelExt,
        sourceGcodePath: uploaded.sourceGcodePath ?? '',
        grams: uploaded.grams ?? null,
        hours: uploaded.hours ?? null,
        fromGcode: Boolean(uploaded.fromGcode),
        sizeXMm: size?.xMm ?? null,
        sizeYMm: size?.yMm ?? null,
        sizeZMm: size?.zMm ?? null,
      })
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
    if (parsed.multicolorOnly) {
      if (parsed.parts.length < parsed.multicolorSlotCount) {
        send(res, 400, { error: 'Upload an STL for every multicolor part before saving.' })
        return true
      }
      const missingPart = parsed.parts.findIndex((p) => !p.stlPath.trim())
      if (missingPart >= 0) {
        send(res, 400, {
          error: `Upload an STL for part ${missingPart + 1} (${parsed.parts[missingPart]?.label || 'Part'}) before saving.`,
        })
        return true
      }
      if (parsed.availableColorIds.length < parsed.multicolorSlotCount) {
        send(res, 400, {
          error: `Pick at least ${parsed.multicolorSlotCount} solid filament options for customers.`,
        })
        return true
      }
    }
    // Multicolor designs use part STLs only; quoting uses the first part as stl_path.
    const stlPath =
      safeStlPath(body.stlPath) ||
      (parsed.multicolorOnly ? safeStlPath(parsed.parts[0]?.stlPath) : '')
    if (!stlPath) {
      send(
        res,
        400,
        {
          error: parsed.multicolorOnly
            ? 'Upload an STL for every color part before saving.'
            : 'Upload a 3D model before saving the design.',
        },
      )
      return true
    }
    const now = new Date().toISOString()
    const id = randomUUID()
    const sourceGcode = safeGcodePath(body.sourceGcodePath)
    try {
      await db.run(
        `INSERT INTO designs (
          id, sku_base, name, description, category, image_url, stl_path, slice_status, slice_error,
          status, created_by,
          submitted_at, reviewed_by, reviewed_at, review_note,
          grams_pablo_p1s, hours_pablo_p1s, grams_court_ender, hours_court_ender,
          grams_josh_kobra, hours_josh_kobra, available_color_ids, main_color_id, multicolor_only, multicolor_slot_count,
          parts_json,
          worst_cost_usd, catalog_price_usd, priced_at, pricing_inputs_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'idle', '', 'draft', ?, NULL, NULL, NULL, '', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, '{}', ?, ?)`,
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
        parsed.mainColorId,
        parsed.multicolorOnly ? 1 : 0,
        parsed.multicolorSlotCount,
        JSON.stringify(parsed.parts),
        now,
        now,
      )
      if (sourceGcode) await persistUploadedGcodeQuote(db, id, sourceGcode)
      await refreshDesignSize(db, id, stlPath, parsed.parts, parsed.multicolorOnly)
    } catch (err) {
      send(res, 400, {
        error: err instanceof Error ? err.message : 'Could not create design (SKU may already exist).',
      })
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

  const designPartStlMatch = /^\/api\/admin\/designs\/([^/]+)\/parts\/(\d+)\/stl$/.exec(urlPath)
  if (designPartStlMatch && method === 'GET') {
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'products')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    const designId = designPartStlMatch[1]!
    const partIndex = Number(designPartStlMatch[2])
    const row = await db.get<Record<string, unknown>>(
      'SELECT * FROM designs WHERE id = ?',
      designId,
    )
    if (!row) {
      send(res, 404, { error: 'Model not found' })
      return true
    }
    const design = rowToDesign(row)
    const stlPath = design.parts[partIndex]?.stlPath?.trim() ?? ''
    if (!stlPath || stlPath.includes('..') || stlPath.includes('/') || stlPath.includes('\\')) {
      send(res, 404, { error: 'Model not found' })
      return true
    }
    const ext = path.extname(stlPath).toLowerCase()
    if (ext !== '.stl') {
      send(res, 404, { error: 'Part preview is STL-only.' })
      return true
    }
    const ok = await sendStlWithDevFallback(
      res,
      designId,
      stlPath,
      modelContentType(ext),
      'private, max-age=60',
    )
    if (!ok) {
      send(res, 404, { error: 'Model not found' })
      return true
    }
    return true
  }

  const designMatch =
    /^\/api\/admin\/designs\/([^/]+)(?:\/(submit|requote|approve|reject|reprice|quote-tick|popular))?$/.exec(urlPath)
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

    if (method === 'POST' && action === 'popular') {
      const body = await readJson(req)
      const next = body.popular === undefined ? !design.popular : Boolean(body.popular)
      await db.run(
        `UPDATE designs SET popular = ?, updated_at = ? WHERE id = ?`,
        next ? 1 : 0,
        new Date().toISOString(),
        designId,
      )
      const row = await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId)
      const buyers = await designBuyerCounts(db)
      const updated = rowToDesign(row!)
      updated.buyerCount = buyers.get(designId) || 0
      send(res, 200, designDto(updated))
      return true
    }

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
      if (parsed.multicolorOnly) {
        if (parsed.parts.length < parsed.multicolorSlotCount) {
          send(res, 400, { error: 'Upload an STL for every multicolor part before saving.' })
          return true
        }
        const missingPart = parsed.parts.findIndex((p) => !p.stlPath.trim())
        if (missingPart >= 0) {
          send(res, 400, {
            error: `Upload an STL for part ${missingPart + 1} (${parsed.parts[missingPart]?.label || 'Part'}) before saving.`,
          })
          return true
        }
        if (parsed.availableColorIds.length < parsed.multicolorSlotCount) {
          send(res, 400, {
            error: `Pick at least ${parsed.multicolorSlotCount} solid filament options for customers.`,
          })
          return true
        }
      }
      // Ignore empty stlPath so a stale client field cannot wipe an existing model.
      const incomingStl = body.stlPath !== undefined ? safeStlPath(body.stlPath) : ''
      const sourceGcode = safeGcodePath(body.sourceGcodePath)
      const stlPath =
        incomingStl ||
        design.stlPath ||
        (parsed.multicolorOnly ? safeStlPath(parsed.parts[0]?.stlPath) : '')
      if (!stlPath) {
        send(res, 400, {
          error: parsed.multicolorOnly
            ? 'Upload an STL for every color part before saving.'
            : 'Upload a 3D model before saving the design.',
        })
        return true
      }
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
            grams_josh_kobra = ?, hours_josh_kobra = ?, available_color_ids = ?, main_color_id = ?, multicolor_only = ?,
            multicolor_slot_count = ?,
            parts_json = ?,
            quote_ids_json = CASE WHEN ? THEN '{}' ELSE quote_ids_json END,
            file_ids_json = CASE WHEN ? THEN '{}' ELSE file_ids_json END,
            gcode_paths_json = CASE WHEN ? THEN '{}' ELSE gcode_paths_json END,
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
          parsed.mainColorId,
          parsed.multicolorOnly ? 1 : 0,
          parsed.multicolorSlotCount,
          JSON.stringify(parsed.parts),
          stlChanged ? 1 : 0,
          stlChanged ? 1 : 0,
          stlChanged && !sourceGcode ? 1 : 0,
          now,
          designId,
        )
      if (sourceGcode) await persistUploadedGcodeQuote(db, designId, sourceGcode)
      await refreshDesignSize(db, designId, stlPath, parsed.parts, parsed.multicolorOnly)
      } catch (err) {
        send(res, 400, {
          error: err instanceof Error ? err.message : 'Update failed (SKU conflict?).',
        })
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
      const linked = await db.get<{ c: number }>(
        `SELECT COUNT(*) as c FROM order_items WHERE design_id = ?`,
        designId,
      )
      const mustArchive = (linked?.c ?? 0) > 0
      const now = new Date().toISOString()
      if (mustArchive) {
        await db.run(
          `UPDATE designs SET status = 'archived', updated_at = ? WHERE id = ?`,
          now,
          designId,
        )
        invalidateBootstrapCache()
        send(res, 200, { ok: true, archived: true })
        return true
      }
      try {
        await db.run(`DELETE FROM designs WHERE id = ?`, designId)
        invalidateBootstrapCache()
        send(res, 200, { ok: true, archived: false })
      } catch {
        await db.run(
          `UPDATE designs SET status = 'archived', updated_at = ? WHERE id = ?`,
          now,
          designId,
        )
        invalidateBootstrapCache()
        send(res, 200, { ok: true, archived: true })
      }
      return true
    }

    if (method === 'POST' && action === 'quote-tick') {
      if (!admin.isMainAdmin) {
        send(res, 403, { error: 'Only the main admin can quote designs.' })
        return true
      }
      if (!design.stlPath) {
        send(res, 400, { error: 'Upload a 3D model before quoting.' })
        return true
      }
      try {
        const next = await dispatchDesignQuote(db, designId)
        send(res, 200, designDto(next))
      } catch (err) {
        send(res, 400, { error: err instanceof Error ? err.message : 'Quoting failed' })
      }
      return true
    }

    if (method === 'POST' && action === 'submit') {
      if (!design.hasStl || !design.stlPath) {
        send(res, 400, { error: 'Upload a 3D model before submitting.' })
        return true
      }
      await applyAdminOwnedColors(db, designId, admin.id)
      design = rowToDesign(
        (await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId))!,
      )
      if (design.availableColorIds.length === 0) {
        send(res, 400, { error: 'Pick at least one color before submitting.' })
        return true
      }

      const modelExt = path.extname(design.stlPath).toLowerCase()
      const now = new Date().toISOString()
      const fromGcode = Boolean(designUploadedGcode(design)) && design.gramsPabloP1s != null
      // Already on the shop with a price: submitting again must not pull it off the catalog.
      const stayLive = design.status === 'approved' && design.catalogPriceUsd != null

      // Main admin only: skip Approvals queue — accept + start quoting immediately.
      if (admin.isMainAdmin) {
        if (fromGcode) {
          await db.run(
            `UPDATE designs SET
              status = ?, submitted_at = ?, reviewed_by = ?, reviewed_at = ?,
              review_note = ?, slice_status = 'ready', slice_error = '', updated_at = ?
             WHERE id = ?`,
            stayLive ? 'approved' : 'pending_review',
            now,
            admin.id,
            now,
            'Accepted by main admin',
            now,
            designId,
          )
          design = rowToDesign(
            (await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId))!,
          )
          send(res, 200, {
            ...designDto(design),
            sliceWarning:
              'Quoted from the uploaded G-code. Set the shop price on Approvals. The 3D preview is the printed toolpath.',
          })
          return true
        }
        if (!SLICEABLE_EXTS.has(modelExt)) {
          send(res, 400, {
            error: 'Upload an .stl or .gcode file before publishing.',
          })
          return true
        }
        if (!stayLive || design.sliceStatus !== 'ready') {
          await db.run(
            `UPDATE designs SET
              status = ?, submitted_at = ?, reviewed_by = ?, reviewed_at = ?,
              review_note = ?, slice_status = 'slicing', slice_error = '', updated_at = ?
             WHERE id = ?`,
            stayLive ? 'approved' : 'pending_review',
            now,
            admin.id,
            now,
            'Accepted by main admin — quoting',
            now,
            designId,
          )
          scheduleDesignSlice(designId, design.stlPath)
        }
        design = rowToDesign(
          (await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId))!,
        )
        send(res, 200, {
          ...designDto(design),
          sliceWarning:
            'Published without Approvals. Quoting via Cloud Slicer — refresh, then set price on Approvals when grams/hours appear.',
        })
        return true
      }

      // Regular admins: queue for main-admin review — quoting starts after Approve.
      let sliceWarning = fromGcode
        ? 'Submitted for review. Filament and time come from the uploaded G-code, so it will not be sliced.'
        : 'Submitted for main admin review. Cloud Slicer quoting starts after they Approve.'
      if (!fromGcode && !SLICEABLE_EXTS.has(modelExt)) {
        sliceWarning = 'Submitted for review. Upload an .stl or .gcode file so quoting can run.'
      }
      await db.run(
        `UPDATE designs SET
          status = ?, submitted_at = ?, updated_at = ?, review_note = '',
          slice_status = ?, slice_error = ''
         WHERE id = ?`,
        stayLive ? 'approved' : 'pending_review',
        now,
        now,
        stayLive ? design.sliceStatus : fromGcode ? 'ready' : 'idle',
        designId,
      )

      design = rowToDesign(
        (await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId))!,
      )
      if (!stayLive) {
        const who = admin.displayName || admin.email || 'An admin'
        runInBackground('push-design-submit', () =>
          notifyMainAdmins(db, {
            title: 'Design needs approval',
            body: `${who} submitted “${design.name}”`,
            url: '/approvals',
          }),
        )
      }
      send(res, 200, { ...designDto(design), sliceWarning })
      return true
    }

    if (method === 'POST' && action === 'requote') {
      if (!admin.isMainAdmin) {
        send(res, 403, { error: 'Only the main admin can start quoting.' })
        return true
      }
      if (!design.hasStl || !design.stlPath) {
        send(res, 400, { error: 'Upload a 3D model before quoting.' })
        return true
      }
      const modelExt = path.extname(design.stlPath).toLowerCase()
      if (designUploadedGcode(design)) {
        send(res, 200, {
          ...designDto(design),
          sliceWarning: 'This design was quoted from uploaded G-code and is not sliced again.',
        })
        return true
      }
      if (!SLICEABLE_EXTS.has(modelExt)) {
        send(res, 400, {
          error: 'Auto-quote needs an .stl file.',
        })
        return true
      }
      // Quoting only after the main admin has accepted the design (or it is already approved).
      const acceptedForQuote =
        design.status === 'approved' ||
        Boolean(design.reviewedAt) ||
        design.sliceStatus === 'slicing' ||
        design.sliceStatus === 'ready' ||
        design.sliceStatus === 'error'
      if (design.status === 'pending_review' && !acceptedForQuote) {
        send(res, 400, {
          error: 'Approve the design first — quoting starts after main admin approval.',
        })
        return true
      }
      // Do not await slicing here — CS quotes can take minutes and freeze Approvals.
      await db.run(
        `UPDATE designs SET slice_status = 'slicing', slice_error = '', updated_at = ? WHERE id = ?`,
        new Date().toISOString(),
        designId,
      )
      scheduleDesignSlice(designId, design.stlPath)
      design = rowToDesign(
        (await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId))!,
      )
      send(res, 200, {
        ...designDto(design),
        sliceWarning: 'Quoting in the background — refresh this page in a minute.',
      })
      return true
    }

    if (method === 'POST' && (action === 'approve' || action === 'reprice')) {
      if (!admin.isMainAdmin) {
        send(res, 403, { error: 'Only the main admin can approve designs.' })
        return true
      }

      // First approve on a pending design: accept the model and start quoting (no shop price yet).
      if (action === 'approve' && design.status === 'pending_review' && !designHasPricableInputs(design)) {
        if (!design.hasStl || !design.stlPath) {
          send(res, 400, { error: 'Upload a 3D model before approving.' })
          return true
        }
        const modelExt = path.extname(design.stlPath).toLowerCase()
        if (!SLICEABLE_EXTS.has(modelExt)) {
          send(res, 400, {
            error: 'Upload an .stl or .gcode file before approving.',
          })
          return true
        }
        const now = new Date().toISOString()
        // Persist acceptance BEFORE queueing work so a refresh still shows "approved for quote"
        // even if the process restarts mid-Cloud-Slicer job.
        await db.run(
          `UPDATE designs SET
            reviewed_by = ?, reviewed_at = ?, review_note = ?,
            slice_status = 'slicing', slice_error = '', updated_at = ?
           WHERE id = ? AND status = 'pending_review'`,
          admin.id,
          now,
          'Accepted — quoting',
          now,
          designId,
        )
        const after = await db.get<Record<string, unknown>>(
          'SELECT * FROM designs WHERE id = ?',
          designId,
        )
        if (!after || !after.reviewed_at) {
          send(res, 500, { error: 'Could not save approval. Try again.' })
          return true
        }
        scheduleDesignSlice(designId, design.stlPath)
        design = rowToDesign(after)
        send(res, 200, {
          design: designDto(design),
          quotingStarted: true,
          sliceWarning:
            'Design accepted. Quoting via Cloud Slicer in the background — refresh, then Publish to shop when grams/hours appear.',
        })
        return true
      }

      if (action === 'approve') {
        await applyAdminOwnedColors(db, designId, admin.id)
        design = rowToDesign(
          (await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId))!,
        )
      }
      if (!designHasPricableInputs(design)) {
        send(res, 400, {
          error:
            'Need colors and at least one printer quote. Wait for quoting to finish, or use Re-quote missing.',
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
      if (action === 'approve') {
        runInBackground('push-design-approved', () =>
          notifyAdminsWithPermission(db, 'products', {
            title: 'Design approved',
            body: `“${design.name}” is priced and live in the shop`,
            url: '/designs',
          }),
        )
      }
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
  async function persistShippingProbe(orderId: string, probe: ShippingSourceProbe) {
    const now = new Date().toISOString()
    const key = `shipping_backfill_debug_${orderId}`
    try {
      await db.run(
        `INSERT INTO website_settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
        key,
        JSON.stringify(probe),
        now,
      )
    } catch (err) {
      console.warn(
        '[printx] Could not persist shipping probe',
        orderId,
        err instanceof Error ? err.message : err,
      )
    }
  }

  async function backfillOrderShippingFromStripe(
    row: Record<string, unknown>,
  ): Promise<{ row: Record<string, unknown>; probe: ShippingSourceProbe | null }> {
    if (String(row.shipping_line1 || '').trim()) return { row, probe: null }
    let sessionId = String(row.stripe_session_id || '').trim()
    const piId = String(row.stripe_payment_intent || '').trim()
    const stripe = stripeClient()
    if (!stripe) {
      console.warn('[printx] Shipping backfill skipped — STRIPE_SECRET_KEY not configured')
      return { row, probe: null }
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
      let probe: ShippingSourceProbe | null = null
      if (sessionId) {
        const loaded = await loadCheckoutShipping(stripe, sessionId)
        ship = loaded.ship
        session = loaded.session
        probe = loaded.probe
      } else if (piId) {
        const paymentIntent = await stripe.paymentIntents.retrieve(piId, {
          expand: ['latest_charge', 'payment_method'],
        })
        const emptySession = {
          customer_details: null,
          shipping_cost: null,
        } as Stripe.Checkout.Session
        ship = parseCheckoutShipping(emptySession, paymentIntent)
        probe = probeCheckoutShippingSources(emptySession, paymentIntent)
      } else {
        return { row, probe: null }
      }

      if (probe) await persistShippingProbe(String(row.id), probe)

      if (!ship.shippingLine1 && !ship.shippingCity && !ship.shippingPostal) {
        console.warn('[printx] Stripe has no usable street address for order', String(row.id), probe)
        return { row, probe }
      }
      const shippingMethod = session
        ? await resolveShippingMethodName(stripe, session, ship.shippingMethod)
        : ship.shippingMethod
      const now = new Date().toISOString()
      // Avoid `CASE WHEN ? > 0` — Postgres infers integer and rejects shipping_usd like 5.99.
      await db.run(
        `UPDATE orders SET
           shipping_name = COALESCE(NULLIF(?, ''), shipping_name),
           shipping_line1 = COALESCE(NULLIF(?, ''), shipping_line1),
           shipping_line2 = COALESCE(NULLIF(?, ''), shipping_line2),
           shipping_city = COALESCE(NULLIF(?, ''), shipping_city),
           shipping_state = COALESCE(NULLIF(?, ''), shipping_state),
           shipping_postal = COALESCE(NULLIF(?, ''), shipping_postal),
           shipping_country = COALESCE(NULLIF(?, ''), shipping_country),
           shipping_method = COALESCE(NULLIF(?, ''), shipping_method),
           shipping_usd = CASE
             WHEN CAST(? AS DOUBLE PRECISION) > 0 THEN CAST(? AS DOUBLE PRECISION)
             ELSE shipping_usd
           END,
           updated_at = ?
         WHERE id = ?`,
        ship.shippingName,
        ship.shippingLine1,
        ship.shippingLine2,
        ship.shippingCity,
        ship.shippingState,
        ship.shippingPostal,
        ship.shippingCountry,
        shippingMethod,
        ship.shippingUsd,
        ship.shippingUsd,
        now,
        String(row.id),
      )
      const updated =
        (await db.get<Record<string, unknown>>('SELECT * FROM orders WHERE id = ?', String(row.id))) ||
        row
      return { row: updated, probe }
    } catch (err) {
      console.warn(
        '[printx] Could not backfill shipping from Stripe',
        sessionId || piId || String(row.id),
        err instanceof Error ? err.message : err,
      )
      return { row, probe: null }
    }
  }

  async function loadAdminOrdersPayload(opts?: { backfillMissingShipping?: boolean }) {
    await repairDiscountCappedPayouts(db)
    await advanceArrivedOrders(db)
    const statusList = SHOP_ORDER_LIST_STATUSES.map((s) => `'${s}'`).join(', ')
    const rows = await db.all<Record<string, unknown>>(
      `SELECT o.*, u.display_name as cash_recorded_by_name, u.email as cash_recorded_by_email
       FROM orders o
       LEFT JOIN users u ON u.id = o.cash_recorded_by
       WHERE o.status IN (${statusList})
       ORDER BY COALESCE(o.paid_at, o.created_at) DESC LIMIT 200`,
    )
    const orders = []
    for (const raw of rows) {
      let row = raw
      let probe: ShippingSourceProbe | null = null
      const missingStreet = !String(raw.shipping_line1 || '').trim()
      if (opts?.backfillMissingShipping && missingStreet) {
        const result = await backfillOrderShippingFromStripe(raw)
        row = result.row
        probe = result.probe
      }
      const order = rowToOrder(row) as ReturnType<typeof rowToOrder> & {
        shippingStripeProbe?: ShippingSourceProbe
        pendingRefundRequest?: { id: string; reason: string; createdAt: string } | null
      }
      const items = await db.all<Record<string, unknown>>(
        `SELECT oi.*, d.name as design_name
         FROM order_items oi
         JOIN designs d ON d.id = oi.design_id
         WHERE oi.order_id = ?
         ORDER BY oi.sku ASC`,
        order.id,
      )
      order.items = items.map(rowToOrderItem)
      if (!order.shippingLine1 && !order.shippingCity && !order.shippingPostal && probe) {
        order.shippingStripeProbe = probe
      }
      try {
        const pendingRefund = await db.get<{ id: string; reason: string; created_at: string }>(
          `SELECT id, reason, created_at FROM refund_requests
           WHERE order_id = ? AND status = 'pending' ORDER BY created_at ASC LIMIT 1`,
          order.id,
        )
        order.pendingRefundRequest = pendingRefund
          ? {
              id: pendingRefund.id,
              reason: pendingRefund.reason,
              createdAt: pendingRefund.created_at,
            }
          : null
      } catch {
        order.pendingRefundRequest = null
      }
      orders.push(order)
    }
    const printers = await listPrinters(db)
    return { orders, printers }
  }

  async function schoolPickupCode(rawCode: string) {
    const code = sanitizeText(rawCode, 40).toUpperCase().replace(/\s+/g, '')
    if (!code) return { schoolPickup: false as const }
    const row = await db.get<{
      id: string
      code: string
      kind: string
      active: number | string
      max_redemptions: number | null
    }>(
      `SELECT id, code, kind, active, max_redemptions FROM discounts
       WHERE UPPER(REPLACE(code, ' ', '')) = ? LIMIT 1`,
      code,
    )
    if (!row || String(row.kind) !== 'school_pickup') return { schoolPickup: false as const }
    if (!Number(row.active)) {
      return { schoolPickup: false as const, error: 'That school pickup code is inactive.' }
    }
    const max = row.max_redemptions != null ? Number(row.max_redemptions) : null
    if (max != null && Number.isFinite(max)) {
      const used = await db.get<{ n: number | string }>(
        `SELECT COUNT(*) as n FROM orders
         WHERE UPPER(REPLACE(classmate_code, ' ', '')) = ?
           AND payment_method = 'cash'
           AND status NOT IN ('cancelled', 'refunded')`,
        code,
      )
      if (Number(used?.n) >= max) {
        return { schoolPickup: false as const, error: 'That school pickup code has already been fully used.' }
      }
    }
    return { schoolPickup: true as const, code: String(row.code) }
  }

  if (urlPath === '/api/public/school-pickup-code' && method === 'GET') {
    const u = new URL(req.url || '', 'http://localhost')
    const found = await schoolPickupCode(String(u.searchParams.get('code') || ''))
    send(res, 200, found)
    return true
  }

  if (urlPath === '/api/public/cash-checkout' && method === 'POST') {
    const account = await requireCustomer(req)
    const body = await readJson(req)
    if (body.agreeToPay !== true || body.agreeToTerms !== true) {
      send(res, 400, { error: 'Both boxes have to be checked.' })
      return true
    }
    const customerName = sanitizeText(String(body.customerName ?? ''), 120).trim()
    if (customerName.length < 3 || !customerName.includes(' ')) {
      send(res, 400, { error: 'Enter a full name.' })
      return true
    }
    const found = await schoolPickupCode(String(body.code ?? ''))
    if (!found.schoolPickup) {
      send(res, 400, { error: found.error || 'That code is not an active school pickup code.' })
      return true
    }
    const itemsIn = Array.isArray(body.items) ? body.items : []
    if (itemsIn.length === 0) {
      send(res, 400, { error: 'Pick a design.' })
      return true
    }
    const settings = await getPricingSettings(db)
    const stockIds = await filamentStock(db)
    const lineItems: {
      design: Design
      colorId: string
      colorName: string
      filamentColorIds: string[]
      sku: string
      qty: number
      unit: number
      worst: number
    }[] = []
    for (const raw of itemsIn.slice(0, 20)) {
      if (!raw || typeof raw !== 'object') continue
      const row = raw as Record<string, unknown>
      const designId = String(row.designId ?? '')
      let colorId = String(row.colorId ?? '')
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
      if (design.catalogPriceUsd == null) {
        send(res, 400, { error: `${design.name} is not priced yet.` })
        return true
      }
      let filamentColorIds: string[] = []
      let colorName = ''
      let colorCode = ''
      if (design.multicolorOnly) {
        colorId = MULTICOLOR_COLOR_ID
        const rawFilaments = Array.isArray(row.filamentColorIds) ? row.filamentColorIds : []
        filamentColorIds = rawFilaments.map((x) => String(x)).filter(Boolean)
        const slotCount = design.multicolorSlotCount
        if (filamentColorIds.length !== slotCount) {
          send(res, 400, { error: `${design.name} needs ${slotCount} filament colors.` })
          return true
        }
        const allowedSolids = design.availableColorIds.filter((id) => !isMulticolorColorId(id))
        const pool =
          allowedSolids.length >= slotCount
            ? allowedSolids
            : [
                ...solidBuiltinColors().map((c) => c.id),
                ...settings.customColors.filter((c) => c.name.trim()).map((c) => c.id),
              ]
        const names: string[] = []
        for (const fid of filamentColorIds) {
          if (!pool.includes(fid) || !isOfferedFilament(fid, stockIds)) {
            send(res, 400, { error: `Invalid filament color for ${design.name}.` })
            return true
          }
          const fc = colorById(fid, settings.customColors)
          if (!fc || isMulticolorColorId(fc.id)) {
            send(res, 400, { error: `Invalid filament color for ${design.name}.` })
            return true
          }
          names.push(fc.name)
        }
        const slotLabels = design.parts.map((p) => p.label)
        colorName = formatMulticolorSelection(
          names,
          slotLabels.length === names.length ? slotLabels : undefined,
        )
        colorCode = MULTICOLOR_COLOR.code
      } else {
        if (!design.availableColorIds.includes(colorId) || !isOfferedFilament(colorId, stockIds)) {
          send(res, 400, { error: `Color unavailable for ${design.name}.` })
          return true
        }
        const color = colorById(colorId, settings.customColors)
        if (!color || isMulticolorColorId(color.id)) {
          send(res, 400, { error: 'Invalid color.' })
          return true
        }
        colorName = color.name
        colorCode = color.code
      }
      lineItems.push({
        design,
        colorId,
        colorName,
        filamentColorIds,
        sku: buildSku(design.skuBase, colorCode),
        qty,
        unit: design.catalogPriceUsd,
        worst: design.worstCostUsd ?? 0,
      })
    }
    if (lineItems.length === 0) {
      send(res, 400, { error: 'Pick a design.' })
      return true
    }
    const subtotal = roundMoney(lineItems.reduce((s, i) => s + i.unit * i.qty, 0))
    const notice = cashSaleItemNotice(
      lineItems.map((i) => ({
        name: i.design.name,
        color: i.colorName,
        qty: i.qty,
        lineUsd: roundMoney(i.unit * i.qty),
      })),
      subtotal,
    )
    const now = new Date().toISOString()
    const orderId = randomUUID()
    await db.run(
      `INSERT INTO orders (
        id, customer_name, customer_email, status, stripe_session_id, stripe_payment_intent,
        subtotal_usd, total_usd, currency, created_at, updated_at, paid_at, user_id,
        payment_method, cash_recorded_by, classmate_code,
        shipping_method, shipping_usd,
        agreement_name, agreement_text,
        agreement_payment_checked, agreement_terms_checked, agreement_at
      ) VALUES (
        ?, ?, ?, 'awaiting_cash', NULL, NULL,
        ?, ?, 'usd', ?, ?, NULL, ?,
        'cash', NULL, ?,
        '', 0,
        ?, ?,
        1, 1, ?
      )`,
      orderId,
      customerName,
      account?.email || '',
      subtotal,
      subtotal,
      now,
      now,
      account?.id ?? null,
      found.code,
      customerName,
      cashAgreementText(notice),
      now,
    )
    for (const item of lineItems) {
      await db.run(
        `INSERT INTO order_items (
          id, order_id, design_id, sku, color_id, color_name, filament_color_ids, qty,
          unit_price_usd, worst_cost_unit_usd, line_total_usd, print_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unclaimed')`,
        randomUUID(),
        orderId,
        item.design.id,
        item.sku,
        item.colorId,
        item.colorName,
        JSON.stringify(item.filamentColorIds),
        item.qty,
        item.unit,
        item.worst,
        roundMoney(item.unit * item.qty),
      )
    }
    send(res, 200, { orderId, totalUsd: subtotal, code: found.code })
    return true
  }

  const cashInMatch = /^\/api\/admin\/orders\/([^/]+)\/cash-in$/.exec(urlPath)
  if (cashInMatch && method === 'POST') {
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'orders')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    const orderId = cashInMatch[1]!
    const order = await db.get<{
      status: string
      payment_method: string | null
      cash_recorded_by: string | null
    }>('SELECT status, payment_method, cash_recorded_by FROM orders WHERE id = ?', orderId)
    if (!order) {
      send(res, 404, { error: 'Order not found' })
      return true
    }
    if (String(order.payment_method || '') !== 'cash') {
      send(res, 400, { error: 'Only school pickup orders take cash.' })
      return true
    }
    if (order.cash_recorded_by) {
      send(res, 400, { error: 'Cash is already in for this order.' })
      return true
    }
    const now = new Date().toISOString()
    if (String(order.status) === 'awaiting_cash') {
      await db.run(
        `UPDATE orders
         SET status = 'paid', paid_at = ?, updated_at = ?, cash_recorded_by = ?
         WHERE id = ? AND cash_recorded_by IS NULL`,
        now,
        now,
        admin.id,
        orderId,
      )
    } else {
      await db.run(
        `UPDATE orders
         SET paid_at = COALESCE(paid_at, ?), updated_at = ?, cash_recorded_by = ?
         WHERE id = ? AND cash_recorded_by IS NULL`,
        now,
        now,
        admin.id,
        orderId,
      )
    }
    send(res, 200, { ok: true })
    return true
  }

  if (urlPath === '/api/admin/orders' && method === 'GET') {
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'orders')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    send(res, 200, await loadAdminOrdersPayload())
    return true
  }

  if (urlPath === '/api/admin/orders/refresh-shipping' && method === 'POST') {
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'orders')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    send(res, 200, await loadAdminOrdersPayload({ backfillMissingShipping: true }))
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
    if (
      !['paid', 'in_production', 'printed', 'shipped', 'arrived', 'ready', 'fulfilled'].includes(
        status,
      )
    ) {
      send(res, 400, { error: 'Only paid orders can be refunded.' })
      return true
    }
    if (String(order.payment_method || '') === 'cash') {
      send(res, 400, { error: 'Cash school-pickup sales are not Stripe charges.' })
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

  const orderShipMatch = /^\/api\/admin\/orders\/([^/]+)\/ship$/.exec(urlPath)
  if (orderShipMatch && method === 'POST') {
    const orderId = orderShipMatch[1]!
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'orders')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    const body = await readJson(req)
    const trackingNumber = sanitizeText(String(body.trackingNumber ?? ''), 80)
    if (!trackingNumber) {
      send(res, 400, { error: 'Tracking number is required.' })
      return true
    }
    const carrier = sanitizeText(String(body.carrier ?? 'UPS'), 40) || 'UPS'
    const trackingUrl =
      sanitizeText(String(body.trackingUrl ?? ''), 500) ||
      (carrier.toUpperCase() === 'UPS' ? upsTrackUrl(trackingNumber) : '')
    const order = await db.get<{ id: string; status: string; payment_method: string | null }>(
      'SELECT id, status, payment_method FROM orders WHERE id = ?',
      orderId,
    )
    if (!order) {
      send(res, 404, { error: 'Order not found' })
      return true
    }
    if (String(order.payment_method || '') === 'cash') {
      send(res, 400, { error: 'School pickup sales are handed over at school and are not shipped.' })
      return true
    }
    if (
      !['paid', 'in_production', 'printed', 'ready', 'shipped'].includes(order.status)
    ) {
      send(res, 400, { error: 'Only paid / printed orders can be marked shipped.' })
      return true
    }
    const now = new Date().toISOString()
    await db.run(
      `UPDATE orders SET
         tracking_number = ?,
         tracking_carrier = ?,
         tracking_url = ?,
         shipped_at = ?,
         status = 'shipped',
         updated_at = ?
       WHERE id = ?`,
      trackingNumber,
      carrier,
      trackingUrl,
      now,
      now,
      orderId,
    )
    const updated = await db.get<Record<string, unknown>>('SELECT * FROM orders WHERE id = ?', orderId)
    const result = rowToOrder(updated!)
    const items = await db.all<Record<string, unknown>>(
      `SELECT oi.*, d.name as design_name FROM order_items oi
       JOIN designs d ON d.id = oi.design_id WHERE oi.order_id = ? ORDER BY oi.sku ASC`,
      orderId,
    )
    result.items = items.map(rowToOrderItem)
    send(res, 200, {
      ...result,
      trackingNumber,
      trackingCarrier: carrier,
      trackingUrl,
      shippedAt: now,
    })
    return true
  }

  /** Admin knows the package was delivered — skip waiting for ETA auto-advance. */
  const orderArriveMatch = /^\/api\/admin\/orders\/([^/]+)\/arrive$/.exec(urlPath)
  if (orderArriveMatch && method === 'POST') {
    const orderId = orderArriveMatch[1]!
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'orders')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    const order = await db.get<{ id: string; status: string; shipped_at: string | null }>(
      'SELECT id, status, shipped_at FROM orders WHERE id = ?',
      orderId,
    )
    if (!order) {
      send(res, 404, { error: 'Order not found' })
      return true
    }
    if (!order.shipped_at && order.status !== 'shipped') {
      send(res, 400, { error: 'Mark the order shipped before marking it arrived.' })
      return true
    }
    if (['arrived', 'fulfilled', 'refunded', 'cancelled'].includes(order.status)) {
      const updated = await db.get<Record<string, unknown>>('SELECT * FROM orders WHERE id = ?', orderId)
      const result = rowToOrder(updated!)
      const items = await db.all<Record<string, unknown>>(
        `SELECT oi.*, d.name as design_name FROM order_items oi
         JOIN designs d ON d.id = oi.design_id WHERE oi.order_id = ? ORDER BY oi.sku ASC`,
        orderId,
      )
      result.items = items.map(rowToOrderItem)
      send(res, 200, result)
      return true
    }
    const now = new Date().toISOString()
    await db.run(
      `UPDATE orders SET status = 'fulfilled', updated_at = ? WHERE id = ?`,
      now,
      orderId,
    )
    const updated = await db.get<Record<string, unknown>>('SELECT * FROM orders WHERE id = ?', orderId)
    const result = rowToOrder(updated!)
    const items = await db.all<Record<string, unknown>>(
      `SELECT oi.*, d.name as design_name FROM order_items oi
       JOIN designs d ON d.id = oi.design_id WHERE oi.order_id = ? ORDER BY oi.sku ASC`,
      orderId,
    )
    result.items = items.map(rowToOrderItem)
    send(res, 200, result)
    return true
  }

  if (urlPath === '/api/admin/refund-requests' && method === 'GET') {
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'orders')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    const rows = await db.all<Record<string, unknown>>(
      `SELECT r.*, u.email as customer_email, u.display_name as customer_name,
              o.status as order_status, o.total_usd as order_total,
              c.status as custom_status, c.catalog_price_usd as custom_total
       FROM refund_requests r
       JOIN users u ON u.id = r.user_id
       LEFT JOIN orders o ON o.id = r.order_id
       LEFT JOIN custom_requests c ON c.id = r.custom_request_id
       WHERE r.status = 'pending'
       ORDER BY r.created_at ASC
       LIMIT 100`,
    )
    send(res, 200, {
      requests: rows.map((r) => ({
        id: String(r.id),
        orderId: r.order_id != null ? String(r.order_id) : null,
        customRequestId: r.custom_request_id != null ? String(r.custom_request_id) : null,
        userId: String(r.user_id),
        customerEmail: String(r.customer_email || ''),
        customerName: String(r.customer_name || ''),
        reason: String(r.reason || ''),
        status: String(r.status || ''),
        createdAt: String(r.created_at || ''),
        orderStatus: r.order_status != null ? String(r.order_status) : null,
        amountUsd: roundMoney(
          Number(r.order_total ?? r.custom_total) || 0,
        ),
      })),
    })
    return true
  }

  const refundReqAction = /^\/api\/admin\/refund-requests\/([^/]+)\/(approve|decline)$/.exec(urlPath)
  if (refundReqAction && method === 'POST') {
    const reqId = refundReqAction[1]!
    const action = refundReqAction[2]!
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'orders')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    const body = await readJson(req)
    const adminNote = sanitizeText(String(body.adminNote ?? ''), 1000)
    const row = await db.get<Record<string, unknown>>(
      'SELECT * FROM refund_requests WHERE id = ?',
      reqId,
    )
    if (!row) {
      send(res, 404, { error: 'Refund request not found' })
      return true
    }
    if (String(row.status) !== 'pending') {
      send(res, 400, { error: 'This request was already reviewed.' })
      return true
    }
    const now = new Date().toISOString()
    if (action === 'decline') {
      await db.run(
        `UPDATE refund_requests SET status = 'declined', admin_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`,
        adminNote || 'Declined',
        admin.id,
        now,
        reqId,
      )
      send(res, 200, { ok: true, status: 'declined' })
      return true
    }

    // Approve: run Stripe refund for shop order (custom refunds mark status only if no PI).
    const orderId = row.order_id != null ? String(row.order_id) : ''
    const customId = row.custom_request_id != null ? String(row.custom_request_id) : ''
    if (orderId) {
      // Reuse refund endpoint logic via internal fetch of order + stripe
      const stripe = stripeClient()
      if (!stripe) {
        send(res, 503, { error: 'Stripe is not configured.' })
        return true
      }
      const order = await db.get<Record<string, unknown>>('SELECT * FROM orders WHERE id = ?', orderId)
      if (!order) {
        send(res, 404, { error: 'Order not found' })
        return true
      }
      if (String(order.status) !== 'refunded') {
        let paymentIntent =
          typeof order.stripe_payment_intent === 'string' ? order.stripe_payment_intent.trim() : ''
        const sessionId =
          typeof order.stripe_session_id === 'string' ? order.stripe_session_id.trim() : ''
        if (sessionId) {
          try {
            const session = await stripe.checkout.sessions.retrieve(sessionId)
            if (typeof session.payment_intent === 'string') paymentIntent = session.payment_intent
          } catch {
            /* use stored */
          }
        }
        if (!paymentIntent) {
          send(res, 400, { error: 'No Stripe payment found for this order.' })
          return true
        }
        try {
          await stripe.refunds.create({
            payment_intent: paymentIntent,
            reason: 'requested_by_customer',
          })
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          if (!/already been refunded|charge_already_refunded/i.test(msg)) {
            send(res, 400, { error: msg || 'Refund failed' })
            return true
          }
        }
        await db.run(
          `UPDATE orders SET status = 'refunded', stripe_payment_intent = ?, updated_at = ? WHERE id = ?`,
          paymentIntent,
          now,
          orderId,
        )
      }
    } else if (customId) {
      await db.run(
        `UPDATE custom_requests SET status = 'refunded', updated_at = ? WHERE id = ?`,
        now,
        customId,
      )
    }
    await db.run(
      `UPDATE refund_requests SET status = 'approved', admin_note = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`,
      adminNote || 'Approved',
      admin.id,
      now,
      reqId,
    )
    send(res, 200, { ok: true, status: 'approved' })
    return true
  }

  if (urlPath === '/api/admin/discounts' && method === 'GET') {
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'orders')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    const rows = await db.all<Record<string, unknown>>(
      `SELECT * FROM discounts ORDER BY created_at DESC LIMIT 100`,
    )
    send(res, 200, {
      discounts: rows.map((d) => ({
        id: String(d.id),
        code: String(d.code || ''),
        kind: String(d.kind || 'percent'),
        percentOff: d.percent_off != null ? Number(d.percent_off) : null,
        amountOffCents: d.amount_off_cents != null ? Number(d.amount_off_cents) : null,
        currency: String(d.currency || 'usd'),
        maxRedemptions: d.max_redemptions != null ? Number(d.max_redemptions) : null,
        stripeCouponId: String(d.stripe_coupon_id || ''),
        stripePromotionCodeId: String(d.stripe_promotion_code_id || ''),
        active: Boolean(Number(d.active)),
        visibleToCustomers: Boolean(Number(d.visible_to_customers ?? 0)),
        createdAt: String(d.created_at || ''),
      })),
    })
    return true
  }

  if (urlPath === '/api/admin/discounts' && method === 'POST') {
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'orders')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    const body = await readJson(req)
    const code = sanitizeText(String(body.code ?? ''), 40).toUpperCase().replace(/\s+/g, '')
    if (!code || code.length < 3) {
      send(res, 400, { error: 'Enter a promo code (at least 3 characters).' })
      return true
    }
    const kindRaw = String(body.kind ?? 'percent')
    type DiscountKind =
      | 'percent'
      | 'amount'
      | 'free_shipping'
      | 'percent_and_shipping'
      | 'amount_and_shipping'
      | 'school_pickup'
    let kind: DiscountKind
    if (
      kindRaw === 'free_shipping' ||
      kindRaw === 'percent_and_shipping' ||
      kindRaw === 'amount_and_shipping' ||
      kindRaw === 'school_pickup'
    ) {
      if (!admin.isMainAdmin) {
        send(res, 403, {
          error:
            'Only main admins can create free-shipping, item+shipping, or school-pickup promo codes.',
        })
        return true
      }
      kind = kindRaw
    } else if (kindRaw === 'amount') {
      kind = 'amount'
    } else {
      kind = 'percent'
    }
    const percentOff = Number(body.percentOff)
    const amountOffCents =
      kind === 'free_shipping'
        ? standardShippingCents()
        : Math.round(Number(body.amountOffCents) || 0)
    const maxRedemptions =
      body.maxRedemptions != null && body.maxRedemptions !== ''
        ? Math.max(1, Math.floor(Number(body.maxRedemptions)))
        : null
    // Opt-in: only show on customer accounts when admin explicitly enables it.
    const visibleToCustomers =
      body.visibleToCustomers === true || body.visibleToCustomers === 1 || body.visibleToCustomers === '1'
        ? 1
        : 0
    if (kind === 'school_pickup') {
      const dup = await db.get<{ id: string }>('SELECT id FROM discounts WHERE code = ?', code)
      if (dup) {
        send(res, 400, { error: 'Another promo code already uses that code.' })
        return true
      }
      const id = randomUUID()
      const now = new Date().toISOString()
      await db.run(
        `INSERT INTO discounts (
          id, code, kind, percent_off, amount_off_cents, currency, max_redemptions,
          stripe_coupon_id, stripe_promotion_code_id, active, visible_to_customers, created_by, created_at, updated_at
        ) VALUES (?, ?, 'school_pickup', NULL, NULL, 'usd', ?, '', '', 1, 0, ?, ?, ?)`,
        id,
        code,
        maxRedemptions,
        admin.id,
        now,
        now,
      )
      send(res, 200, {
        discount: {
          id,
          code,
          kind,
          percentOff: null,
          amountOffCents: null,
          active: true,
          visibleToCustomers: false,
          stripePromotionCodeId: '',
        },
      })
      return true
    }
    const stripe = stripeClient()
    if (!stripe) {
      send(res, 503, { error: 'Stripe is not configured.' })
      return true
    }
    const usesPercent = kind === 'percent' || kind === 'percent_and_shipping'
    if (usesPercent) {
      if (!(percentOff > 0 && percentOff <= 100)) {
        send(res, 400, { error: 'Percent off must be between 1 and 100.' })
        return true
      }
    } else if (!(amountOffCents > 0)) {
      send(res, 400, { error: 'Amount off must be greater than zero.' })
      return true
    }
    const couponName =
      kind === 'free_shipping'
        ? `${code} (free shipping)`
        : kind === 'percent_and_shipping'
          ? `${code} (${percentOff}% + free ship)`
          : kind === 'amount_and_shipping'
            ? `${code} ($ off + free ship)`
            : code
    try {
      const coupon = await stripe.coupons.create({
        ...(usesPercent
          ? { percent_off: percentOff }
          : { amount_off: amountOffCents, currency: 'usd' }),
        duration: 'once',
        name: couponName,
      })
      const promo = await stripe.promotionCodes.create({
        // Stripe API 2025+: coupon is nested under `promotion`, not a top-level field.
        promotion: { type: 'coupon', coupon: coupon.id },
        code,
        ...(maxRedemptions ? { max_redemptions: maxRedemptions } : {}),
      })
      const id = randomUUID()
      const now = new Date().toISOString()
      await db.run(
        `INSERT INTO discounts (
          id, code, kind, percent_off, amount_off_cents, currency, max_redemptions,
          stripe_coupon_id, stripe_promotion_code_id, active, visible_to_customers, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'usd', ?, ?, ?, 1, ?, ?, ?, ?)`,
        id,
        code,
        kind,
        usesPercent ? percentOff : null,
        usesPercent ? null : amountOffCents,
        maxRedemptions,
        coupon.id,
        promo.id,
        visibleToCustomers,
        admin.id,
        now,
        now,
      )
      send(res, 200, {
        discount: {
          id,
          code,
          kind,
          percentOff: usesPercent ? percentOff : null,
          amountOffCents: usesPercent ? null : amountOffCents,
          active: true,
          visibleToCustomers: Boolean(visibleToCustomers),
          stripePromotionCodeId: promo.id,
        },
      })
    } catch (err) {
      send(res, 400, { error: err instanceof Error ? err.message : 'Could not create discount' })
    }
    return true
  }

  const discountVisibility = /^\/api\/admin\/discounts\/([^/]+)\/visibility$/.exec(urlPath)
  if (discountVisibility && method === 'POST') {
    const discountId = discountVisibility[1]!
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'orders')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    const body = await readJson(req)
    const visible =
      body.visibleToCustomers === true || body.visibleToCustomers === 1 || body.visibleToCustomers === '1'
        ? 1
        : 0
    const row = await db.get<{ id: string; kind: string }>(
      'SELECT id, kind FROM discounts WHERE id = ?',
      discountId,
    )
    if (!row) {
      send(res, 404, { error: 'Discount not found' })
      return true
    }
    if (String(row.kind) === 'school_pickup') {
      if (!admin.isMainAdmin) {
        send(res, 403, { error: 'Only main admins can edit school-pickup promo codes.' })
        return true
      }
      send(res, 400, { error: 'School pickup codes are not shown on customer accounts.' })
      return true
    }
    const now = new Date().toISOString()
    await db.run(
      `UPDATE discounts SET visible_to_customers = ?, updated_at = ? WHERE id = ?`,
      visible,
      now,
      discountId,
    )
    send(res, 200, { ok: true, visibleToCustomers: Boolean(visible) })
    return true
  }

  const discountDeactivate = /^\/api\/admin\/discounts\/([^/]+)\/deactivate$/.exec(urlPath)
  if (discountDeactivate && method === 'POST') {
    const discountId = discountDeactivate[1]!
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'orders')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    const stripe = stripeClient()
    const row = await db.get<{ stripe_promotion_code_id: string; active: number | string }>(
      'SELECT stripe_promotion_code_id, active FROM discounts WHERE id = ?',
      discountId,
    )
    if (!row) {
      send(res, 404, { error: 'Discount not found' })
      return true
    }
    if (stripe && row.stripe_promotion_code_id) {
      try {
        await stripe.promotionCodes.update(row.stripe_promotion_code_id, { active: false })
      } catch (err) {
        console.warn('[printx] Could not deactivate Stripe promotion code', err)
      }
    }
    const now = new Date().toISOString()
    await db.run(
      `UPDATE discounts SET active = 0, updated_at = ? WHERE id = ?`,
      now,
      discountId,
    )
    send(res, 200, { ok: true })
    return true
  }

  const discountReactivate = /^\/api\/admin\/discounts\/([^/]+)\/reactivate$/.exec(urlPath)
  if (discountReactivate && method === 'POST') {
    const discountId = discountReactivate[1]!
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'orders')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    const stripe = stripeClient()
    const row = await db.get<{ stripe_promotion_code_id: string; active: number | string }>(
      'SELECT stripe_promotion_code_id, active FROM discounts WHERE id = ?',
      discountId,
    )
    if (!row) {
      send(res, 404, { error: 'Discount not found' })
      return true
    }
    if (stripe && row.stripe_promotion_code_id) {
      try {
        await stripe.promotionCodes.update(row.stripe_promotion_code_id, { active: true })
      } catch (err) {
        send(res, 400, {
          error:
            err instanceof Error
              ? err.message
              : 'Could not reactivate this code in Stripe. Create a new code instead.',
        })
        return true
      }
    }
    const now = new Date().toISOString()
    await db.run(
      `UPDATE discounts SET active = 1, updated_at = ? WHERE id = ?`,
      now,
      discountId,
    )
    send(res, 200, { ok: true })
    return true
  }

  const discountMutate = /^\/api\/admin\/discounts\/([^/]+)$/.exec(urlPath)
  if (discountMutate && method === 'PATCH') {
    const discountId = discountMutate[1]!
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'orders')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    const stripe = stripeClient()
    const existing = await db.get<{
      id: string
      code: string
      kind: string
      percent_off: number | null
      amount_off_cents: number | null
      max_redemptions: number | null
      stripe_coupon_id: string
      stripe_promotion_code_id: string
      active: number | string
      visible_to_customers: number | string
    }>('SELECT * FROM discounts WHERE id = ?', discountId)
    if (!existing) {
      send(res, 404, { error: 'Discount not found' })
      return true
    }

    const body = await readJson(req)
    const code = sanitizeText(String(body.code ?? existing.code), 40).toUpperCase().replace(/\s+/g, '')
    if (!code || code.length < 3) {
      send(res, 400, { error: 'Enter a promo code (at least 3 characters).' })
      return true
    }
    const dup = await db.get<{ id: string }>(
      'SELECT id FROM discounts WHERE code = ? AND id != ?',
      code,
      discountId,
    )
    if (dup) {
      send(res, 400, { error: 'Another promo code already uses that code.' })
      return true
    }

    const kindRaw = String(body.kind ?? existing.kind ?? 'percent')
    type DiscountKind =
      | 'percent'
      | 'amount'
      | 'free_shipping'
      | 'percent_and_shipping'
      | 'amount_and_shipping'
      | 'school_pickup'
    let kind: DiscountKind
    if (
      kindRaw === 'school_pickup' ||
      String(existing.kind || '') === 'school_pickup'
    ) {
      if (!admin.isMainAdmin) {
        send(res, 403, { error: 'Only main admins can edit school-pickup promo codes.' })
        return true
      }
    }
    if (
      kindRaw === 'free_shipping' ||
      kindRaw === 'percent_and_shipping' ||
      kindRaw === 'amount_and_shipping' ||
      kindRaw === 'school_pickup'
    ) {
      if (!admin.isMainAdmin) {
        send(res, 403, {
          error:
            'Only main admins can use free-shipping, item+shipping, or school-pickup promo codes.',
        })
        return true
      }
      kind = kindRaw
    } else if (kindRaw === 'amount') {
      kind = 'amount'
    } else {
      kind = 'percent'
    }

    const percentOff =
      body.percentOff != null && body.percentOff !== ''
        ? Number(body.percentOff)
        : Number(existing.percent_off)
    const amountOffCents =
      kind === 'free_shipping'
        ? standardShippingCents()
        : body.amountOffCents != null && body.amountOffCents !== ''
          ? Math.round(Number(body.amountOffCents) || 0)
          : Number(existing.amount_off_cents) || 0
    const maxRedemptions =
      body.maxRedemptions === null || body.maxRedemptions === ''
        ? null
        : body.maxRedemptions != null
          ? Math.max(1, Math.floor(Number(body.maxRedemptions)))
          : existing.max_redemptions != null
            ? Number(existing.max_redemptions)
            : null
    const visibleToCustomers =
      body.visibleToCustomers === true || body.visibleToCustomers === 1 || body.visibleToCustomers === '1'
        ? 1
        : body.visibleToCustomers === false ||
            body.visibleToCustomers === 0 ||
            body.visibleToCustomers === '0'
          ? 0
          : Number(existing.visible_to_customers) ? 1 : 0

    if (kind === 'school_pickup') {
      const now = new Date().toISOString()
      if (existing.stripe_promotion_code_id || existing.stripe_coupon_id) {
        if (!stripe) {
          send(res, 503, { error: 'Stripe is not configured.' })
          return true
        }
        if (existing.stripe_promotion_code_id) {
          try {
            await stripe.promotionCodes.update(String(existing.stripe_promotion_code_id), {
              active: false,
            })
          } catch (err) {
            console.warn('[printx] Could not deactivate old Stripe promotion code', err)
          }
        }
        if (existing.stripe_coupon_id) {
          try {
            await stripe.coupons.del(String(existing.stripe_coupon_id))
          } catch (err) {
            console.warn('[printx] Could not delete old Stripe coupon', err)
          }
        }
      }
      await db.run(
        `UPDATE discounts SET
          code = ?, kind = 'school_pickup', percent_off = NULL, amount_off_cents = NULL,
          max_redemptions = ?, stripe_coupon_id = '', stripe_promotion_code_id = '',
          visible_to_customers = 0, updated_at = ?
         WHERE id = ?`,
        code,
        maxRedemptions,
        now,
        discountId,
      )
      send(res, 200, {
        discount: {
          id: discountId,
          code,
          kind,
          percentOff: null,
          amountOffCents: null,
          maxRedemptions,
          active: Boolean(Number(existing.active)),
          visibleToCustomers: false,
          stripePromotionCodeId: '',
        },
      })
      return true
    }
    if (!stripe) {
      send(res, 503, { error: 'Stripe is not configured.' })
      return true
    }

    const usesPercent = kind === 'percent' || kind === 'percent_and_shipping'
    if (usesPercent) {
      if (!(percentOff > 0 && percentOff <= 100)) {
        send(res, 400, { error: 'Percent off must be between 1 and 100.' })
        return true
      }
    } else if (!(amountOffCents > 0)) {
      send(res, 400, { error: 'Amount off must be greater than zero.' })
      return true
    }

    const prevPercent = existing.percent_off != null ? Number(existing.percent_off) : null
    const prevAmount = existing.amount_off_cents != null ? Number(existing.amount_off_cents) : null
    const prevMax =
      existing.max_redemptions != null ? Number(existing.max_redemptions) : null
    const stripeNeedsRecreate =
      code !== String(existing.code || '') ||
      kind !== String(existing.kind || 'percent') ||
      (usesPercent
        ? percentOff !== prevPercent
        : amountOffCents !== prevAmount)

    const now = new Date().toISOString()
    const keepActive = Boolean(Number(existing.active))

    try {
      let stripeCouponId = String(existing.stripe_coupon_id || '')
      let stripePromotionCodeId = String(existing.stripe_promotion_code_id || '')

      if (stripeNeedsRecreate) {
        const couponName =
          kind === 'free_shipping'
            ? `${code} (free shipping)`
            : kind === 'percent_and_shipping'
              ? `${code} (${percentOff}% + free ship)`
              : kind === 'amount_and_shipping'
                ? `${code} ($ off + free ship)`
                : code

        // Free the old Stripe code string before creating the replacement.
        if (stripePromotionCodeId) {
          try {
            await stripe.promotionCodes.update(stripePromotionCodeId, { active: false })
          } catch (err) {
            console.warn('[printx] Could not deactivate old Stripe promotion code', err)
          }
        }
        if (stripeCouponId) {
          try {
            await stripe.coupons.del(stripeCouponId)
          } catch (err) {
            console.warn('[printx] Could not delete old Stripe coupon', err)
          }
        }

        const coupon = await stripe.coupons.create({
          ...(usesPercent
            ? { percent_off: percentOff }
            : { amount_off: amountOffCents, currency: 'usd' }),
          duration: 'once',
          name: couponName,
        })
        const promo = await stripe.promotionCodes.create({
          promotion: { type: 'coupon', coupon: coupon.id },
          code,
          active: keepActive,
          ...(maxRedemptions ? { max_redemptions: maxRedemptions } : {}),
        })
        stripeCouponId = coupon.id
        stripePromotionCodeId = promo.id
      } else {
        // Soft fields only — update Stripe max redemptions when possible.
        if (stripePromotionCodeId && maxRedemptions !== prevMax) {
          try {
            await stripe.promotionCodes.update(stripePromotionCodeId, {
              ...(maxRedemptions != null ? { max_redemptions: maxRedemptions } : {}),
            })
          } catch (err) {
            send(res, 400, {
              error:
                err instanceof Error
                  ? err.message
                  : 'Could not update max redemptions in Stripe. Try a higher limit, or change the discount amount to recreate the code.',
            })
            return true
          }
        }
      }

      await db.run(
        `UPDATE discounts SET
          code = ?, kind = ?, percent_off = ?, amount_off_cents = ?, max_redemptions = ?,
          stripe_coupon_id = ?, stripe_promotion_code_id = ?, visible_to_customers = ?, updated_at = ?
         WHERE id = ?`,
        code,
        kind,
        usesPercent ? percentOff : null,
        usesPercent ? null : amountOffCents,
        maxRedemptions,
        stripeCouponId,
        stripePromotionCodeId,
        visibleToCustomers,
        now,
        discountId,
      )

      send(res, 200, {
        discount: {
          id: discountId,
          code,
          kind,
          percentOff: usesPercent ? percentOff : null,
          amountOffCents: usesPercent ? null : amountOffCents,
          maxRedemptions,
          active: keepActive,
          visibleToCustomers: Boolean(visibleToCustomers),
          stripePromotionCodeId,
        },
      })
    } catch (err) {
      send(res, 400, { error: err instanceof Error ? err.message : 'Could not update discount' })
    }
    return true
  }

  if (discountMutate && method === 'DELETE') {
    const discountId = discountMutate[1]!
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'orders')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    const stripe = stripeClient()
    const row = await db.get<{
      stripe_promotion_code_id: string
      stripe_coupon_id: string
    }>('SELECT stripe_promotion_code_id, stripe_coupon_id FROM discounts WHERE id = ?', discountId)
    if (!row) {
      send(res, 404, { error: 'Discount not found' })
      return true
    }
    if (stripe) {
      if (row.stripe_promotion_code_id) {
        try {
          await stripe.promotionCodes.update(row.stripe_promotion_code_id, { active: false })
        } catch (err) {
          console.warn('[printx] Could not deactivate Stripe promotion code before delete', err)
        }
      }
      if (row.stripe_coupon_id) {
        try {
          await stripe.coupons.del(row.stripe_coupon_id)
        } catch (err) {
          console.warn('[printx] Could not delete Stripe coupon', err)
        }
      }
    }
    await db.run(`DELETE FROM discounts WHERE id = ?`, discountId)
    send(res, 200, { ok: true })
    return true
  }

  const customShipMatch = /^\/api\/admin\/custom-requests\/([^/]+)\/ship$/.exec(urlPath)
  if (customShipMatch && method === 'POST') {
    const customId = customShipMatch[1]!
    const admin = await requireAdmin(req)
    if (!admin || (!adminCan(admin, 'orders') && !adminCan(admin, 'requests'))) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    const body = await readJson(req)
    const trackingNumber = sanitizeText(String(body.trackingNumber ?? ''), 80)
    if (!trackingNumber) {
      send(res, 400, { error: 'Tracking number is required.' })
      return true
    }
    const carrier = sanitizeText(String(body.carrier ?? 'UPS'), 40) || 'UPS'
    const trackingUrl =
      sanitizeText(String(body.trackingUrl ?? ''), 500) ||
      (carrier.toUpperCase() === 'UPS' ? upsTrackUrl(trackingNumber) : '')
    const row = await db.get<{ id: string; paid_at: string | null }>(
      'SELECT id, paid_at FROM custom_requests WHERE id = ?',
      customId,
    )
    if (!row || !row.paid_at) {
      send(res, 404, { error: 'Paid custom request not found' })
      return true
    }
    const now = new Date().toISOString()
    await db.run(
      `UPDATE custom_requests SET
         tracking_number = ?,
         tracking_carrier = ?,
         tracking_url = ?,
         shipped_at = ?,
         status = 'shipped',
         updated_at = ?
       WHERE id = ?`,
      trackingNumber,
      carrier,
      trackingUrl,
      now,
      now,
      customId,
    )
    send(res, 200, {
      ok: true,
      trackingNumber,
      trackingCarrier: carrier,
      trackingUrl,
      shippedAt: now,
    })
    return true
  }

  const orderItemStlMetaMatch = /^\/api\/admin\/order-items\/([^/]+)\/stl\/meta$/.exec(urlPath)
  if (orderItemStlMetaMatch && method === 'GET') {
    const itemId = orderItemStlMetaMatch[1]!
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'orders')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    const item = await db.get<Record<string, unknown>>('SELECT * FROM order_items WHERE id = ?', itemId)
    if (!item) {
      send(res, 404, { error: 'Order item not found' })
      return true
    }
    const designRow = await db.get<Record<string, unknown>>(
      'SELECT * FROM designs WHERE id = ?',
      String(item.design_id || ''),
    )
    if (!designRow) {
      send(res, 404, { error: 'Design not found' })
      return true
    }
    const design = rowToDesign(designRow)
    const targets = designGcodeSliceTargets(design)
    if (!targets.length) {
      send(res, 404, { error: 'No model file on this design.' })
      return true
    }
    send(res, 200, {
      partCount: targets.length,
      parts: targets.map((t, i) => {
        const ext = path.extname(t.stlPath).toLowerCase() || '.stl'
        return {
          index: t.partIndex ?? i,
          label: t.label,
          ext,
        }
      }),
    })
    return true
  }

  const orderItemStlMatch = /^\/api\/admin\/order-items\/([^/]+)\/stl$/.exec(urlPath)
  if (orderItemStlMatch && method === 'GET') {
    const itemId = orderItemStlMatch[1]!
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'orders')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    const partRaw = new URL(req.url || '', 'http://local').searchParams.get('part')
    const partIndex = partRaw == null || partRaw === '' ? 0 : Math.floor(Number(partRaw))
    if (!Number.isFinite(partIndex) || partIndex < 0) {
      send(res, 400, { error: 'Invalid part index.' })
      return true
    }
    const item = await db.get<Record<string, unknown>>('SELECT * FROM order_items WHERE id = ?', itemId)
    if (!item) {
      send(res, 404, { error: 'Order item not found' })
      return true
    }
    const designId = String(item.design_id || '')
    const designRow = await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId)
    if (!designRow) {
      send(res, 404, { error: 'Design not found' })
      return true
    }
    const design = rowToDesign(designRow)
    const targets = designGcodeSliceTargets(design)
    const target =
      targets.find((t) => (t.partIndex ?? 0) === partIndex) || targets[partIndex] || null
    if (!target?.stlPath) {
      send(res, 404, { error: 'Model file not found for this part.' })
      return true
    }
    const stlPath = target.stlPath
    if (stlPath.includes('..') || stlPath.includes('/') || stlPath.includes('\\')) {
      send(res, 404, { error: 'Model file not found.' })
      return true
    }
    const ext = path.extname(stlPath).toLowerCase() || '.stl'
    const sku = String(item.sku || designId).replace(/[^\w.-]+/g, '_')
    const downloadName =
      target.partIndex != null
        ? `printx-${sku}-${safeGcodeFilenamePart(target.label, target.partIndex)}${ext}`
        : `printx-${sku}${ext}`
    const disposition = `attachment; filename="${downloadName.replace(/"/g, '')}"`
    const ok = await sendStoredFile(res, stlPath, modelContentType(ext), 'private, no-store', {
      'Content-Disposition': disposition,
    })
    if (!ok && ext === '.stl') {
      const fallbackOk = await sendStlWithDevFallback(
        res,
        designId,
        stlPath,
        modelContentType(ext),
        'private, no-store',
      )
      if (fallbackOk) return true
    }
    if (!ok) {
      send(res, 404, { error: 'Model file missing in storage.' })
      return true
    }
    return true
  }

  const orderItemGcodeStatusMatch = /^\/api\/admin\/order-items\/([^/]+)\/gcode\/status$/.exec(urlPath)
  if (orderItemGcodeStatusMatch && method === 'GET') {
    const itemId = orderItemGcodeStatusMatch[1]!
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'orders')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    if (await orderItemIsShipped(db, itemId)) {
      send(res, 200, {
        status: 'error' as const,
        error: 'G-code download is disabled after the order is marked shipped.',
      })
      return true
    }
    send(res, 200, await orderItemGcodeStatus(db, itemId))
    return true
  }

  const orderItemGcodePrepareMatch = /^\/api\/admin\/order-items\/([^/]+)\/gcode\/prepare$/.exec(
    urlPath,
  )
  if (orderItemGcodePrepareMatch && method === 'POST') {
    const itemId = orderItemGcodePrepareMatch[1]!
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'orders')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    if (await orderItemIsShipped(db, itemId)) {
      send(res, 400, { error: 'G-code download is disabled after the order is marked shipped.' })
      return true
    }
    const item = await db.get<{ assigned_printer_id: string | null }>(
      'SELECT assigned_printer_id FROM order_items WHERE id = ?',
      itemId,
    )
    if (!item) {
      send(res, 404, { error: 'Order item not found' })
      return true
    }
    if (!String(item.assigned_printer_id || '').trim()) {
      send(res, 400, { error: 'Claim this item with a printer before downloading G-code.' })
      return true
    }
    try {
      const result = await startOrderGcodePrep(db, itemId)
      send(res, 200, result)
    } catch (err) {
      send(res, 200, {
        status: 'error' as const,
        error: err instanceof Error ? err.message : 'G-code prepare failed',
      })
    }
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
    if (await orderItemIsShipped(db, itemId)) {
      send(res, 400, { error: 'G-code download is disabled after the order is marked shipped.' })
      return true
    }
    const partRaw = new URL(req.url || '', 'http://local').searchParams.get('part')
    const partIndex = partRaw == null || partRaw === '' ? 0 : Math.floor(Number(partRaw))
    if (!Number.isFinite(partIndex) || partIndex < 0) {
      send(res, 400, { error: 'Invalid part index.' })
      return true
    }
    try {
      // Fast path only — slicing runs via /gcode/prepare so proxies do not time out.
      const file = await openOrderItemGcode(db, itemId, partIndex)
      if (!file) {
        const job = orderGcodeJobs.get(itemId)
        if (job?.status === 'error') {
          send(res, 400, { error: job.error || 'G-code prepare failed' })
          return true
        }
        send(res, 409, {
          error: 'G-code is still preparing. Wait a moment and try again.',
          code: 'NOT_READY',
        })
        return true
      }
      res.statusCode = 200
      res.setHeader('Content-Type', 'application/octet-stream')
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${file.filename.replace(/"/g, '')}"`,
      )
      res.setHeader('Cache-Control', 'private, no-store')
      if (file.kind === 'stream') {
        try {
          const buf = await fs.promises.readFile(file.path)
          res.end(buf)
        } finally {
          file.cleanup?.()
        }
      } else {
        res.end(file.buffer)
      }
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
    if (!admin || !adminCan(admin, 'money')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    // Workers may serve before background migrate finishes — ensure column exists.
    await migrateShippingToProfit(db)
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

    // Item revenue after discounts. Never use a pre-discount catalog subtotal above what Stripe collected.
    const shopItemEarningsSql = `LEAST(
      CASE WHEN COALESCE(subtotal_usd, 0) > 0 THEN subtotal_usd ELSE 1e18 END,
      GREATEST(0, COALESCE(total_usd, 0) - COALESCE(shipping_usd, 0))
    )`

    /** Net earned = items + shipping-kept-as-profit − Stripe fees. UPS pass-through shipping is excluded. */
    const shopStripeFee = (o: { total_usd?: number | string | null; payment_method?: string | null }) =>
      String(o.payment_method || 'stripe') === 'cash'
        ? 0
        : stripeFeeOnChargeUsd(Number(o.total_usd) || 0)
    const netEarnedFromShopRow = (o: {
      item_earnings_usd?: number | string | null
      total_usd?: number | string | null
      shipping_usd?: number | string | null
      shipping_to_profit_at?: string | null
      payment_method?: string | null
    }) => {
      const items = Math.max(0, Number(o.item_earnings_usd) || 0)
      const ship = Math.max(0, Number(o.shipping_usd) || 0)
      const shipKept = o.shipping_to_profit_at ? ship : 0
      return items + shipKept - shopStripeFee(o)
    }
    const netEarnedFromCustomRow = (o: {
      catalog_price_usd?: number | string | null
      shipping_usd?: number | string | null
      shipping_to_profit_at?: string | null
    }) => {
      const items = Math.max(0, Number(o.catalog_price_usd) || 0)
      const ship = Math.max(0, Number(o.shipping_usd) || 0)
      const shipKept = o.shipping_to_profit_at ? ship : 0
      const fee = stripeFeeOnChargeUsd(items + ship)
      return items + shipKept - fee
    }

    const sumNetEarnedInRange = async (start: string | null, end: string | null) => {
      const shopParams: unknown[] = []
      let shopSql = `SELECT total_usd, shipping_usd, shipping_to_profit_at, payment_method,
            ${shopItemEarningsSql} as item_earnings_usd
         FROM orders
        WHERE paid_at IS NOT NULL
          AND status IN (${SHOP_ORDER_MONEY_STATUS_SQL})
         AND (COALESCE(payment_method, 'stripe') <> 'cash' OR cash_recorded_by IS NOT NULL)`
      if (start) {
        shopSql += ` AND paid_at >= ?`
        shopParams.push(start)
      }
      if (end) {
        shopSql += ` AND paid_at < ?`
        shopParams.push(end)
      }
      const customParams: unknown[] = []
      let customSql = `SELECT catalog_price_usd, shipping_usd, shipping_to_profit_at
         FROM custom_requests
        WHERE paid_at IS NOT NULL AND catalog_price_usd IS NOT NULL`
      if (start) {
        customSql += ` AND paid_at >= ?`
        customParams.push(start)
      }
      if (end) {
        customSql += ` AND paid_at < ?`
        customParams.push(end)
      }
      const shopRows = await db.all<{
        total_usd: number | string | null
        shipping_usd: number | string | null
        shipping_to_profit_at: string | null
        payment_method: string | null
        item_earnings_usd: number | string | null
      }>(shopSql, ...shopParams)
      const customRows = await db.all<{
        catalog_price_usd: number | string | null
        shipping_usd: number | string | null
        shipping_to_profit_at: string | null
      }>(customSql, ...customParams)
      const total =
        shopRows.reduce((sum, o) => sum + netEarnedFromShopRow(o), 0) +
        customRows.reduce((sum, o) => sum + netEarnedFromCustomRow(o), 0)
      return roundMoney(Math.max(0, total))
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

    await repairDiscountCappedPayouts(db)

    const shopOrders = await db.all<Record<string, unknown>>(
      `SELECT id, customer_name, customer_email, total_usd, subtotal_usd, shipping_usd,
              shipping_to_profit_at, status, paid_at, stripe_session_id, payment_method,
              ${shopItemEarningsSql} as item_earnings_usd
       FROM orders
       WHERE paid_at IS NOT NULL
         AND paid_at >= ? AND paid_at < ?
         AND status IN (${SHOP_ORDER_MONEY_STATUS_SQL})
         AND (COALESCE(payment_method, 'stripe') <> 'cash' OR cash_recorded_by IS NOT NULL)
       ORDER BY paid_at DESC`,
      rangeStart,
      rangeEnd,
    )
    const customPaid = await db.all<Record<string, unknown>>(
      `SELECT id, name, email, catalog_price_usd, shipping_usd, shipping_to_profit_at,
              worst_cost_usd, status, paid_at, stripe_session_id
       FROM custom_requests
       WHERE paid_at IS NOT NULL
         AND paid_at >= ? AND paid_at < ?
         AND catalog_price_usd IS NOT NULL
       ORDER BY paid_at DESC`,
      rangeStart,
      rangeEnd,
    )

    const shopEarnings = roundMoney(
      shopOrders.reduce((sum, o) => sum + (Number(o.item_earnings_usd) || 0), 0),
    )
    const customEarnings = roundMoney(
      customPaid.reduce((sum, o) => sum + (Number(o.catalog_price_usd) || 0), 0),
    )
    const earningsTotalUsd = roundMoney(shopEarnings + customEarnings)
    const shippingKeptAsProfitUsd = roundMoney(
      [...shopOrders, ...customPaid].reduce((sum, o) => {
        if (!o.shipping_to_profit_at) return sum
        return sum + Math.max(0, Number(o.shipping_usd) || 0)
      }, 0),
    )
    const shippingPassThroughUsd = roundMoney(
      [...shopOrders, ...customPaid].reduce((sum, o) => {
        if (o.shipping_to_profit_at) return sum
        return sum + Math.max(0, Number(o.shipping_usd) || 0)
      }, 0),
    )
    /** UPS pass-through only — shipping moved to profit is excluded here. */
    const shippingTotalUsd = shippingPassThroughUsd
    const shippingCollectedUsd = roundMoney(shippingPassThroughUsd + shippingKeptAsProfitUsd)
    // Gross customer payments this month (items + all shipping collected).
    const printxEarnedGrossUsd = roundMoney(earningsTotalUsd + shippingCollectedUsd)

    // Stripe takes 2.9% + $0.30 on each successful charge (full customer total).
    const shopStripeFeesUsd = roundMoney(
      shopOrders.reduce((sum, o) => sum + shopStripeFee(o), 0),
    )
    const customStripeFeesUsd = roundMoney(
      customPaid.reduce((sum, o) => {
        const charge =
          Math.max(0, Number(o.catalog_price_usd) || 0) + Math.max(0, Number(o.shipping_usd) || 0)
        return sum + stripeFeeOnChargeUsd(charge)
      }, 0),
    )
    const stripeFeesUsd = roundMoney(shopStripeFeesUsd + customStripeFeesUsd)

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

    type OwedLine = {
      id: string
      amountUsd: number
      note: string
      createdAt: string
      orderId: string | null
      designName: string | null
      sku: string | null
      colorName: string | null
      qty: number | null
    }
    type OwedBucket = {
      userId: string
      email: string
      displayName: string | null
      totalOwedUsd: number
      lines: OwedLine[]
    }
    const byUser = new Map<string, OwedBucket>()
    const ensureBucket = (
      userId: string,
      email: string,
      displayName: string | null,
    ): OwedBucket => {
      let bucket = byUser.get(userId)
      if (!bucket) {
        bucket = { userId, email, displayName, totalOwedUsd: 0, lines: [] }
        byUser.set(userId, bucket)
      }
      return bucket
    }

    const ledgerItemIds = new Set<string>()
    for (const row of ledgerRows) {
      if (row.order_item_id != null) ledgerItemIds.add(String(row.order_item_id))
      const userId = String(row.user_id)
      const bucket = ensureBucket(
        userId,
        String(row.user_email ?? ''),
        typeof row.user_display_name === 'string' && row.user_display_name.trim()
          ? row.user_display_name.trim()
          : null,
      )
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

    // Accrue print pay for claimed/printed items paid this month (even before Mark printed),
    // and collect unclaimed estimated costs to split among money partners.
    const paidShopItems = await db.all<Record<string, unknown>>(
      `SELECT oi.id, oi.qty, oi.worst_cost_unit_usd, oi.reimburse_usd, oi.line_total_usd,
              oi.print_status, oi.assigned_admin_user_id, oi.sku, oi.color_name, oi.order_id,
              oi.completed_at, oi.claimed_at,
              d.name as design_name,
              o.total_usd, o.subtotal_usd, o.shipping_usd, o.paid_at,
              u.email as user_email, u.display_name as user_display_name
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       LEFT JOIN designs d ON d.id = oi.design_id
       LEFT JOIN users u ON u.id = oi.assigned_admin_user_id
       WHERE o.paid_at IS NOT NULL
         AND o.paid_at >= ? AND o.paid_at < ?
         AND o.status IN (${SHOP_ORDER_MONEY_STATUS_SQL})
         AND (COALESCE(o.payment_method, 'stripe') <> 'cash' OR o.cash_recorded_by IS NOT NULL)`,
      rangeStart,
      rangeEnd,
    )

    // Paid-share helpers per order (avoid N+1 sibling queries).
    const siblingsByOrder = new Map<string, number[]>()
    for (const item of paidShopItems) {
      const orderId = String(item.order_id)
      const list = siblingsByOrder.get(orderId) ?? []
      list.push(Number(item.line_total_usd) || 0)
      siblingsByOrder.set(orderId, list)
    }
    const itemPayEstimate = (item: Record<string, unknown>): number => {
      const itemsPaid = orderItemsPaidUsd(item)
      const lines = siblingsByOrder.get(String(item.order_id)) ?? []
      const lineSum = lines.reduce((s, n) => s + n, 0)
      const line = Number(item.line_total_usd) || 0
      const paidShare =
        itemsPaid <= 0
          ? 0
          : lineSum <= 0
            ? itemsPaid / Math.max(1, lines.length)
            : itemsPaid * (line / lineSum)
      const worst = Math.max(0, (Number(item.worst_cost_unit_usd) || 0) * (Number(item.qty) || 1))
      const recorded = item.reimburse_usd != null ? Number(item.reimburse_usd) : null
      if (recorded != null && Number.isFinite(recorded) && recorded >= 0) {
        return roundMoney(Math.min(recorded, paidShare > 0 ? paidShare : recorded))
      }
      return roundMoney(Math.min(worst, paidShare))
    }

    let unclaimedPrintCostUsd = 0
    for (const item of paidShopItems) {
      const amount = itemPayEstimate(item)
      if (amount <= 0) continue
      const status = String(item.print_status || '')
      const assignedId =
        item.assigned_admin_user_id != null ? String(item.assigned_admin_user_id) : ''
      const itemId = String(item.id)
      if (!assignedId || status === 'unclaimed') {
        unclaimedPrintCostUsd = roundMoney(unclaimedPrintCostUsd + amount)
        continue
      }
      if (ledgerItemIds.has(itemId)) continue
      const bucket = ensureBucket(
        assignedId,
        String(item.user_email ?? ''),
        typeof item.user_display_name === 'string' && item.user_display_name.trim()
          ? item.user_display_name.trim()
          : null,
      )
      bucket.totalOwedUsd = roundMoney(bucket.totalOwedUsd + amount)
      bucket.lines.push({
        id: `accrued-${itemId}`,
        amountUsd: amount,
        note:
          status === 'claimed'
            ? 'Accrued print pay (claimed — mark printed when done)'
            : 'Accrued print pay (printed)',
        createdAt: String(item.completed_at || item.claimed_at || item.paid_at || ''),
        orderId: String(item.order_id),
        designName: item.design_name != null ? String(item.design_name) : null,
        sku: item.sku != null ? String(item.sku) : null,
        colorName: item.color_name != null ? String(item.color_name) : null,
        qty: item.qty != null ? Number(item.qty) || null : null,
      })
    }

    // Custom paid prints have no claim flow yet — treat estimated cost as unclaimed pool.
    for (const o of customPaid) {
      const paid = Math.max(0, Number(o.catalog_price_usd) || 0)
      const cost = Math.max(0, Number(o.worst_cost_usd) || 0)
      unclaimedPrintCostUsd = roundMoney(unclaimedPrintCostUsd + Math.min(cost, paid))
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

    let owedByPerson = [...byUser.values()]
      .map((p) => ({
        ...p,
        printPayUsd: p.totalOwedUsd,
        profitShareUsd: 0,
        settlement: settledByUser.get(p.userId) ?? null,
      }))
      .sort((a, b) => b.totalOwedUsd - a.totalOwedUsd)

    // Assigned/ledger print pay so far (before unclaimed equal split).
    const assignedPrintPayUsd = roundMoney(
      owedByPerson.reduce((sum, p) => sum + p.printPayUsd, 0),
    )

    // What admins/printers earn (all combined): assigned print pay + unclaimed estimates.
    // Cap stays aligned with worst-case on paid items (discounts / free orders).
    const shopOrdersForCost = await db.all<Record<string, unknown>>(
      `SELECT o.id, o.total_usd, o.subtotal_usd, o.shipping_usd,
              COALESCE((
                SELECT SUM(oi.worst_cost_unit_usd * oi.qty) FROM order_items oi WHERE oi.order_id = o.id
              ), 0) as printer_cost_usd
       FROM orders o
       WHERE o.paid_at IS NOT NULL
         AND o.paid_at >= ? AND o.paid_at < ?
         AND o.status IN (${SHOP_ORDER_MONEY_STATUS_SQL})
         AND (COALESCE(o.payment_method, 'stripe') <> 'cash' OR o.cash_recorded_by IS NOT NULL)`,
      rangeStart,
      rangeEnd,
    )
    const shopPrinterCostUsd = roundMoney(
      shopOrdersForCost.reduce((sum, o) => {
        const itemsPaid = orderItemsPaidUsd(o)
        const printerCost = Math.max(0, Number(o.printer_cost_usd) || 0)
        return sum + Math.min(printerCost, itemsPaid)
      }, 0),
    )
    const customPrinterCostUsd = roundMoney(
      customPaid.reduce((sum, o) => {
        const paid = Math.max(0, Number(o.catalog_price_usd) || 0)
        const cost = Math.max(0, Number(o.worst_cost_usd) || 0)
        return sum + Math.min(cost, paid)
      }, 0),
    )
    const estimatedAdminsEarnUsd = roundMoney(shopPrinterCostUsd + customPrinterCostUsd)
    const reimbursementsTotalUsd = roundMoney(assignedPrintPayUsd + unclaimedPrintCostUsd)
    const adminsEarnAllUsd = roundMoney(
      Math.max(reimbursementsTotalUsd, estimatedAdminsEarnUsd),
    )
    // PrintX profit = items + shipping-kept-as-profit − printer pay − Stripe fees.
    // UPS pass-through shipping is excluded (not profit).
    const netEarnedUsd = roundMoney(
      Math.max(0, printxEarnedGrossUsd - shippingPassThroughUsd - stripeFeesUsd),
    )
    const businessKeptUsd = roundMoney(Math.max(0, netEarnedUsd - adminsEarnAllUsd))

    // Profit is split equally among admins with Money access (month-end split).
    const moneyAdmins = await db.all<{
      id: string
      email: string | null
      display_name: string | null
      permissions: string | null
    }>(`SELECT id, email, display_name, permissions FROM users WHERE role = 'admin'`)
    const partnerIds = moneyAdmins
      .filter((a) => {
        const perms = permissionsForUser(String(a.email || ''), (() => {
          try {
            return a.permissions ? JSON.parse(String(a.permissions)) : null
          } catch {
            return null
          }
        })(), a.id)
        return Boolean(perms.money)
      })
      .map((a) => a.id)
    const partnerCount = Math.max(1, partnerIds.length)
    const myProfitShareUsd = roundMoney(Math.max(0, businessKeptUsd) / partnerCount)
    // Unclaimed print costs (paid orders not yet claimed) split equally until someone claims.
    const unclaimedShareUsd = roundMoney(Math.max(0, unclaimedPrintCostUsd) / partnerCount)

    // Every money partner is owed print pay (assigned + unclaimed share) + profit share.
    const owedMap = new Map(owedByPerson.map((p) => [p.userId, p]))
    for (const a of moneyAdmins) {
      if (!partnerIds.includes(a.id)) continue
      const adminDisplayName =
        typeof a.display_name === 'string' && a.display_name.trim() ? a.display_name.trim() : null
      let person = owedMap.get(a.id)
      if (!person) {
        person = {
          userId: a.id,
          email: String(a.email ?? ''),
          displayName: adminDisplayName,
          totalOwedUsd: 0,
          printPayUsd: 0,
          profitShareUsd: 0,
          lines: [],
          settlement: settledByUser.get(a.id) ?? null,
        }
        owedMap.set(a.id, person)
        owedByPerson.push(person)
      } else if (!person.displayName && adminDisplayName) {
        person.displayName = adminDisplayName
      }
      const assignedPay = roundMoney(person.printPayUsd ?? person.totalOwedUsd ?? 0)
      if (unclaimedShareUsd > 0) {
        person.lines = [
          ...(person.lines ?? []),
          {
            id: `unclaimed-share-${a.id}-${yearMonth}`,
            amountUsd: unclaimedShareUsd,
            note: `Unclaimed print costs · equal split (${partnerCount} ways) until claimed`,
            createdAt: rangeStart,
            orderId: null,
            designName: null,
            sku: null,
            colorName: null,
            qty: null,
          },
        ]
      }
      person.printPayUsd = roundMoney(assignedPay + unclaimedShareUsd)
      person.profitShareUsd = myProfitShareUsd
      person.totalOwedUsd = roundMoney(person.printPayUsd + myProfitShareUsd)
    }
    owedByPerson = owedByPerson
      .map((p) => ({
        ...p,
        printPayUsd: roundMoney(p.printPayUsd ?? 0),
        profitShareUsd: roundMoney(p.profitShareUsd ?? 0),
        totalOwedUsd: roundMoney((p.printPayUsd ?? 0) + (p.profitShareUsd ?? 0)),
      }))
      .filter((p) => p.totalOwedUsd > 0 || p.settlement)
      .sort((a, b) => b.totalOwedUsd - a.totalOwedUsd)

    const myPrintPayUsd = roundMoney(
      owedByPerson.find((p) => p.userId === admin.id)?.printPayUsd ?? 0,
    )
    /** Total due to this admin: print pay + equal share of PrintX profit. */
    const youEarnTotalUsd = roundMoney(myPrintPayUsd + myProfitShareUsd)

    // Sequential — session pooler has one client; parallel queries queue/saturate it.
    const yearStripeUsd = await sumNetEarnedInRange(yearStart, yearEnd)
    const yearPrintPayUsd = await sumReimburseInRange(yearStart, yearEnd, admin.id)
    const yearReimbursementsUsd = await sumReimburseInRange(yearStart, yearEnd)
    const allTimeStripeUsd = await sumNetEarnedInRange(null, null)
    const allTimePrintPayUsd = await sumReimburseInRange(null, null, admin.id)
    const allTimeReimbursementsUsd = await sumReimburseInRange(null, null)

    // ISO timestamps → YYYY-MM via substr works on both SQLite and Postgres.
    // Per-order rows so Stripe fees (2.9% + $0.30 each) and shipping-to-profit are correct.
    const shopByMonthRows = await db.all<{
      ym: string
      total_usd: number | string | null
      shipping_usd: number | string | null
      shipping_to_profit_at: string | null
      payment_method: string | null
      item_earnings_usd: number | string | null
    }>(
      `SELECT substr(paid_at, 1, 7) as ym, total_usd, shipping_usd, shipping_to_profit_at, payment_method,
              ${shopItemEarningsSql} as item_earnings_usd
       FROM orders
       WHERE paid_at IS NOT NULL
         AND length(paid_at) >= 7
         AND status IN (${SHOP_ORDER_MONEY_STATUS_SQL})
         AND (COALESCE(payment_method, 'stripe') <> 'cash' OR cash_recorded_by IS NOT NULL)`,
    )
    const customByMonthRows = await db.all<{
      ym: string
      catalog_price_usd: number | string | null
      shipping_usd: number | string | null
      shipping_to_profit_at: string | null
    }>(
      `SELECT substr(paid_at, 1, 7) as ym, catalog_price_usd, shipping_usd, shipping_to_profit_at
       FROM custom_requests
       WHERE paid_at IS NOT NULL
         AND catalog_price_usd IS NOT NULL
         AND length(paid_at) >= 7`,
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
      /** Print pay only (ledger reimbursements). */
      printPayUsd: number
      /** Print pay + profit share — what is owed to this admin. */
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
          printPayUsd: 0,
          owedToMeUsd: 0,
          reimbursementsUsd: 0,
          mySettlement: null,
        }
        historyMap.set(key, bucket)
      }
      return bucket
    }
    for (const row of shopByMonthRows) {
      const bucket = ensureMonth(row.ym)
      if (bucket) {
        bucket.stripeUsd = roundMoney(bucket.stripeUsd + netEarnedFromShopRow(row))
      }
    }
    for (const row of customByMonthRows) {
      const bucket = ensureMonth(row.ym)
      if (bucket) {
        bucket.stripeUsd = roundMoney(bucket.stripeUsd + netEarnedFromCustomRow(row))
      }
    }
    for (const row of reimburseByMonth) {
      const bucket = ensureMonth(row.ym)
      if (bucket) {
        bucket.reimbursementsUsd = roundMoney(bucket.reimbursementsUsd + (Number(row.total) || 0))
      }
    }
    for (const row of owedToMeByMonth) {
      const bucket = ensureMonth(row.ym)
      if (bucket) bucket.printPayUsd = roundMoney(bucket.printPayUsd + (Number(row.total) || 0))
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

    // Owed = print pay + equal profit share. Current month uses live cost-capped profit;
    // other months approximate profit as net earned − recorded printer pay.
    for (const bucket of historyMap.values()) {
      let share = 0
      if (bucket.month === yearMonth) {
        share = myProfitShareUsd
        bucket.printPayUsd = myPrintPayUsd
        bucket.stripeUsd = netEarnedUsd
        bucket.reimbursementsUsd = adminsEarnAllUsd
      } else {
        bucket.stripeUsd = roundMoney(Math.max(0, bucket.stripeUsd))
        const profit = Math.max(0, bucket.stripeUsd - bucket.reimbursementsUsd)
        share = roundMoney(profit / partnerCount)
      }
      bucket.owedToMeUsd = roundMoney(bucket.printPayUsd + share)
    }

    const monthHistory = [...historyMap.values()].sort((a, b) => b.month.localeCompare(a.month))
    const yearOwedToMeUsd = roundMoney(
      monthHistory
        .filter((b) => b.month.startsWith(`${calendarYear}-`))
        .reduce((sum, b) => sum + b.owedToMeUsd, 0),
    )
    const allTimeOwedToMeUsd = roundMoney(
      monthHistory.reduce((sum, b) => sum + b.owedToMeUsd, 0),
    )

    send(res, 200, {
      month: yearMonth,
      earnings: {
        totalUsd: earningsTotalUsd,
        shopUsd: shopEarnings,
        customUsd: customEarnings,
        shopOrders: shopOrders.map((o) => {
          const charge = Math.max(0, Number(o.total_usd) || 0)
          return {
            id: String(o.id),
            kind: 'shop' as const,
            label: String(o.customer_name || o.customer_email || 'Customer'),
            email: String(o.customer_email ?? ''),
            amountUsd: roundMoney(Number(o.item_earnings_usd) || 0),
            shippingUsd: roundMoney(Number(o.shipping_usd) || 0),
            stripeFeeUsd: shopStripeFee(o),
            chargeUsd: roundMoney(charge),
            shippingToProfitAt:
              o.shipping_to_profit_at != null ? String(o.shipping_to_profit_at) : null,
            status: String(o.status ?? ''),
            paidAt: o.paid_at != null ? String(o.paid_at) : null,
            stripeSessionId: o.stripe_session_id != null ? String(o.stripe_session_id) : null,
          }
        }),
        customOrders: customPaid.map((o) => {
          const charge =
            Math.max(0, Number(o.catalog_price_usd) || 0) + Math.max(0, Number(o.shipping_usd) || 0)
          return {
            id: String(o.id),
            kind: 'custom' as const,
            label: String(o.name || o.email || 'Custom print'),
            email: String(o.email ?? ''),
            amountUsd: roundMoney(Number(o.catalog_price_usd) || 0),
            shippingUsd: roundMoney(Number(o.shipping_usd) || 0),
            stripeFeeUsd: stripeFeeOnChargeUsd(charge),
            chargeUsd: roundMoney(charge),
            shippingToProfitAt:
              o.shipping_to_profit_at != null ? String(o.shipping_to_profit_at) : null,
            status: String(o.status ?? ''),
            paidAt: o.paid_at != null ? String(o.paid_at) : null,
            stripeSessionId: o.stripe_session_id != null ? String(o.stripe_session_id) : null,
          }
        }),
      },
      owedByPerson,
      reimbursementsTotalUsd,
      adminsEarnAllUsd,
      shippingTotalUsd,
      shippingKeptAsProfitUsd,
      shippingCollectedUsd,
      stripeFeesUsd,
      printxEarnedGrossUsd,
      /** Net earned this month: items + shipping in profit − Stripe fees. */
      netEarnedUsd,
      businessKeptUsd,
      partnerCount,
      myPrintPayUsd,
      myProfitShareUsd,
      /** Total owed to you this month: print pay + equal share of PrintX profit. */
      youEarnTotalUsd,
      canSettle: admin.isMainAdmin,
      totals: {
        year: {
          year: calendarYear,
          stripeUsd: yearStripeUsd,
          owedToMeUsd: yearOwedToMeUsd,
          printPayUsd: yearPrintPayUsd,
          reimbursementsUsd: yearReimbursementsUsd,
        },
        allTime: {
          stripeUsd: allTimeStripeUsd,
          owedToMeUsd: allTimeOwedToMeUsd,
          printPayUsd: allTimePrintPayUsd,
          reimbursementsUsd: allTimeReimbursementsUsd,
        },
      },
      monthHistory,
    })
    return true
  }

  if (urlPath === '/api/admin/money/shipping-to-profit' && method === 'POST') {
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'money')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    await migrateShippingToProfit(db)
    const body = await readJson(req)
    const kind = body.kind === 'custom' ? 'custom' : body.kind === 'shop' ? 'shop' : ''
    const id = sanitizeText(String(body.id ?? ''), 80)
    const undo = Boolean(body.undo)
    if (!kind || !id) {
      send(res, 400, { error: 'kind (shop|custom) and id are required.' })
      return true
    }
    const table = kind === 'shop' ? 'orders' : 'custom_requests'
    const row = await db.get<{ id: string; shipping_usd: number | string | null; shipping_to_profit_at: string | null }>(
      `SELECT id, shipping_usd, shipping_to_profit_at FROM ${table} WHERE id = ?`,
      id,
    )
    if (!row) {
      send(res, 404, { error: 'Order not found.' })
      return true
    }
    const shipUsd = roundMoney(Number(row.shipping_usd) || 0)
    if (shipUsd <= 0) {
      send(res, 400, { error: 'This order has no shipping amount.' })
      return true
    }
    if (undo) {
      await db.run(`UPDATE ${table} SET shipping_to_profit_at = NULL WHERE id = ?`, id)
      send(res, 200, {
        ok: true,
        kind,
        id,
        shippingUsd: shipUsd,
        shippingToProfitAt: null,
      })
      return true
    }
    if (row.shipping_to_profit_at) {
      send(res, 200, {
        ok: true,
        kind,
        id,
        shippingUsd: shipUsd,
        shippingToProfitAt: String(row.shipping_to_profit_at),
      })
      return true
    }
    const now = new Date().toISOString()
    await db.run(`UPDATE ${table} SET shipping_to_profit_at = ? WHERE id = ?`, now, id)
    send(res, 200, {
      ok: true,
      kind,
      id,
      shippingUsd: shipUsd,
      shippingToProfitAt: now,
    })
    return true
  }

  if (urlPath === '/api/admin/money/settle' && method === 'POST') {
    const admin = await requireAdmin(req)
    if (!admin) {
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
    // Include equal PrintX profit share in what is marked paid (same split as Money page).
    await repairDiscountCappedPayouts(db)
    const settleShopItemSql = `LEAST(
      CASE WHEN COALESCE(subtotal_usd, 0) > 0 THEN subtotal_usd ELSE 1e18 END,
      GREATEST(0, COALESCE(total_usd, 0) - COALESCE(shipping_usd, 0))
    )`
    const shopEarnRow = await db.get<{ total: number | string | null }>(
      `SELECT COALESCE(SUM(${settleShopItemSql}), 0) as total FROM orders
       WHERE paid_at IS NOT NULL AND paid_at >= ? AND paid_at < ?
         AND status IN (${SHOP_ORDER_MONEY_STATUS_SQL})
         AND (COALESCE(payment_method, 'stripe') <> 'cash' OR cash_recorded_by IS NOT NULL)`,
      rangeStart,
      rangeEnd,
    )
    const customEarnRow = await db.get<{ total: number | string | null }>(
      `SELECT COALESCE(SUM(catalog_price_usd), 0) as total FROM custom_requests
       WHERE paid_at IS NOT NULL AND paid_at >= ? AND paid_at < ?
         AND catalog_price_usd IS NOT NULL`,
      rangeStart,
      rangeEnd,
    )
    const allPrintRow = await db.get<{ total: number | string | null }>(
      `SELECT COALESCE(SUM(amount_usd), 0) as total FROM profit_ledger
       WHERE entry_type = 'reimburse' AND created_at >= ? AND created_at < ?`,
      rangeStart,
      rangeEnd,
    )
    const shopCostRows = await db.all<Record<string, unknown>>(
      `SELECT o.total_usd, o.subtotal_usd, o.shipping_usd,
              COALESCE((
                SELECT SUM(oi.worst_cost_unit_usd * oi.qty) FROM order_items oi WHERE oi.order_id = o.id
              ), 0) as printer_cost_usd
       FROM orders o
       WHERE o.paid_at IS NOT NULL AND o.paid_at >= ? AND o.paid_at < ?
         AND o.status IN (${SHOP_ORDER_MONEY_STATUS_SQL})
         AND (COALESCE(o.payment_method, 'stripe') <> 'cash' OR o.cash_recorded_by IS NOT NULL)`,
      rangeStart,
      rangeEnd,
    )
    const customCostRows = await db.all<Record<string, unknown>>(
      `SELECT catalog_price_usd, worst_cost_usd FROM custom_requests
       WHERE paid_at IS NOT NULL AND paid_at >= ? AND paid_at < ?
         AND catalog_price_usd IS NOT NULL`,
      rangeStart,
      rangeEnd,
    )
    const shopPrinterCostUsd = roundMoney(
      shopCostRows.reduce((sum, o) => {
        const itemsPaid = orderItemsPaidUsd(o)
        const printerCost = Math.max(0, Number(o.printer_cost_usd) || 0)
        return sum + Math.min(printerCost, itemsPaid)
      }, 0),
    )
    const customPrinterCostUsd = roundMoney(
      customCostRows.reduce((sum, o) => {
        const paid = Math.max(0, Number(o.catalog_price_usd) || 0)
        const cost = Math.max(0, Number(o.worst_cost_usd) || 0)
        return sum + Math.min(cost, paid)
      }, 0),
    )
    const itemsEarned = roundMoney(
      (Number(shopEarnRow?.total) || 0) + (Number(customEarnRow?.total) || 0),
    )
    await migrateShippingToProfit(db)
    const shipKeptShop = await db.get<{ total: number | string | null }>(
      `SELECT COALESCE(SUM(shipping_usd), 0) as total FROM orders
       WHERE paid_at IS NOT NULL AND paid_at >= ? AND paid_at < ?
         AND status IN (${SHOP_ORDER_MONEY_STATUS_SQL})
         AND (COALESCE(payment_method, 'stripe') <> 'cash' OR cash_recorded_by IS NOT NULL)
         AND shipping_to_profit_at IS NOT NULL`,
      rangeStart,
      rangeEnd,
    )
    const shipKeptCustom = await db.get<{ total: number | string | null }>(
      `SELECT COALESCE(SUM(shipping_usd), 0) as total FROM custom_requests
       WHERE paid_at IS NOT NULL AND paid_at >= ? AND paid_at < ?
         AND catalog_price_usd IS NOT NULL
         AND shipping_to_profit_at IS NOT NULL`,
      rangeStart,
      rangeEnd,
    )
    const shippingKept = roundMoney(
      (Number(shipKeptShop?.total) || 0) + (Number(shipKeptCustom?.total) || 0),
    )
    const shopTotals = await db.all<{ total_usd: number | string | null; payment_method: string | null }>(
      `SELECT total_usd, payment_method FROM orders
       WHERE paid_at IS NOT NULL AND paid_at >= ? AND paid_at < ?
         AND status IN (${SHOP_ORDER_MONEY_STATUS_SQL})
         AND (COALESCE(payment_method, 'stripe') <> 'cash' OR cash_recorded_by IS NOT NULL)`,
      rangeStart,
      rangeEnd,
    )
    const customTotals = await db.all<{
      catalog_price_usd: number | string | null
      shipping_usd: number | string | null
    }>(
      `SELECT catalog_price_usd, shipping_usd FROM custom_requests
       WHERE paid_at IS NOT NULL AND paid_at >= ? AND paid_at < ?
         AND catalog_price_usd IS NOT NULL`,
      rangeStart,
      rangeEnd,
    )
    const settleStripeFees = roundMoney(
      shopTotals.reduce((sum, o) => sum + shopStripeFee(o), 0) +
        customTotals.reduce((sum, o) => {
          const charge =
            Math.max(0, Number(o.catalog_price_usd) || 0) + Math.max(0, Number(o.shipping_usd) || 0)
          return sum + stripeFeeOnChargeUsd(charge)
        }, 0),
    )
    const estimatedPrinterPay = roundMoney(shopPrinterCostUsd + customPrinterCostUsd)
    const adminsEarnAll = roundMoney(
      Math.max(Number(allPrintRow?.total) || 0, estimatedPrinterPay),
    )
    const businessKept = roundMoney(
      Math.max(0, itemsEarned + shippingKept - adminsEarnAll - settleStripeFees),
    )
    const moneyAdmins = await db.all<{ id: string; email: string | null; permissions: string | null }>(
      `SELECT id, email, permissions FROM users WHERE role = 'admin'`,
    )
    const partnerCount = Math.max(
      1,
      moneyAdmins.filter((a) => {
        const perms = permissionsForUser(String(a.email || ''), (() => {
          try {
            return a.permissions ? JSON.parse(String(a.permissions)) : null
          } catch {
            return null
          }
        })(), a.id)
        return Boolean(perms.money)
      }).length,
    )
    const profitShareUsd = roundMoney(businessKept / partnerCount)

    // Match Money page print pay: ledger + accrued assigned + equal share of unclaimed.
    const ledgerPayRow = await db.get<{ total: number | string | null }>(
      `SELECT COALESCE(SUM(amount_usd), 0) as total FROM profit_ledger
       WHERE entry_type = 'reimburse' AND user_id = ? AND created_at >= ? AND created_at < ?`,
      userId,
      rangeStart,
      rangeEnd,
    )
    const ledgerItemIds = new Set(
      (
        await db.all<{ order_item_id: string | null }>(
          `SELECT order_item_id FROM profit_ledger
           WHERE entry_type = 'reimburse' AND created_at >= ? AND created_at < ?
             AND order_item_id IS NOT NULL`,
          rangeStart,
          rangeEnd,
        )
      ).map((r) => String(r.order_item_id)),
    )
    const settleItemsFull = await db.all<Record<string, unknown>>(
      `SELECT oi.id, oi.order_id, oi.qty, oi.worst_cost_unit_usd, oi.reimburse_usd, oi.line_total_usd,
              oi.print_status, oi.assigned_admin_user_id,
              o.total_usd, o.subtotal_usd, o.shipping_usd
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       WHERE o.paid_at IS NOT NULL AND o.paid_at >= ? AND o.paid_at < ?
         AND o.status IN (${SHOP_ORDER_MONEY_STATUS_SQL})
         AND (COALESCE(o.payment_method, 'stripe') <> 'cash' OR o.cash_recorded_by IS NOT NULL)`,
      rangeStart,
      rangeEnd,
    )
    const sibMap = new Map<string, number[]>()
    for (const item of settleItemsFull) {
      const oid = String(item.order_id)
      const list = sibMap.get(oid) ?? []
      list.push(Number(item.line_total_usd) || 0)
      sibMap.set(oid, list)
    }
    let assignedAccrued = 0
    let unclaimedPool = 0
    for (const item of settleItemsFull) {
      const itemsPaid = orderItemsPaidUsd(item)
      const lines = sibMap.get(String(item.order_id)) ?? []
      const lineSum = lines.reduce((s, n) => s + n, 0)
      const line = Number(item.line_total_usd) || 0
      const paidShare =
        itemsPaid <= 0
          ? 0
          : lineSum <= 0
            ? itemsPaid / Math.max(1, lines.length)
            : itemsPaid * (line / lineSum)
      const worst = Math.max(0, (Number(item.worst_cost_unit_usd) || 0) * (Number(item.qty) || 1))
      const recorded = item.reimburse_usd != null ? Number(item.reimburse_usd) : null
      const amount =
        recorded != null && Number.isFinite(recorded) && recorded >= 0
          ? roundMoney(Math.min(recorded, paidShare > 0 ? paidShare : recorded))
          : roundMoney(Math.min(worst, paidShare))
      if (amount <= 0) continue
      const status = String(item.print_status || '')
      const assigned = item.assigned_admin_user_id != null ? String(item.assigned_admin_user_id) : ''
      if (!assigned || status === 'unclaimed') {
        unclaimedPool = roundMoney(unclaimedPool + amount)
        continue
      }
      if (ledgerItemIds.has(String(item.id))) continue
      if (assigned === userId) assignedAccrued = roundMoney(assignedAccrued + amount)
    }
    for (const row of customCostRows) {
      const paid = Math.max(0, Number(row.catalog_price_usd) || 0)
      const cost = Math.max(0, Number(row.worst_cost_usd) || 0)
      unclaimedPool = roundMoney(unclaimedPool + Math.min(cost, paid))
    }
    const printPayUsd = roundMoney(
      (Number(ledgerPayRow?.total) || 0) + assignedAccrued + unclaimedPool / partnerCount,
    )
    const amountUsd = roundMoney(printPayUsd + profitShareUsd)
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
    let settlementId = existing?.id
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
    } else {
      settlementId = randomUUID()
      await db.run(
        `INSERT INTO printer_settlements
           (id, user_id, year_month, amount_usd, marked_paid_at, marked_by, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        settlementId,
        userId,
        yearMonth,
        amountUsd,
        now,
        admin.id,
        note,
      )
    }
    runInBackground('push-money-settle', () =>
      notifyAdminUsers(db, [userId], {
        title: 'Money settled',
        body: `$${amountUsd.toFixed(2)} owed for ${yearMonth} was marked paid`,
        url: '/money',
      }),
    )
    send(res, 200, {
      ok: true,
      id: settlementId,
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
