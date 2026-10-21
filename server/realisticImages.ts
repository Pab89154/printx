/**
 * Realistic catalog photos, one per offered color.
 *
 * Provider: Manus (MANUS_API_KEY) when set — a Manus agent task receives the
 * STL render and returns a photorealistic product photo as an attachment.
 * Magic Hour (MAGIC_HOUR_API_KEY) remains as a fallback when no Manus key is
 * configured. Keys are Worker secrets — never sent to clients.
 *
 * Flow (state stored per design+color in design_realistic_images so the
 * Cloudflare cron can resume it; the main color mirrors onto the design row):
 *   pending  → render the STL to a white-background PNG and start generation
 *   processing → poll; when complete, download the result into storage and
 *              point the color's image_url at it
 *   ready / error
 */
import { createHash } from 'node:crypto'
import type { DbApi } from './dbClient.ts'
import { getPricingSettings, rowToDesign, type Design } from './catalog.ts'
import { colorById } from '../shared/colors.ts'
import { readStoredFileBuffer, uploadStoredBuffer } from './objectStorage.ts'
import { renderStlPartsPng } from './stlRender.ts'

const API_BASE = 'https://api.magichour.ai/v1'
const MANUS_API_BASE = 'https://api.manus.ai/v2'
const STALE_RENDER_MS = 20 * 60_000

export function magicHourConfigured(): boolean {
  return Boolean((process.env.MAGIC_HOUR_API_KEY || '').trim())
}

export function manusConfigured(): boolean {
  return Boolean((process.env.MANUS_API_KEY || '').trim())
}

/** Manus wins when its key is set; Magic Hour is the legacy fallback. */
export function imageProvider(): 'manus' | 'magic' | null {
  if (manusConfigured()) return 'manus'
  if (magicHourConfigured()) return 'magic'
  return null
}

function apiKey(): string {
  return (process.env.MAGIC_HOUR_API_KEY || '').trim()
}

function manusApiKey(): string {
  return (process.env.MANUS_API_KEY || '').trim()
}

async function manusFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('x-manus-api-key', manusApiKey())
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  return fetch(`${MANUS_API_BASE}${path}`, { ...init, headers })
}

async function manusError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: { message?: string; code?: string } }
    return String(data.error?.message || data.error?.code || `${res.status} ${res.statusText}`)
  } catch {
    return `${res.status} ${res.statusText}`
  }
}

function imageModel(): string {
  return (process.env.MAGIC_HOUR_IMAGE_MODEL || 'flux-2-klein').trim() || 'flux-2-klein'
}

function imageResolution(): string {
  return (process.env.MAGIC_HOUR_IMAGE_RESOLUTION || '640px').trim() || '640px'
}

async function magicFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${apiKey()}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  return fetch(`${API_BASE}${path}`, { ...init, headers })
}

async function magicError(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { message?: string; code?: string }
    return String(data.message || data.code || `${res.status} ${res.statusText}`)
  } catch {
    return `${res.status} ${res.statusText}`
  }
}

type PartChoice = { label: string; stlPath: string; colorId: string; colorName: string; colorHex: string }

/** Pricing settings change rarely — cache briefly so a queue pass over every
 * design+color does not re-query them for every single color. */
let settingsCache: {
  at: number
  value: Awaited<ReturnType<typeof getPricingSettings>>
} | null = null

async function pricingSettings(db: DbApi) {
  if (settingsCache && Date.now() - settingsCache.at < 60_000) return settingsCache.value
  const value = await getPricingSettings(db)
  settingsCache = { at: Date.now(), value }
  return value
}

async function partChoices(db: DbApi, design: Design, forcedColorId = ''): Promise<PartChoice[]> {
  const settings = await pricingSettings(db)
  const solids = design.availableColorIds.filter((id) => id !== 'multicolor')
  const colorFor = (id: string, fallbackIndex: number) => {
    const picked = id && solids.includes(id) ? id : solids[fallbackIndex % Math.max(solids.length, 1)] || 'black'
    return colorById(picked, settings.customColors) ?? colorById('black', settings.customColors)!
  }
  if (design.multicolorOnly && design.parts.length) {
    return design.parts
      .filter((p) => p.stlPath.trim())
      .map((p, i) => {
        // Use the admin's first allowed color for this part when one is set.
        const c = colorFor(p.colorIds?.[0] || '', i)
        return { label: p.label, stlPath: p.stlPath, colorId: c.id, colorName: c.name, colorHex: c.hex }
      })
  }
  const c = colorFor(forcedColorId || design.mainColorId, 0)
  return [{ label: design.name, stlPath: design.stlPath, colorId: c.id, colorName: c.name, colorHex: c.hex }]
}

