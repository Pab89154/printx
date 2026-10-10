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
  designHasCompletePrinterInputs,
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
import { roundMoney } from './pricing.ts'
import {
  cloudSlicerConfigured,
  quoteStlForPrinter,
  type CloudSlicerCreds,
} from './cloudSlicer.ts'

const STL_MAX_BYTES = 50 * 1024 * 1024
const STL_EXT = new Set(['.stl'])

const PRINTER_FIELD: Record<
  string,
  { grams: keyof Design; hours: keyof Design; label: string }
> = {
  pablo_p1s: { grams: 'gramsPabloP1s', hours: 'hoursPabloP1s', label: 'Pablo P1S' },
  court_ender: { grams: 'gramsCourtEnder', hours: 'hoursCourtEnder', label: 'Court Ender' },
  josh_kobra: { grams: 'gramsJoshKobra', hours: 'hoursJoshKobra', label: 'Josh Kobra' },
}

function designDto(d: Design): Omit<Design, 'stlPath'> & { stlPath: '' } {
  return { ...d, stlPath: '' }
}

async function parseStlUpload(req: IncomingMessage): Promise<string> {
  const uploadsDir = await getUploadsDir()
  const form = formidable({
    uploadDir: uploadsDir,
    keepExtensions: true,
    maxFileSize: STL_MAX_BYTES,
    multiples: false,
  })
  return new Promise((resolve, reject) => {
    form.parse(req, (err, _fields, files) => {
      if (err) return reject(err)
      const upload = files.file
      const file = Array.isArray(upload) ? upload[0] : upload
      if (!file?.filepath) return reject(new Error('STL file is required.'))
      const ext = path.extname(file.originalFilename ?? file.filepath).toLowerCase()
      if (!STL_EXT.has(ext)) {
        try {
          fs.unlinkSync(file.filepath)
        } catch {
          /* ignore */
        }
        return reject(new Error('Invalid file type. Upload a .stl file.'))
      }
      const safeName = `${randomUUID()}.stl`
      const dest = path.join(uploadsDir, safeName)
      fs.renameSync(file.filepath, dest)
      resolve(safeName)
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
  return db.all<OwnerCredsRow>(
    `SELECT p.id as printer_id, p.owner_label, p.owner_user_id as user_id,
            u.email, u.display_name,
            u.cloud_slicer_token, u.cloud_slicer_printer_id, u.cloud_slicer_filament_id
     FROM printers p
     LEFT JOIN users u ON u.id = p.owner_user_id
     WHERE p.active = 1
     ORDER BY p.owner_label ASC`,
  )
}

async function sliceDesignWithCloudSlicer(
  db: Awaited<ReturnType<typeof getDb>>,
  designId: string,
  stlPath: string,
): Promise<{ ok: true; design: Design } | { ok: false; error: string }> {
  const uploadsDir = await getUploadsDir()
  const localPath = path.join(uploadsDir, stlPath)
  if (!fs.existsSync(localPath)) {
    return { ok: false, error: 'STL file missing on server. Re-upload the design file.' }
  }

  const owners = await loadPrinterOwnerCreds(db)
  const needed = ['pablo_p1s', 'court_ender', 'josh_kobra']
  const missing: string[] = []
  const ready: { printerId: string; label: string; creds: CloudSlicerCreds }[] = []

  for (const id of needed) {
    const row = owners.find((o) => o.printer_id === id)
    const label = PRINTER_FIELD[id]?.label ?? id
    if (!row?.user_id) {
      missing.push(`${label}: no admin linked (Settings → Cloud Slicer → Your PrintX printer)`)
      continue
    }
    const creds: CloudSlicerCreds = {
      token: String(row.cloud_slicer_token || ''),
      printerId: String(row.cloud_slicer_printer_id || ''),
      filamentId: String(row.cloud_slicer_filament_id || ''),
    }
    if (!cloudSlicerConfigured(creds)) {
      const who = row.display_name || row.email || 'admin'
      missing.push(`${label}: ${who} has not finished Cloud Slicer API setup`)
      continue
    }
    ready.push({ printerId: id, label, creds })
  }

  if (missing.length) {
    const msg = `Cannot slice — fix Cloud Slicer setup:\n• ${missing.join('\n• ')}`
    await db.run(
      `UPDATE designs SET slice_status = 'error', slice_error = ?, updated_at = ? WHERE id = ?`,
      msg.slice(0, 2000),
      new Date().toISOString(),
      designId,
    )
    return { ok: false, error: msg }
  }

  await db.run(
    `UPDATE designs SET slice_status = 'slicing', slice_error = '', updated_at = ? WHERE id = ?`,
    new Date().toISOString(),
    designId,
  )

  const gramsHours: Record<string, number> = {}
  try {
    for (const item of ready) {
      const result = await quoteStlForPrinter(item.creds, localPath)
      const fields = PRINTER_FIELD[item.printerId]!
      gramsHours[fields.grams] = result.grams
      gramsHours[fields.hours] = result.hours
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Cloud Slicer quoting failed'
    await db.run(
      `UPDATE designs SET slice_status = 'error', slice_error = ?, updated_at = ? WHERE id = ?`,
      msg.slice(0, 2000),
      new Date().toISOString(),
      designId,
    )
    return { ok: false, error: msg }
  }

  const now = new Date().toISOString()
  await db.run(
    `UPDATE designs SET
      grams_pablo_p1s = ?, hours_pablo_p1s = ?,
      grams_court_ender = ?, hours_court_ender = ?,
      grams_josh_kobra = ?, hours_josh_kobra = ?,
      slice_status = 'ready', slice_error = '', updated_at = ?
     WHERE id = ?`,
    gramsHours.gramsPabloP1s ?? null,
    gramsHours.hoursPabloP1s ?? null,
    gramsHours.gramsCourtEnder ?? null,
    gramsHours.hoursCourtEnder ?? null,
    gramsHours.gramsJoshKobra ?? null,
    gramsHours.hoursJoshKobra ?? null,
    now,
    designId,
  )
  const row = await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId)
  return { ok: true, design: rowToDesign(row!) }
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

function stripeClient(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
  if (!key) return null
  return new Stripe(key)
}

function publicOrigin(req: IncomingMessage): string {
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

  // Printer reimbursement
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

  const partners = await database.all<{ id: string }>('SELECT id FROM users WHERE role = ?', 'admin')
  const n = Math.max(1, partners.length)
  const share = roundMoney(profit / n)
  for (const p of partners) {
    await database.run(
      `INSERT INTO profit_ledger (id, order_item_id, user_id, entry_type, amount_usd, note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      randomUUID(),
      itemId,
      p.id,
      'profit_share',
      share,
      `Equal profit split (${n} partners)`,
      now,
    )
  }

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
    const designs = rows.map(rowToDesign).map((d) => ({
      id: d.id,
      skuBase: d.skuBase,
      name: d.name,
      description: d.description,
      category: d.category,
      imageUrl: d.imageUrl,
      catalogPriceUsd: d.catalogPriceUsd,
      availableColors: d.availableColorIds
        .map((id) => colorById(id, settings.customColors))
        .filter(Boolean),
    }))
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

  if (urlPath === '/api/public/checkout' && method === 'POST') {
    const stripe = stripeClient()
    if (!stripe) {
      send(res, 503, { error: 'Stripe is not configured (STRIPE_SECRET_KEY).' })
      return true
    }
    const body = await readJson(req)
    const customerName = sanitizeText(String(body.customerName ?? ''), 120)
    const customerEmail = sanitizeEmail(String(body.customerEmail ?? ''))
    const itemsIn = Array.isArray(body.items) ? body.items : []
    if (!customerEmail || itemsIn.length === 0) {
      send(res, 400, { error: 'Name, email, and at least one item are required.' })
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
      customerEmail,
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
      customer_email: customerEmail,
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: orderId,
      metadata: { orderId },
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
      const session = event.data.object as Stripe.Checkout.Session
      const orderId = session.metadata?.orderId || session.client_reference_id
      if (orderId) {
        const now = new Date().toISOString()
        await db.run(
          `UPDATE orders SET status = 'paid', stripe_payment_intent = ?, paid_at = ?, updated_at = ?
           WHERE id = ? AND status = 'pending_payment'`,
          typeof session.payment_intent === 'string' ? session.payment_intent : null,
          now,
          now,
          orderId,
        )
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

  if (urlPath === '/api/admin/designs/upload-stl' && method === 'POST') {
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'products')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    try {
      const stlPath = await parseStlUpload(req)
      send(res, 201, { stlPath, hasStl: true })
      return true
    } catch (err) {
      send(res, 400, { error: err instanceof Error ? err.message : 'STL upload failed' })
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
      send(res, 404, { error: 'STL not found' })
      return true
    }
    const uploadsDir = await getUploadsDir()
    const full = path.join(uploadsDir, stlPath)
    if (!fs.existsSync(full)) {
      send(res, 404, { error: 'STL not found' })
      return true
    }
    res.statusCode = 200
    res.setHeader('Content-Type', 'model/stl')
    res.setHeader('Cache-Control', 'private, max-age=60')
    fs.createReadStream(full).pipe(res)
    return true
  }

  const designMatch = /^\/api\/admin\/designs\/([^/]+)(?:\/(submit|approve|reject|reprice))?$/.exec(
    urlPath,
  )
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
      const priced = designHasCompletePrinterInputs(design)
        ? await computeDesignPrice(db, design)
        : null
      send(res, 200, { design: designDto(design), preview: priced?.result ?? null })
      return true
    }

    if (method === 'PATCH' && !action) {
      const body = await readJson(req)
      const parsed = parseDesignBody(body, design)
      const stlPath =
        body.stlPath !== undefined
          ? sanitizeText(String(body.stlPath ?? ''), 200)
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
            grams_josh_kobra = ?, hours_josh_kobra = ?, available_color_ids = ?, updated_at = ?
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
        send(res, 400, { error: 'Upload an STL file before submitting.' })
        return true
      }
      if (design.availableColorIds.length === 0) {
        send(res, 400, { error: 'Pick at least one color before submitting.' })
        return true
      }

      // Re-slice when not ready, or always refresh quotes on submit.
      const sliced = await sliceDesignWithCloudSlicer(db, designId, design.stlPath)
      if (!sliced.ok) {
        send(res, 400, { error: sliced.error })
        return true
      }
      design = sliced.design
      if (!designHasCompletePrinterInputs(design)) {
        send(res, 400, {
          error: 'Cloud Slicer did not return complete grams/hours for all 3 printers.',
        })
        return true
      }

      const now = new Date().toISOString()
      await db.run(
        `UPDATE designs SET status = 'pending_review', submitted_at = ?, updated_at = ?, review_note = '' WHERE id = ?`,
        now,
        now,
        designId,
      )
      design = rowToDesign(
        (await db.get<Record<string, unknown>>('SELECT * FROM designs WHERE id = ?', designId))!,
      )
      send(res, 200, designDto(design))
      return true
    }

    if (method === 'POST' && (action === 'approve' || action === 'reprice')) {
      if (!admin.isMainAdmin) {
        send(res, 403, { error: 'Only the main admin can approve designs.' })
        return true
      }
      if (!designHasCompletePrinterInputs(design)) {
        send(res, 400, { error: 'Design is missing printer inputs or colors.' })
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
  if (urlPath === '/api/admin/orders' && method === 'GET') {
    const admin = await requireAdmin(req)
    if (!admin || !adminCan(admin, 'orders')) {
      send(res, 403, { error: 'Forbidden' })
      return true
    }
    const rows = await db.all<Record<string, unknown>>(
      `SELECT * FROM orders WHERE status IN ('paid', 'in_production', 'ready', 'fulfilled')
       ORDER BY COALESCE(paid_at, created_at) DESC LIMIT 200`,
    )
    const orders = []
    for (const row of rows) {
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