/** Color key of the design's main photo ('multicolor' for multicolor prints). */
export function primaryRealisticColorKey(design: Design): string {
  if (design.multicolorOnly) return 'multicolor'
  const solids = design.availableColorIds.filter((id) => id !== 'multicolor')
  if (design.mainColorId && solids.includes(design.mainColorId)) return design.mainColorId
  return solids[0] || design.mainColorId || 'black'
}

export type RealisticColorImageRow = {
  design_id: string
  color_key: string
  image_url: string
  status: string
  error: string
  project_id: string
  source: string
  updated_at: string | null
}

type ColorJob = { key: string; choices: PartChoice[] }

/**
 * One generation job per offered color. Multicolor prints keep a single
 * 'multicolor' job in the designer's per-part colors (color combos are
 * endless); single-color designs get one job for every offered color.
 */
async function colorJobs(db: DbApi, design: Design): Promise<ColorJob[]> {
  if (design.multicolorOnly) {
    return [{ key: 'multicolor', choices: await partChoices(db, design) }]
  }
  const solids = design.availableColorIds.filter((id) => id !== 'multicolor')
  const ids = solids.length ? solids : [design.mainColorId || 'black']
  const jobs: ColorJob[] = []
  const seen = new Set<string>()
  for (const id of ids) {
    const choices = await partChoices(db, design, id)
    const key = choices[0]?.colorId || id
    if (seen.has(key)) continue
    seen.add(key)
    jobs.push({ key, choices })
  }
  return jobs
}

function signatureForChoices(design: Design, choices: PartChoice[]): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        name: design.name,
        parts: choices.map((c) => ({ path: c.stlPath, label: c.label, color: c.colorId })),
        // Switching provider (or Magic Hour model) re-generates every color;
        // the previous photo stays up until the new one is ready.
        provider: imageProvider() ?? 'none',
        model: imageModel(),
        resolution: imageResolution(),
      }),
    )
    .digest('hex')
    .slice(0, 24)
}

/** Everything that should change the generated photo when it changes. */
export async function realisticImageSignature(db: DbApi, design: Design): Promise<string> {
  const choices = await partChoices(
    db,
    design,
    design.multicolorOnly ? '' : primaryRealisticColorKey(design),
  )
  return signatureForChoices(design, choices)
}

let tableReady: Promise<void> | null = null

/** Per-color generated photos. Self-heals like the design columns above. */
export async function ensureRealisticImagesTable(db: DbApi): Promise<void> {
  if (!tableReady) {
    tableReady = (async () => {
      try {
        await db.exec(
          `CREATE TABLE IF NOT EXISTS design_realistic_images (
            design_id TEXT NOT NULL,
            color_key TEXT NOT NULL,
            image_url TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'pending',
            error TEXT NOT NULL DEFAULT '',
            project_id TEXT NOT NULL DEFAULT '',
            source TEXT NOT NULL DEFAULT '',
            updated_at TEXT,
            PRIMARY KEY (design_id, color_key)
          )`,
        )
      } catch {
        /* table already exists */
      }
    })()
  }
  await tableReady
}

/** Ready + in-progress per-color photos, grouped by design id. */
export async function listRealisticColorImages(
  db: DbApi,
): Promise<Map<string, RealisticColorImageRow[]>> {
  const out = new Map<string, RealisticColorImageRow[]>()
  try {
    await ensureRealisticImagesTable(db)
    const rows = await db.all<RealisticColorImageRow>(
      `SELECT design_id, color_key, image_url, status, error, project_id, source, updated_at
       FROM design_realistic_images`,
    )
    for (const row of rows) {
      const list = out.get(String(row.design_id)) ?? []
      list.push(row)
      out.set(String(row.design_id), list)
    }
  } catch {
    /* table unavailable — catalog falls back to the main photo */
  }
  return out
}

async function getColorRow(
  db: DbApi,
  designId: string,
  colorKey: string,
): Promise<RealisticColorImageRow | null> {
  try {
    const row = await db.get<RealisticColorImageRow>(
      `SELECT design_id, color_key, image_url, status, error, project_id, source, updated_at
       FROM design_realistic_images WHERE design_id = ? AND color_key = ?`,
      designId,
      colorKey,
    )
    return row ?? null
  } catch {
    return null
  }
}

async function upsertColorRow(
  db: DbApi,
  designId: string,
  colorKey: string,
  fields: { url: string; status: string; error: string; projectId: string; source: string },
): Promise<void> {
  await db.run(
    `INSERT INTO design_realistic_images (design_id, color_key, image_url, status, error, project_id, source, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (design_id, color_key) DO UPDATE SET
       image_url = excluded.image_url,
       status = excluded.status,
       error = excluded.error,
       project_id = excluded.project_id,
       source = excluded.source,
       updated_at = excluded.updated_at`,
    designId,
    colorKey,
    fields.url,
    fields.status,
    fields.error,
    fields.projectId,
    fields.source,
    new Date().toISOString(),
  )
}

/**
 * Mark every offered color of a design as needing a realistic image when its
 * model/colors changed (or when forced). Keeps a color's current photo on a
 * forced refresh of the same model/color. Also mirrors the main color's job
 * onto the design row (legacy single-photo fields).
 */
export async function queueDesignRealisticImage(
  db: DbApi,
  design: Design,
  opts: { force?: boolean } = {},
): Promise<boolean> {
  // Manual-photos designs NEVER spend paid image-API credits.
  if (design.manualPhotos) return false
  if (!design.stlPath.trim() && !design.parts.some((p) => p.stlPath.trim())) return false
  if (!imageProvider()) return false
  await ensureRealisticImagesTable(db)
  const jobs = await colorJobs(db, design)
  const primaryKey = primaryRealisticColorKey(design)
  let queued = false
  for (const job of jobs) {
    const signature = signatureForChoices(design, job.choices)
    let row = await getColorRow(db, design.id, job.key)
    // Seed the per-color table from the photo generated before per-color
    // images existed, so the main color is not generated (and paid for) twice.
    if (
      !row &&
      job.key === primaryKey &&
      design.realisticImageUrl &&
      design.realisticImageSource === signature
    ) {
      await upsertColorRow(db, design.id, job.key, {
        url: design.realisticImageUrl,
        status: 'ready',
        error: '',
        projectId: '',
        source: signature,
      })
      row = await getColorRow(db, design.id, job.key)
    }
    if (row) {
      const active =
        row.status === 'pending' || row.status === 'rendering' || row.status === 'processing'
      // A failed job keeps its signature so cron does not retry (and re-pay
      // for) the same model/color forever; a change produces a new signature.
      if (!opts.force && row.source === signature && (row.status === 'ready' || active || row.status === 'error')) {
        continue
      }
      if (!opts.force && active) continue
      // Keep showing the current photo until its replacement is ready.
      const keepUrl = String(row.image_url || '')
      await upsertColorRow(db, design.id, job.key, {
        url: keepUrl,
        status: 'pending',
        error: '',
        projectId: '',
        source: signature,
      })
      queued = true
      if (job.key === primaryKey) {
        await db.run(
          `UPDATE designs SET
             realistic_image_status = 'pending',
             realistic_image_error = '',
             realistic_image_project_id = '',
             realistic_image_source = ?,
             realistic_image_url = ?,
             realistic_image_updated_at = ?
           WHERE id = ?`,
          signature,
          keepUrl,
          new Date().toISOString(),
          design.id,
        )
      }
    } else {
      await upsertColorRow(db, design.id, job.key, {
        url: '',
        status: 'pending',
        error: '',
        projectId: '',
        source: signature,
      })
      queued = true
      if (job.key === primaryKey) {
        await db.run(
          `UPDATE designs SET
             realistic_image_status = 'pending',
             realistic_image_error = '',
             realistic_image_project_id = '',
             realistic_image_source = ?,
             realistic_image_url = ?,
             realistic_image_updated_at = ?
           WHERE id = ?`,
          signature,
          design.realisticImageUrl || '',
          new Date().toISOString(),
          design.id,
        )
      }
    }
  }
  return queued
}

/**
 * Re-queue ONE color's photo (an admin "redo" of a single color, not the
 * whole design). The current photo stays up until the replacement is ready.
 * Returns false when that color is not offered for the design.
 */
export async function queueRealisticImageForColor(
  db: DbApi,
  design: Design,
  colorKeyRaw: string,
): Promise<boolean> {
  // Manual-photos designs NEVER spend paid image-API credits (Redo included).
  if (design.manualPhotos) return false
  if (!design.stlPath.trim() && !design.parts.some((p) => p.stlPath.trim())) return false
  if (!imageProvider()) return false
  await ensureRealisticImagesTable(db)
  const jobs = await colorJobs(db, design)
  const job = jobs.find((j) => j.key === colorKeyRaw.trim())
  if (!job) return false
  const signature = signatureForChoices(design, job.choices)
  const row = await getColorRow(db, design.id, job.key)
  const keepUrl = row
    ? String(row.image_url || '')
    : job.key === primaryRealisticColorKey(design)
      ? design.realisticImageUrl || ''
      : ''
  await upsertColorRow(db, design.id, job.key, {
    url: keepUrl,
    status: 'pending',
    error: '',
    projectId: '',
    source: signature,
  })
  if (job.key === primaryRealisticColorKey(design)) {
    await db.run(
      `UPDATE designs SET
         realistic_image_status = 'pending',
         realistic_image_error = '',
         realistic_image_project_id = '',
         realistic_image_source = ?,
         realistic_image_url = ?,
         realistic_image_updated_at = ?
       WHERE id = ?`,
      signature,
      keepUrl,
      new Date().toISOString(),
      design.id,
    )
  }
  return true
}

/**
 * Use an admin-uploaded photo for ONE color instead of a generated one.
 * Stored with the current signature, so the generator treats it as
 * up-to-date and leaves it alone until the model/colors actually change.
 * Returns false when that color is not offered for the design.
 */
export async function setUploadedColorImage(
  db: DbApi,
  design: Design,
  colorKeyRaw: string,
  imageUrl: string,
): Promise<boolean> {
  await ensureRealisticImagesTable(db)
  const rawKey = String(colorKeyRaw ?? '').trim()
  // Multicolor combo photo: the key is one color id per part joined with
  // '+' in part order (e.g. 'white+black' for inside+outside). Parts whose
  // label says the color does not matter are left out — they never change
  // the photo. The shop builds the same key from the customer's picks.
  if (design.multicolorOnly && rawKey.includes('+')) {
    const slotParts = design.parts.filter((p) => !/does not matter/i.test(p.label || ''))
    const ids = rawKey.split('+').map((s) => s.trim()).filter(Boolean)
    if (ids.length < 2 || ids.length !== slotParts.length) return false
    const solids = design.availableColorIds.filter((id) => id !== 'multicolor')
    const valid = ids.every((id, i) => {
      if (!solids.includes(id)) return false
      const allowed = (slotParts[i]?.colorIds ?? []).filter((c) => c !== 'multicolor')
      return !allowed.length || allowed.includes(id)
    })
    if (!valid) return false
    await upsertColorRow(db, design.id, ids.join('+'), {
      url: imageUrl,
      status: 'ready',
      error: '',
      projectId: '',
      source: 'manual-upload',
    })
    return true
  }
  const jobs = await colorJobs(db, design)
  const job = jobs.find((j) => j.key === String(colorKeyRaw ?? '').trim())
  if (!job) return false
  const signature = signatureForChoices(design, job.choices)
  await upsertColorRow(db, design.id, job.key, {
    url: imageUrl,
    status: 'ready',
    error: '',
    projectId: '',
    source: signature,
  })
  if (job.key === primaryRealisticColorKey(design)) {
    await setStatus(db, design.id, 'ready', { url: imageUrl, source: signature })
  }
  return true
}

let columnsReady: Promise<void> | null = null

/** Workers run the full schema migration in the background; self-heal the
 * few columns this feature needs so a slow migration cannot stall generation. */
async function ensureRealisticImageColumns(db: DbApi): Promise<void> {
  if (!columnsReady) {
    columnsReady = (async () => {
      for (const [name, def] of [
        ['realistic_image_url', `TEXT NOT NULL DEFAULT ''`],
        ['realistic_image_status', `TEXT NOT NULL DEFAULT 'idle'`],
        ['realistic_image_error', `TEXT NOT NULL DEFAULT ''`],
        ['realistic_image_project_id', `TEXT NOT NULL DEFAULT ''`],
        ['realistic_image_source', `TEXT NOT NULL DEFAULT ''`],
        ['realistic_image_updated_at', `TEXT`],
      ] as const) {
        try {
          await db.exec(`ALTER TABLE designs ADD COLUMN ${name} ${def}`)
        } catch {
          /* column already exists */
        }
      }
    })()
  }
  await columnsReady
}

async function setStatus(
  db: DbApi,
  designId: string,
  status: string,
  extra: { error?: string; projectId?: string; url?: string; source?: string } = {},
): Promise<void> {
  await db.run(
    `UPDATE designs SET
       realistic_image_status = ?,
       realistic_image_error = ?,
       realistic_image_project_id = COALESCE(?, realistic_image_project_id),
       realistic_image_url = COALESCE(?, realistic_image_url),
       realistic_image_source = COALESCE(?, realistic_image_source),
       realistic_image_updated_at = ?
     WHERE id = ?`,
    status,
    extra.error ?? '',
    extra.projectId ?? null,
    extra.url ?? null,
    extra.source ?? null,
    new Date().toISOString(),
    designId,
  )
}

/** Update one color's job; the main color also mirrors onto the design row. */
async function setColorStatus(
  db: DbApi,
  design: Design,
  colorKey: string,
  status: string,
  extra: { error?: string; projectId?: string; url?: string; source?: string } = {},
): Promise<void> {
  await db.run(
    `UPDATE design_realistic_images SET
       status = ?,
       error = ?,
       project_id = COALESCE(?, project_id),
       image_url = COALESCE(?, image_url),
       source = COALESCE(?, source),
       updated_at = ?
     WHERE design_id = ? AND color_key = ?`,
    status,
    extra.error ?? '',
    extra.projectId ?? null,
    extra.url ?? null,
    extra.source ?? null,
    new Date().toISOString(),
    design.id,
    colorKey,
  )
  if (colorKey === primaryRealisticColorKey(design)) {
    await setStatus(db, design.id, status, extra)
  }
}

async function startProject(
  db: DbApi,
  design: Design,
  colorRow: RealisticColorImageRow,
): Promise<void> {
  const colorKey = String(colorRow.color_key)
  await db.run(
    `UPDATE design_realistic_images SET status = 'rendering', updated_at = ?
     WHERE design_id = ? AND color_key = ? AND status = 'pending'`,
    new Date().toISOString(),
    design.id,
    colorKey,
  )
  const freshRow = await getColorRow(db, design.id, colorKey)
  if (!freshRow || String(freshRow.status) !== 'rendering') return
  const fresh = await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', design.id)
  if (!fresh) return
  const current = rowToDesign(fresh)

  try {
    const jobs = await colorJobs(db, current)
    const job = jobs.find((j) => j.key === colorKey)
    if (!job) throw new Error('That color is no longer offered for this design.')
    const choices = job.choices
    const renderParts: { buffer: Buffer; colorHex: string }[] = []
    for (const choice of choices) {
      const buffer = await readStoredFileBuffer(choice.stlPath)
      if (!buffer) throw new Error(`Model file missing on server: ${choice.stlPath}`)
      renderParts.push({ buffer, colorHex: choice.colorHex })
    }
    const sourcePng = renderStlPartsPng(renderParts, 768)

    const colorText = current.multicolorOnly
      ? choices.map((c) => `${c.label}: ${c.colorName}`).join(', ')
      : choices[0]?.colorName || 'the color shown'
    const prompt = [
      `Transform this exact 3D model render into a photorealistic product photograph of the same physical object after it has been 3D printed in matte PLA plastic.`,
      `The object is "${current.name}". Preserve the exact silhouette, proportions, orientation, geometry, details, and part boundaries from the reference image. Do not add, remove, reshape, rename, or decorate anything.`,
      `Keep these printed colors exactly: ${colorText}. Add only subtle realistic FDM layer lines, gentle plastic texture, and accurate edges.`,
      `Center the object on a seamless pure white background with bright studio lighting and a soft natural contact shadow. No people, hands, props, text, logos, packaging, or extra objects. Clean ecommerce catalog photo, square composition.`,
    ].join(' ')

    if (imageProvider() === 'manus') {
      const taskRes = await manusFetch('/task.create', {
        method: 'POST',
        body: JSON.stringify({
          title: `PrintX photo — ${current.name} (${colorKey})`.slice(0, 120),
          hide_in_task_list: true,
          ...(process.env.MANUS_AGENT_PROFILE?.trim()
            ? { agent_profile: process.env.MANUS_AGENT_PROFILE.trim() }
            : {}),
          message: {
            content: [
              {
                type: 'text',
                text:
                  `${prompt} Use your image generation/editing capability on the attached reference render. ` +
                  `When the image is finished, attach the final image file (PNG or JPG) to your reply — a text-only reply does not count as done.`,
              },
              {
                type: 'file',
                file_data: `data:image/png;base64,${sourcePng.toString('base64')}`,
                filename: `printx-${current.id}-${colorKey}.png`,
                mime_type: 'image/png',
              },
            ],
          },
        }),
      })
      if (!taskRes.ok) throw new Error(`Manus task failed: ${await manusError(taskRes)}`)
      const created = (await taskRes.json()) as { ok?: boolean; task_id?: string }
      if (!created.ok || !created.task_id) throw new Error('Manus did not return a task id.')
      await setColorStatus(db, current, colorKey, 'processing', { projectId: created.task_id })
      return
    }

    const uploadRes = await magicFetch('/files/upload-urls', {
      method: 'POST',
      body: JSON.stringify({ items: [{ type: 'image', extension: 'png' }] }),
    })
    if (!uploadRes.ok) throw new Error(`Magic Hour upload setup failed: ${await magicError(uploadRes)}`)
    const uploadData = (await uploadRes.json()) as {
      items?: { upload_url?: string; file_path?: string }[]
    }
    const upload = uploadData.items?.[0]
    if (!upload?.upload_url || !upload.file_path) throw new Error('Magic Hour did not return an upload URL.')
    const putRes = await fetch(upload.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: new Uint8Array(sourcePng),
    })
    if (!putRes.ok) throw new Error(`Magic Hour source upload failed (${putRes.status}).`)

    const createRes = await magicFetch('/ai-image-editor', {
      method: 'POST',
      body: JSON.stringify({
        name: `PrintX realistic preview — ${current.name}`.slice(0, 120),
        image_count: 1,
        model: imageModel(),
        aspect_ratio: '1:1',
        resolution: imageResolution(),
        style: { prompt },
        assets: { image_file_paths: [upload.file_path] },
      }),
    })
    if (!createRes.ok) throw new Error(`Magic Hour generation failed: ${await magicError(createRes)}`)
    const created = (await createRes.json()) as { id?: string }
    if (!created.id) throw new Error('Magic Hour did not return a project id.')
    await setColorStatus(db, current, colorKey, 'processing', { projectId: created.id })
  } catch (err) {
    await setColorStatus(db, current, colorKey, 'error', {
      error: err instanceof Error ? err.message : 'Realistic image generation failed.',
    })
  }
}

/** Download a finished generated image into storage and mark the color ready. */
async function storeGeneratedImage(
  db: DbApi,
  design: Design,
  colorKey: string,
  colorRow: RealisticColorImageRow,
  downloadUrl: string,
): Promise<void> {
  const imgRes = await fetch(downloadUrl)
  if (!imgRes.ok) throw new Error(`Could not download the generated image (${imgRes.status}).`)
  const bytes = Buffer.from(await imgRes.arrayBuffer())
  if (!bytes.length) throw new Error('The generated image was empty.')
  const contentType = (imgRes.headers.get('content-type') || '').toLowerCase()
  const ext = contentType.includes('jpeg') || contentType.includes('jpg')
    ? 'jpg'
    : contentType.includes('webp')
      ? 'webp'
      : 'png'
  const jobs = await colorJobs(db, design)
  const job = jobs.find((j) => j.key === colorKey)
  const signature = job ? signatureForChoices(design, job.choices) : String(colorRow.source || '')
  const fileName = `realistic-${design.id}-${colorKey}-${signature.slice(0, 12)}.${ext}`
  await uploadStoredBuffer(bytes, fileName, contentType || `image/${ext}`)
  await setColorStatus(db, design, colorKey, 'ready', {
    url: `/api/public/uploads/${fileName}`,
    source: signature,
  })
}

type ManusEvent = {
  type?: string
  assistant_message?: {
    content?: string
    attachments?: {
      type?: string
      filename?: string
      url?: string
      content_type?: string
    }[]
  }
  status_update?: { agent_status?: string }
  error_message?: { content?: string }
}

async function pollManusProject(
  db: DbApi,
  design: Design,
  colorRow: RealisticColorImageRow,
): Promise<void> {
  const colorKey = String(colorRow.color_key)
  const taskId = String(colorRow.project_id || '').trim()
  if (!taskId) {
    await setColorStatus(db, design, colorKey, 'pending')
    return
  }
  try {
    const res = await manusFetch(
      `/task.listMessages?task_id=${encodeURIComponent(taskId)}&order=desc&limit=30`,
    )
    // A Magic Hour-era project id means this row predates the Manus switch.
    if (res.status === 400 || res.status === 404) {
      await setColorStatus(db, design, colorKey, 'error', {
        error: 'Manus could not find that generation task. It will be retried.',
      })
      return
    }
    if (!res.ok) throw new Error(`Manus status failed: ${await manusError(res)}`)
    const data = (await res.json()) as { ok?: boolean; messages?: ManusEvent[] }
    const events = Array.isArray(data.messages) ? data.messages : []
    let stopped = false
    let agentError = ''
    let imageUrl = ''
    for (const event of events) {
      if (event.type === 'status_update') {
        if (event.status_update?.agent_status === 'stopped') stopped = true
        if (event.status_update?.agent_status === 'error') {
          agentError = agentError || 'Manus task errored.'
        }
      } else if (event.type === 'error_message' && event.error_message?.content) {
        agentError = agentError || String(event.error_message.content)
      } else if (event.type === 'assistant_message') {
        for (const att of event.assistant_message?.attachments ?? []) {
          if (!att.url || imageUrl) continue
          const isImage =
            att.type === 'image' ||
            /^image\//i.test(String(att.content_type || '')) ||
            /\.(png|jpe?g|webp)$/i.test(String(att.filename || ''))
          if (isImage) imageUrl = String(att.url)
        }
      }
    }
    if (imageUrl && stopped) {
      // Attachment download URLs are temporary — store the image right away.
      await storeGeneratedImage(db, design, colorKey, colorRow, imageUrl)
      return
    }
    if (agentError && !imageUrl) {
      await setColorStatus(db, design, colorKey, 'error', { error: agentError.slice(0, 300) })
      return
    }
    if (stopped && !imageUrl) {
      await setColorStatus(db, design, colorKey, 'error', {
        error: 'Manus finished without attaching an image.',
      })
      return
    }
    await db.run(
      `UPDATE design_realistic_images SET updated_at = ? WHERE design_id = ? AND color_key = ?`,
      new Date().toISOString(),
      design.id,
      colorKey,
    )
  } catch (err) {
    // Keep polling on transient network failures.
    console.warn('[realistic-image] manus poll:', err instanceof Error ? err.message : err)
    await db.run(
      `UPDATE design_realistic_images SET updated_at = ? WHERE design_id = ? AND color_key = ?`,
      new Date().toISOString(),
      design.id,
      colorKey,
    )
  }
}

async function pollProject(
  db: DbApi,
  design: Design,
  colorRow: RealisticColorImageRow,
): Promise<void> {
  if (imageProvider() === 'manus') {
    await pollManusProject(db, design, colorRow)
    return
  }
  const colorKey = String(colorRow.color_key)
  const projectId = String(colorRow.project_id || '').trim()
  if (!projectId) {
    await setColorStatus(db, design, colorKey, 'pending')
    return
  }
  try {
    const res = await magicFetch(`/image-projects/${encodeURIComponent(projectId)}`)
    if (!res.ok) throw new Error(`Magic Hour status failed: ${await magicError(res)}`)
    const data = (await res.json()) as {
      status?: string
      downloads?: { url?: string }[]
      error?: { message?: string } | null
    }
    const status = String(data.status || '')
    if (status === 'queued' || status === 'rendering' || status === 'draft') {
      await db.run(
        `UPDATE design_realistic_images SET updated_at = ? WHERE design_id = ? AND color_key = ?`,
        new Date().toISOString(),
        design.id,
        colorKey,
      )
      return
    }
    if (status === 'error' || status === 'canceled') {
      await setColorStatus(db, design, colorKey, 'error', {
        error: data.error?.message || `Magic Hour ${status} the image.`,
      })
      return
    }
    if (status !== 'complete') return
    const url = data.downloads?.find((d) => d.url)?.url
    if (!url) throw new Error('Magic Hour finished without a downloadable image.')
    const imgRes = await fetch(url)
    if (!imgRes.ok) throw new Error(`Could not download the Magic Hour image (${imgRes.status}).`)
    const bytes = Buffer.from(await imgRes.arrayBuffer())
    if (!bytes.length) throw new Error('Magic Hour returned an empty image.')
    const contentType = (imgRes.headers.get('content-type') || '').toLowerCase()
    const ext = contentType.includes('jpeg') || contentType.includes('jpg')
      ? 'jpg'
      : contentType.includes('webp')
        ? 'webp'
        : 'png'
    const jobs = await colorJobs(db, design)
    const job = jobs.find((j) => j.key === colorKey)
    const signature = job
      ? signatureForChoices(design, job.choices)
      : String(colorRow.source || '')
    const fileName = `realistic-${design.id}-${colorKey}-${signature.slice(0, 12)}.${ext}`
    await uploadStoredBuffer(bytes, fileName, contentType || `image/${ext}`)
    await setColorStatus(db, design, colorKey, 'ready', {
      url: `/api/public/uploads/${fileName}`,
      source: signature,
    })
  } catch (err) {
    // Keep polling on transient network failures; Magic Hour errors set error above.
    console.warn('[realistic-image] poll:', err instanceof Error ? err.message : err)
    await db.run(
      `UPDATE design_realistic_images SET updated_at = ? WHERE design_id = ? AND color_key = ?`,
      new Date().toISOString(),
      design.id,
      colorKey,
    )
  }
}

/**
 * Advance realistic-image jobs. Safe to call from cron and in the background
 * after a design save. Starts at most one new generation per call so a large
 * backfill spends credits gradually across cron ticks.
 */
export async function processRealisticImageJobs(
  db: DbApi,
  opts: { designId?: string; maxStarts?: number } = {},
): Promise<{ configured: boolean; polled: number; started: number }> {
  if (!imageProvider()) return { configured: false, polled: 0, started: 0 }
  await ensureRealisticImageColumns(db)
  let rows: Record<string, unknown>[] = []
  try {
    rows = await db.all<Record<string, unknown>>(
      `SELECT * FROM designs
       WHERE status != 'archived' AND COALESCE(stl_path, '') != ''
       ORDER BY realistic_image_updated_at ASC`,
    )
  } catch {
    return { configured: true, polled: 0, started: 0 }
  }

  let polled = 0
  let started = 0
  const ordered = opts.designId
    ? [...rows].sort((a, b) => (String(a.id) === opts.designId ? -1 : String(b.id) === opts.designId ? 1 : 0))
    : rows

  for (const row of ordered) {
    const design = rowToDesign(row)
    if (opts.designId && design.id !== opts.designId) continue
    if (design.manualPhotos) continue
    if (!design.stlPath.trim() && !design.parts.some((p) => p.stlPath.trim())) continue

    // Queue any color that has no current photo yet (backfills existing
    // designs and new colors; unchanged ready colors are skipped inside).
    await queueDesignRealisticImage(db, design)

    const colorRows = (await listRealisticColorImages(db)).get(design.id) ?? []
    for (const colorRow of colorRows) {
      if (colorRow.status === 'processing') {
        await pollProject(db, design, colorRow)
        polled++
      } else if (colorRow.status === 'rendering') {
        // A worker that died mid-render leaves `rendering` behind — retry it.
        const updated = colorRow.updated_at ? Date.parse(String(colorRow.updated_at)) : 0
        if (!updated || Date.now() - updated > STALE_RENDER_MS) {
          await setColorStatus(db, design, String(colorRow.color_key), 'pending')
          colorRow.status = 'pending'
        }
      }
    }
    for (const colorRow of colorRows) {
      if (started >= (opts.maxStarts ?? 1)) break
      if (colorRow.status !== 'pending') continue
      await startProject(db, design, colorRow)
      started++
    }
    if (opts.designId) break
  }
  return { configured: true, polled, started }
}
