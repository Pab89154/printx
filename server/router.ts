import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import formidable from 'formidable'
import {
  adminCan,
  clearSessionCookieHeader,
  createSession,
  destroySession,
  getSessionUser,
  parseCookies,
  sanitizeEmail,
  sanitizeText,
  sessionCookieDomain,
  sessionCookieHeader,
  SESSION_COOKIE,
  updateAdminPassword,
  setAdminPasswordByMain,
  updateAdminEmail,
  setAdminEmailByMain,
  updateAdminPermissions,
  updateAdminDisplayName,
  getAdminMailSignature,
  updateAdminMailSignature,
  verifyAdminLogin,
  listAdminUsers,
  createAdminUser,
  deleteAdminUser,
  type SessionAdmin,
} from './auth.ts'
import {
  getDb,
  getUploadsDir,
  getWebsiteContent,
  rowToProduct,
  rowToStand,
  setWebsiteSetting,
} from './db.ts'
import { rowToDesign } from './catalog.ts'
import {
  getCachedBootstrap,
  invalidateBootstrapCache,
  setCachedBootstrap,
} from './bootstrapCache.ts'
import { syncStandLifecycle } from './standLifecycle.ts'
import { CUSTOMER_ACCOUNTS_ENABLED } from '../shared/customerAccounts.ts'
import { stripeAgreementText } from '../shared/checkoutConsent.ts'
import type { PermissionKey } from '../shared/permissions.ts'
import { validateStandSchedule } from '../shared/standSchedule.ts'
import type { RequestStatus, StandStatus } from './types.ts'
import {
  deletePushSubscription,
  notifyAdminUsers,
  notifyAdminsWithPermission,
  pushConfigured,
  sendTestPushToUser,
  upsertPushSubscription,
  vapidConfigError,
  vapidPublicKey,
} from './pushNotify.ts'
import { runInBackground } from './background.ts'
import {
  objectStorageRequired,
  sendStoredFile,
  uploadStoredFile,
} from './objectStorage.ts'
import {
  clearCustomRequestSliceArtifacts,
  downloadCustomRequestGcode,
  mapCustomRequestRow,
} from './customRequestSlice.ts'
import { publicOrigin, stripeClient } from './catalogApi.ts'
import {
  stripeAccountSavedPaymentFields,
  stripeCheckoutShippingFields,
  stripeTermsConsentFields,
} from './stripeShipping.ts'
import { roundMoney } from './pricing.ts'
import {
  CUSTOMER_SESSION_COOKIE,
  getSessionCustomer,
  setCustomerStripeId,
} from './auth.ts'

const ALLOWED_UPLOAD_EXT = new Set(['.stl', '.gcode'])
const CUSTOM_REQUEST_MODEL_EXT = new Set(['.stl', '.gcode'])
const ALLOWED_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
const MAX_CUSTOM_MODEL_BYTES = 50 * 1024 * 1024
const IMAGE_MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** Date-only expiry (YYYY-MM-DD) counts through end of that local day. */
function announcementStillValid(expiresAt: string | null | undefined): boolean {
  if (!expiresAt || !String(expiresAt).trim()) return true
  const raw = String(expiresAt).trim()
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw)
  if (m) {
    const end = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999)
    return end.getTime() >= Date.now()
  }
  const parsed = new Date(raw)
  return !Number.isNaN(parsed.getTime()) && parsed.getTime() >= Date.now()
}

function isSecureRequest(req: IncomingMessage): boolean {
  const forwarded = req.headers['x-forwarded-proto']
  if (typeof forwarded === 'string') return forwarded.split(',')[0]?.trim() === 'https'
  return process.env.NODE_ENV === 'production'
}

/** Public hostname as seen by the browser (Static Site may proxy /api to this service). */
function requestPublicHost(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-host']
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0]?.trim() ?? ''
  }
  return typeof req.headers.host === 'string' ? req.headers.host : ''
}

function cookieOptions(req: IncomingMessage): { secure: boolean; domain?: string } {
  // Prefer explicit domain when API is reached via onrender.com behind a rewrite.
  const forced = process.env.PRINTX_COOKIE_DOMAIN?.trim()
  const host = requestPublicHost(req)
  return {
    secure: isSecureRequest(req),
    domain: forced || sessionCookieDomain(host),
  }
}

function send(res: ServerResponse, status: number, body: unknown, cookies?: string[]) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  if (cookies?.length) res.setHeader('Set-Cookie', cookies)
  res.end(JSON.stringify(body))
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(Buffer.from(chunk))
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as Record<string, unknown>
  } catch {
    return {}
  }
}

async function requireAdmin(req: IncomingMessage): Promise<SessionAdmin | null> {
  const cookies = parseCookies(req.headers.cookie)
  const user = await getSessionUser(cookies[SESSION_COOKIE] ?? null)
  if (!user || user.role !== 'admin') return null
  return user
}

function forbid(res: ServerResponse, message = 'You do not have permission for this action.') {
  send(res, 403, { error: message })
  return true
}

function bumpPublicCache() {
  invalidateBootstrapCache()
}

function requirePerm(admin: SessionAdmin, key: PermissionKey, res: ServerResponse): boolean {
  if (adminCan(admin, key)) return true
  forbid(res)
  return false
}

function formatStandDate(isoDate: string): string {
  try {
    const [y, m, d] = isoDate.split('-').map(Number)
    const date = new Date(y, m - 1, d)
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  } catch {
    return isoDate
  }
}

function publicStand(row: ReturnType<typeof rowToStand>) {
  return {
    ...row,
    displayDate: formatStandDate(row.date),
    time: `${row.startTime} – ${row.endTime}`,
  }
}

async function parseMultipart(
  req: IncomingMessage,
  opts?: {
    allowedExt?: Set<string>
    invalidTypeMessage?: string
    maxFileSize?: number
  },
): Promise<{ fields: Record<string, string>; filePath: string | null }> {
  const allowedExt = opts?.allowedExt ?? ALLOWED_UPLOAD_EXT
  const invalidTypeMessage = opts?.invalidTypeMessage ?? 'Invalid file type. Only .stl and .gcode allowed.'
  const uploadsDir = await getUploadsDir()
  const form = formidable({
    uploadDir: uploadsDir,
    keepExtensions: true,
    maxFileSize: opts?.maxFileSize ?? MAX_UPLOAD_BYTES,
    multiples: false,
  })

  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err)
      void (async () => {
        const normalized: Record<string, string> = {}
        for (const [key, val] of Object.entries(fields)) {
          normalized[key] = Array.isArray(val) ? String(val[0] ?? '') : String(val ?? '')
        }

        let filePath: string | null = null
        const upload = files.file
        const file = Array.isArray(upload) ? upload[0] : upload
        if (file?.filepath) {
          const ext = path.extname(file.originalFilename ?? file.filepath).toLowerCase()
          if (!allowedExt.has(ext)) {
            fs.unlinkSync(file.filepath)
            return reject(new Error(invalidTypeMessage))
          }
          const safeName = `${randomUUID()}${ext}`
          const dest = path.join(uploadsDir, safeName)
          fs.renameSync(file.filepath, dest)
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
          filePath = safeName
        }
        resolve({ fields: normalized, filePath })
      })()
    })
  })
}

type MailUserRow = {
  id: string
  email: string
  display_name: string | null
}

const MAIL_TRASH_MS = 30 * 24 * 60 * 60 * 1000
const MAIL_SCHEDULE_FLUSH_MS = 30_000

function mailTrashCutoffIso() {
  return new Date(Date.now() - MAIL_TRASH_MS).toISOString()
}

/** Deliver any messages whose scheduled_at has passed. */
export async function flushDueScheduledMail(db: Awaited<ReturnType<typeof getDb>>) {
  const now = new Date().toISOString()
  const due = await db.all<{ id: string; subject: string }>(
    `
    SELECT id, subject FROM mail_messages
    WHERE scheduled_at IS NOT NULL
      AND scheduled_at <= ?
      AND COALESCE(is_draft, 0) = 0
  `,
    now,
  )
  for (const row of due) {
    await db.run(
      `
      UPDATE mail_messages
      SET scheduled_at = NULL, created_at = ?
      WHERE id = ?
    `,
      now,
      row.id,
    )
    const recipients = await db.all<{ recipient_id: string }>(
      'SELECT recipient_id FROM mail_recipients WHERE message_id = ?',
      row.id,
    )
    runInBackground('push-scheduled-mail', () =>
      notifyAdminUsers(
        db,
        recipients.map((r) => r.recipient_id),
        {
          title: 'New PrintX mail',
          body: row.subject || '(no subject)',
          url: '/mail',
        },
      ),
    )
  }
  return due.length
}

let scheduleFlushTimer: ReturnType<typeof setInterval> | null = null

export function startMailScheduleFlusher() {
  if (scheduleFlushTimer) return
  const tick = () => {
    void getDb()
      .then((db) => flushDueScheduledMail(db))
      .catch((err) => console.error('[printx] scheduled mail flush failed', err))
  }
  tick()
  scheduleFlushTimer = setInterval(tick, MAIL_SCHEDULE_FLUSH_MS)
  if (typeof scheduleFlushTimer === 'object' && 'unref' in scheduleFlushTimer) {
    scheduleFlushTimer.unref()
  }
}

const ARRIVED_ORDER_FLUSH_MS = 15 * 60 * 1000
let arrivedFlushTimer: ReturnType<typeof setInterval> | null = null

/** Periodically advance shipped → arrived → fulfilled by shipping-method business days. */
export function startArrivedOrderFlusher() {
  if (arrivedFlushTimer) return
  const tick = () => {
    void import('./catalogApi.ts')
      .then(({ resumeArrivedOrderChecks }) => resumeArrivedOrderChecks())
      .catch((err) => console.error('[printx] arrived order flush failed', err))
  }
  tick()
  arrivedFlushTimer = setInterval(tick, ARRIVED_ORDER_FLUSH_MS)
  if (typeof arrivedFlushTimer === 'object' && 'unref' in arrivedFlushTimer) {
    arrivedFlushTimer.unref()
  }
}

const REALISTIC_IMAGE_FLUSH_MS = 60 * 1000
let realisticImageFlushTimer: ReturnType<typeof setInterval> | null = null

/** Poll Magic Hour realistic-image jobs on the long-running Node server. */
export function startRealisticImageFlusher() {
  if (realisticImageFlushTimer) return
  const tick = () => {
    void getDb()
      .then(async (db) => {
        const { processRealisticImageJobs } = await import('./realisticImages.ts')
        return processRealisticImageJobs(db, { maxStarts: 1 })
      })
      .catch((err) => console.error('[printx] realistic image flush failed', err))
  }
  tick()
  realisticImageFlushTimer = setInterval(tick, REALISTIC_IMAGE_FLUSH_MS)
  if (typeof realisticImageFlushTimer === 'object' && 'unref' in realisticImageFlushTimer) {
    realisticImageFlushTimer.unref()
  }
}

async function purgeExpiredMailTrash(db: Awaited<ReturnType<typeof getDb>>) {
  const cutoff = mailTrashCutoffIso()
  const expiredRecipients = await db.all<{ id: string; message_id: string }>(
    `
    SELECT id, message_id FROM mail_recipients
    WHERE deleted_at IS NOT NULL AND deleted_at < ?
  `,
    cutoff,
  )
  for (const row of expiredRecipients) {
    await db.run('DELETE FROM mail_recipients WHERE id = ?', row.id)
  }

  const expiredSent = await db.all<{ id: string }>(
    `
    SELECT id FROM mail_messages
    WHERE sender_deleted_at IS NOT NULL AND sender_deleted_at < ?
  `,
    cutoff,
  )
  for (const row of expiredSent) {
    const remaining = await db.get<{ c: number | string }>(
      'SELECT COUNT(*) as c FROM mail_recipients WHERE message_id = ?',
      row.id,
    )
    if (Number(remaining?.c ?? 0) === 0) {
      await db.run('DELETE FROM mail_messages WHERE id = ?', row.id)
    } else {
      // Keep the message for other recipients; hide it from this sender forever.
      await db.run(
        `UPDATE mail_messages SET sender_deleted_at = ? WHERE id = ?`,
        '1970-01-01T00:00:00.000Z',
        row.id,
      )
    }
  }

  const orphans = await db.all<{ id: string }>(
    `
    SELECT m.id FROM mail_messages m
    LEFT JOIN mail_recipients r ON r.message_id = m.id
    WHERE r.id IS NULL
      AND (m.sender_deleted_at IS NOT NULL)
  `,
  )
  for (const row of orphans) {
    await db.run('DELETE FROM mail_messages WHERE id = ?', row.id)
  }
}

async function loadMailMessage(
  db: Awaited<ReturnType<typeof getDb>>,
  messageId: string,
  viewerId: string,
  asRecipient: boolean,
) {
  const msg = await db.get<{
    id: string
    subject: string
    body: string
    created_at: string
    sender_id: string
    sender_email: string
    sender_display_name: string | null
    sender_deleted_at: string | null
    scheduled_at: string | null
    is_draft: number | null
  }>(
    `
    SELECT m.id, m.subject, m.body, m.created_at, m.sender_id, m.sender_deleted_at, m.scheduled_at,
           COALESCE(m.is_draft, 0) as is_draft,
           u.email as sender_email, u.display_name as sender_display_name
    FROM mail_messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.id = ?
  `,
    messageId,
  )
  if (!msg) return null

  const isDraft = Boolean(Number(msg.is_draft))
  let readAt: string | null = null
  let archivedAt: string | null = null
  let deletedAt: string | null = null
  if (asRecipient) {
    // Hold scheduled / draft messages until they are actually delivered.
    if (isDraft) return null
    if (msg.scheduled_at && msg.scheduled_at > new Date().toISOString()) return null
    const mine = await db.get<{
      read_at: string | null
      archived_at: string | null
      deleted_at: string | null
    }>(
      'SELECT read_at, archived_at, deleted_at FROM mail_recipients WHERE message_id = ? AND recipient_id = ?',
      messageId,
      viewerId,
    )
    if (!mine) return null
    readAt = mine.read_at
    archivedAt = mine.archived_at
    deletedAt = mine.deleted_at
  } else if (msg.sender_id !== viewerId) {
    return null
  }

  const recipients = await db.all<MailUserRow>(
    `
    SELECT u.id, u.email, u.display_name
    FROM mail_recipients r
    JOIN users u ON u.id = r.recipient_id
    WHERE r.message_id = ?
    ORDER BY lower(u.email) ASC
  `,
    messageId,
  )

  return {
    id: msg.id,
    subject: msg.subject,
    body: msg.body,
    createdAt: msg.created_at,
    senderId: msg.sender_id,
    senderEmail: msg.sender_email,
    senderDisplayName: msg.sender_display_name,
    readAt,
    archivedAt,
    deletedAt,
    senderDeletedAt: msg.sender_deleted_at,
    scheduledAt: msg.scheduled_at,
    isDraft,
    recipients: recipients.map((r) => ({
      id: r.id,
      email: r.email,
      displayName: r.display_name,
    })),
  }
}

async function replaceMailRecipients(
  db: Awaited<ReturnType<typeof getDb>>,
  messageId: string,
  recipientIds: string[],
) {
  await db.run('DELETE FROM mail_recipients WHERE message_id = ?', messageId)
  for (const recipientId of recipientIds) {
    await db.run(
      'INSERT INTO mail_recipients (id, message_id, recipient_id, read_at) VALUES (?, ?, ?, ?)',
      randomUUID(),
      messageId,
      recipientId,
      null,
    )
  }
}

async function resolveAdminRecipientIds(
  db: Awaited<ReturnType<typeof getDb>>,
  recipientIds: string[],
): Promise<string[]> {
  if (recipientIds.length === 0) return []
  const rows = await db.all<{ id: string }>(
    `SELECT id FROM users
     WHERE role = 'admin' AND id IN (${recipientIds.map(() => '?').join(',')})`,
    ...recipientIds,
  )
  return rows.map((r) => r.id)
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, urlPath: string, method: string): Promise<boolean> {
  // Dev/preview middleware hits the router; production also short-circuits in production.ts.
  if (urlPath === '/api/health' && method === 'GET') {
    res.setHeader('Cache-Control', 'no-store')
    const { objectStorageHealth } = await import('./objectStorage.ts')
    const objectStorage = objectStorageHealth()
    send(res, 200, {
      ok: true,
      objectStorage,
      warning:
        !objectStorage.configured && objectStorage.required
          ? 'Set SUPABASE_SERVICE_ROLE_KEY (service_role / sb_secret) on Render Environment'
          : undefined,
    })
    return true
  }

  // Public customer accounts (auth, my orders, refund requests)
  const { handleCustomerApi } = await import('./customerApi.ts')
  if (await handleCustomerApi(req, res, urlPath, method)) return true

  // Catalog / designs / orders / Stripe (keeps this file smaller)
  const { handleCatalogApi } = await import('./catalogApi.ts')
  if (await handleCatalogApi(req, res, urlPath, method)) return true

  const db = await getDb()

  if (urlPath === '/api/public/bootstrap' && method === 'GET') {
    const qs = (req.url ?? '').split('?')[1] ?? ''
    const wantFull = new URLSearchParams(qs).get('full') === '1'

    // Move finished stands to "past" / purge 1+ year-old rows before serving public data.
    await syncStandLifecycle(db)

    const cached = getCachedBootstrap(wantFull)
    if (cached) {
      res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=30')
      send(res, 200, cached)
      return true
    }

    const content = await getWebsiteContent(db)
    const announcementActive = Boolean(
      content.announcementEnabled &&
        content.announcementText?.trim() &&
        announcementStillValid(content.announcementExpiresAt),
    )

    // Public visitors on a paused site only need the pause flag — skip the heavy queries.
    if (!wantFull && content.websiteOnline === false) {
      const body = {
        stands: [],
        pastStands: [],
        products: [],
        schools: [],
        content,
        announcementActive: false,
      }
      setCachedBootstrap(false, body)
      res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=30')
      send(res, 200, body)
      return true
    }

    // Sequential queries keep session-pooler usage to 1 client (avoids EMAXCONNSESSION).
    const standRows = await db.all<Record<string, unknown>>(`
      SELECT * FROM stands WHERE status IN ('upcoming', 'active') ORDER BY date ASC, start_time ASC
    `)
    const designRows = await db.all<Record<string, unknown>>(`
      SELECT * FROM designs WHERE status = 'approved' ORDER BY name ASC
    `)
    const schools = await db.all('SELECT * FROM schools WHERE active = 1 ORDER BY name ASC')

    // Designs are the catalog — expose them as products for bootstrap consumers.
    const products = designRows.map((r) => {
      const d = rowToDesign(r)
      return {
        id: d.id,
        name: d.name,
        description: d.description,
        price: d.catalogPriceUsd ?? 0,
        category: d.category,
        image: d.imageUrl,
        emoji: 'package',
        imageGradient: 'from-navy to-electric',
        available: true,
        featured: false,
        displayOrder: 0,
      }
    })

    const body = {
      stands: standRows.map((r) => publicStand(rowToStand(r))),
      // Past stands stay in admin only — never shown on the public site.
      pastStands: [],
      products,
      schools,
      content,
      announcementActive,
    }
    setCachedBootstrap(true, body)
    // Also warm the paused cache shape when online so toggling pause is snappy.
    if (content.websiteOnline !== false) setCachedBootstrap(false, body)

    res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=30')
    send(res, 200, body)
    return true
  }

  if (urlPath === '/api/public/custom-requests' && method === 'POST') {
    try {
      const { fields, filePath } = await parseMultipart(req, {
        allowedExt: CUSTOM_REQUEST_MODEL_EXT,
        invalidTypeMessage: 'Invalid file type. Upload .stl or .gcode.',
        maxFileSize: MAX_CUSTOM_MODEL_BYTES,
      })
      const now = new Date().toISOString()
      const id = randomUUID()
      // Name/email come from Stripe Checkout after Pay — optional on estimate.
      const name = sanitizeText(fields.name, 120) || 'Customer'
      const email = sanitizeEmail(fields.email) || ''
      const school = sanitizeText(fields.school, 200)
      if (!filePath) {
        send(res, 400, { error: 'A 3D model file (.stl or .gcode) is required.' })
        return true
      }
      // Description/size come from the model file; keep optional DB fields filled for display.
      const description =
        sanitizeText(fields.description, 3000) || `Custom model: ${filePath}`
      const size = sanitizeText(fields.size, 100) || 'From model file'
      // Estimate draft — not in admin queue until Stripe payment succeeds.
      await db.run(
        `
        INSERT INTO custom_requests (
          id, name, email, school, description, size, uploaded_file, status,
          slice_status, slice_error, quote_ids_json, file_ids_json,
          created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'awaiting_payment', 'slicing', '', '{}', '{}', ?, ?)
      `,
        id,
        name,
        email,
        school,
        description,
        size,
        filePath,
        now,
        now,
      )
      const { scheduleCustomRequestQuote } = await import('./catalogApi.ts')
      scheduleCustomRequestQuote(id)
      runInBackground('push-custom-estimate', async () => {
        const bg = await getDb()
        await notifyAdminsWithPermission(bg, 'requests', {
          title: 'New custom print estimate',
          body: 'A customer uploaded a model for pricing.',
          url: '/requests',
        })
      })
      send(res, 201, { ok: true, id, sliceStatus: 'slicing' })
    } catch (e) {
      send(res, 400, { error: e instanceof Error ? e.message : 'Upload failed' })
    }
    return true
  }

  const publicCustomStatusMatch = /^\/api\/public\/custom-requests\/([^/]+)$/.exec(urlPath)
  if (publicCustomStatusMatch && method === 'GET') {
    const id = publicCustomStatusMatch[1]!
    const row = await db.get<Record<string, unknown>>(
      'SELECT id, slice_status, slice_error, catalog_price_usd, status FROM custom_requests WHERE id = ?',
      id,
    )
    if (!row) {
      send(res, 404, { error: 'Request not found' })
      return true
    }
    send(res, 200, {
      id: String(row.id),
      sliceStatus: String(row.slice_status || 'idle'),
      catalogPriceUsd: row.catalog_price_usd == null ? null : Number(row.catalog_price_usd),
      error: String(row.slice_error || '') || undefined,
      status: String(row.status || 'awaiting_payment'),
    })
    return true
  }

  const publicCustomCheckoutMatch = /^\/api\/public\/custom-requests\/([^/]+)\/checkout$/.exec(urlPath)
  if (publicCustomCheckoutMatch && method === 'POST') {
    const stripe = stripeClient()
    if (!stripe) {
      send(res, 503, { error: 'Stripe is not configured (STRIPE_SECRET_KEY).' })
      return true
    }
    const cookies = parseCookies(req.headers.cookie)
    const account = await getSessionCustomer(cookies[CUSTOMER_SESSION_COOKIE] ?? null)
    if (CUSTOMER_ACCOUNTS_ENABLED && !account) {
      send(res, 401, { error: 'Sign in to checkout.' })
      return true
    }
    const id = publicCustomCheckoutMatch[1]!
    const row = await db.get<Record<string, unknown>>(
      'SELECT * FROM custom_requests WHERE id = ?',
      id,
    )
    if (!row) {
      send(res, 404, { error: 'Estimate not found' })
      return true
    }
    if (String(row.status) !== 'awaiting_payment') {
      send(res, 400, { error: 'This estimate is no longer available for checkout.' })
      return true
    }
    if (String(row.slice_status) !== 'ready' || row.catalog_price_usd == null) {
      send(res, 400, { error: 'Price is not ready yet. Wait for the estimate to finish.' })
      return true
    }
    const price = roundMoney(Number(row.catalog_price_usd))
    if (!(price > 0)) {
      send(res, 400, { error: 'Invalid estimate price.' })
      return true
    }
    const origin = publicOrigin(req)
    const successUrl =
      process.env.STRIPE_SUCCESS_URL?.trim() ||
      `${origin}/order/success?session_id={CHECKOUT_SESSION_ID}`
    const cancelUrl = `${origin}/#custom`

    try {
      let stripeCustomerId: string | null = null
      if (account) {
        stripeCustomerId = account.stripeCustomerId
        if (stripeCustomerId) {
          try {
            const existing = await stripe.customers.retrieve(stripeCustomerId)
            if ('deleted' in existing && existing.deleted) stripeCustomerId = null
          } catch {
            stripeCustomerId = null
          }
        }
        if (!stripeCustomerId) {
          const created = await stripe.customers.create({
            email: account.email || undefined,
            name: account.displayName || undefined,
            metadata: { printxUserId: account.id },
          })
          stripeCustomerId = created.id
          await setCustomerStripeId(account.id, created.id)
        }
      }
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        ...(stripeCustomerId
          ? {
              customer: stripeCustomerId,
              ...stripeAccountSavedPaymentFields(),
            }
          : {
              customer_creation: 'if_required',
            }),
        success_url: successUrl,
        cancel_url: cancelUrl,
        client_reference_id: id,
        metadata: {
          customRequestId: id,
          ...(account ? { customerUserId: account.id } : { guest: '1' }),
        },
        ...stripeCheckoutShippingFields({ guest: !account }),
        ...stripeTermsConsentFields(`${origin}/terms-and-conditions`),
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: 'usd',
              unit_amount: Math.round(price * 100),
              product_data: {
                name: 'Custom 3D print',
                description: sanitizeText(String(row.description || ''), 200) || 'Custom 3D print',
              },
            },
          },
        ],
      })
      const agreedAt = new Date().toISOString()
      await db.run(
        `UPDATE custom_requests SET stripe_session_id = ?, user_id = ?, updated_at = ?,
           agreement_name = ?, agreement_text = ?,
           agreement_payment_checked = 0, agreement_terms_checked = 0
         WHERE id = ?`,
        session.id,
        account?.id ?? null,
        agreedAt,
        account?.displayName || '',
        stripeAgreementText(),
        id,
      )
      send(res, 200, { url: session.url, sessionId: session.id })
    } catch (err) {
      send(res, 400, { error: err instanceof Error ? err.message : 'Checkout failed' })
    }
    return true
  }

  const publicCustomCancelMatch = /^\/api\/public\/custom-requests\/([^/]+)\/cancel$/.exec(urlPath)
  if (publicCustomCancelMatch && method === 'POST') {
    const id = publicCustomCancelMatch[1]!
    const row = await db.get<{ status: string; uploaded_file: string | null }>(
      'SELECT status, uploaded_file FROM custom_requests WHERE id = ?',
      id,
    )
    if (!row) {
      send(res, 404, { error: 'Estimate not found' })
      return true
    }
    if (row.status !== 'awaiting_payment') {
      send(res, 400, { error: 'Only unpaid estimates can be cancelled.' })
      return true
    }
    await clearCustomRequestSliceArtifacts(db, id)
    await db.run('DELETE FROM custom_requests WHERE id = ?', id)
    const fileName = row.uploaded_file?.trim()
    if (fileName && !fileName.includes('..') && !fileName.includes('/') && !fileName.includes('\\')) {
      try {
        const uploadsDir = await getUploadsDir()
        const full = path.join(uploadsDir, fileName)
        if (full.startsWith(uploadsDir) && fs.existsSync(full)) fs.unlinkSync(full)
      } catch {
        /* ignore */
      }
    }
    send(res, 200, { ok: true })
    return true
  }

  if (urlPath === '/api/public/contact' && method === 'POST') {
    const body = await readJson(req)
    const name = sanitizeText(body.name, 120)
    const email = sanitizeEmail(body.email)
    const inquiryType = sanitizeText(body.inquiryType, 100)
    const message = sanitizeText(body.message, 5000)
    await db.run(
      `
      INSERT INTO contact_messages (id, name, email, inquiry_type, message, status, created_at)
      VALUES (?, ?, ?, ?, ?, 'new', ?)
    `,
      randomUUID(),
      name,
      email,
      inquiryType,
      message,
      new Date().toISOString(),
    )
    // Portal Inbox only — do not send real email to hello@ or the visitor's mail app.
    runInBackground('push-contact', () =>
      notifyAdminsWithPermission(db, 'messages', {
        title: 'New contact message',
        body: `${name || 'Someone'}: ${inquiryType || 'Message'}`,
        url: '/messages',
      }),
    )
    send(res, 201, { ok: true })
    return true
  }

  // Public product images (uploaded by admins). Custom-request STL/OBJ stay admin-only.
  const publicUploadMatch = urlPath.match(/^\/api\/public\/uploads\/([^/]+)$/)
  if (publicUploadMatch && method === 'GET') {
    const filename = publicUploadMatch[1] ?? ''
    if (!/^[\w-]+\.(jpe?g|png|webp|gif)$/i.test(filename)) {
      send(res, 400, { error: 'Invalid file name' })
      return true
    }
    const ext = path.extname(filename).toLowerCase()
    const ok = await sendStoredFile(
      res,
      filename,
      IMAGE_MIME[ext] ?? 'application/octet-stream',
      'public, max-age=86400',
    )
    if (!ok) {
      send(res, 404, { error: 'File not found' })
      return true
    }
    return true
  }

  if (urlPath === '/api/admin/login' && method === 'POST') {
    const body = await readJson(req)
    const email = typeof body.email === 'string' ? body.email : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const user = await verifyAdminLogin(email, password)
    if (!user) {
      send(res, 401, { error: 'Invalid email or password.' })
      return true
    }
    const token = await createSession(user.id)
    send(
      res,
      200,
      {
        ok: true,
        role: user.role,
        email: user.email,
        displayName: user.displayName,
        isMainAdmin: user.isMainAdmin,
        permissions: user.permissions,
      },
      [sessionCookieHeader(token, cookieOptions(req))],
    )
    return true
  }

  if (urlPath === '/api/admin/logout' && method === 'POST') {
    const cookies = parseCookies(req.headers.cookie)
    await destroySession(cookies[SESSION_COOKIE] ?? null)
    const opts = cookieOptions(req)
    send(res, 200, { ok: true }, [clearSessionCookieHeader(opts.secure, opts.domain)])
    return true
  }

  if (urlPath === '/api/admin/me' && method === 'GET') {
    const user = await requireAdmin(req)
    if (!user) {
      send(res, 401, { error: 'Unauthorized' })
      return true
    }
    send(res, 200, {
      ok: true,
      role: user.role,
      email: user.email,
      displayName: user.displayName,
      isMainAdmin: user.isMainAdmin,
      permissions: user.permissions,
    })
    return true
  }

  if (urlPath === '/api/admin/push/vapid-public-key' && method === 'GET') {
    const user = await requireAdmin(req)
    if (!user) {
      send(res, 401, { error: 'Unauthorized' })
      return true
    }
    const key = vapidPublicKey()
    if (!key) {
      send(res, 503, {
        error: vapidConfigError() || 'Push notifications are not configured (missing VAPID keys).',
      })
      return true
    }
    send(res, 200, { publicKey: key, configured: pushConfigured() })
    return true
  }

  if (urlPath === '/api/admin/push/subscribe' && method === 'POST') {
    const user = await requireAdmin(req)
    if (!user) {
      send(res, 401, { error: 'Unauthorized' })
      return true
    }
    if (!pushConfigured()) {
      send(res, 503, { error: 'Push notifications are not configured.' })
      return true
    }
    const body = await readJson(req)
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : ''
    const keys = body.keys && typeof body.keys === 'object' ? (body.keys as Record<string, unknown>) : {}
    const p256dh = typeof keys.p256dh === 'string' ? keys.p256dh.trim() : ''
    const auth = typeof keys.auth === 'string' ? keys.auth.trim() : ''
    const userAgent =
      typeof body.userAgent === 'string'
        ? body.userAgent.slice(0, 300)
        : String(req.headers['user-agent'] || '').slice(0, 300)
    if (!endpoint || !p256dh || !auth) {
      send(res, 400, { error: 'Invalid push subscription.' })
      return true
    }
    await upsertPushSubscription(db, user.id, { endpoint, p256dh, auth, userAgent })
    send(res, 200, { ok: true })
    return true
  }

  if (urlPath === '/api/admin/push/test' && method === 'POST') {
    const user = await requireAdmin(req)
    if (!user) {
      send(res, 401, { error: 'Unauthorized' })
      return true
    }
    if (!pushConfigured()) {
      send(res, 503, {
        error: vapidConfigError() || 'Push notifications are not configured.',
      })
      return true
    }
    try {
      const result = await sendTestPushToUser(db, user.id)
      if (result.sent === 0 && result.removed === 0 && result.failed === 0) {
        send(res, 400, {
          error: 'No device registered yet. Tap Enable notifications on this phone first.',
        })
        return true
      }
      send(res, 200, { ok: true, ...result })
    } catch (err) {
      send(res, 500, { error: err instanceof Error ? err.message : 'Test push failed' })
    }
    return true
  }

  if (urlPath === '/api/admin/push/subscribe' && method === 'DELETE') {
    const user = await requireAdmin(req)
    if (!user) {
      send(res, 401, { error: 'Unauthorized' })
      return true
    }
    const body = await readJson(req)
    const endpoint = typeof body.endpoint === 'string' ? body.endpoint.trim() : ''
    if (!endpoint) {
      send(res, 400, { error: 'endpoint required' })
      return true
    }
    await deletePushSubscription(db, user.id, endpoint)
    send(res, 200, { ok: true })
    return true
  }

  const uploadMatch = urlPath.match(/^\/api\/admin\/uploads\/([^/]+)$/)
  if (uploadMatch && method === 'GET') {
    const adminUser = await requireAdmin(req)
    if (!adminUser) {
      send(res, 401, { error: 'Unauthorized' })
      return true
    }
    if (!requirePerm(adminUser, 'requests', res)) return true
    const filename = uploadMatch[1] ?? ''
    if (!/^[\w-]+\.(stl|gcode)$/i.test(filename)) {
      send(res, 400, { error: 'Invalid file name' })
      return true
    }
    const ok = await sendStoredFile(
      res,
      filename,
      'application/octet-stream',
      'private, max-age=60',
      { 'Content-Disposition': `attachment; filename="${filename}"` },
    )
    if (!ok) {
      send(res, 404, { error: 'File not found' })
      return true
    }
    return true
  }

  if (urlPath === '/api/admin/stats' && method === 'GET') {
    const statsAdmin = await requireAdmin(req)
    if (!statsAdmin) {
      send(res, 401, { error: 'Unauthorized' })
      return true
    }
    if (!requirePerm(statsAdmin, 'dashboard', res)) return true
    await syncStandLifecycle(db)
    const nextRow = await db.get<Record<string, unknown>>(`
      SELECT * FROM stands WHERE status IN ('upcoming', 'active') ORDER BY date ASC LIMIT 1
    `)
    const activeProducts = Number(
      (await db.get<{ c: number | string }>("SELECT COUNT(*) as c FROM designs WHERE status = 'approved'"))
        ?.c ?? 0,
    )
    const newRequests = Number(
      (await db.get<{ c: number | string }>("SELECT COUNT(*) as c FROM custom_requests WHERE status = 'new'"))?.c ??
        0,
    )
    const newMessages = Number(
      (await db.get<{ c: number | string }>("SELECT COUNT(*) as c FROM contact_messages WHERE status = 'new'"))?.c ??
        0,
    )
    const content = await getWebsiteContent(db)
    send(res, 200, {
      nextStand: nextRow ? publicStand(rowToStand(nextRow)) : null,
      activeProducts,
      newRequests,
      newMessages,
      websiteOnline: content.websiteOnline !== false,
    })
    return true
  }

  const admin = await requireAdmin(req)
  if (!admin) {
    if (urlPath.startsWith('/api/admin/')) {
      send(res, 401, { error: 'Unauthorized' })
      return true
    }
    return false
  }

  if (urlPath === '/api/admin/stands' && method === 'GET') {
    if (!requirePerm(admin, 'stands', res)) return true
    await syncStandLifecycle(db)
    const rows = await db.all<Record<string, unknown>>(`
      SELECT * FROM stands
      ORDER BY
        CASE status WHEN 'past' THEN 1 ELSE 0 END ASC,
        date ASC,
        start_time ASC
    `)
    send(res, 200, rows.map((r) => rowToStand(r)))
    return true
  }

  if (urlPath === '/api/admin/stands' && method === 'POST') {
    if (!requirePerm(admin, 'stands', res)) return true
    const body = await readJson(req)
    const scheduleError = validateStandSchedule({
      date: String(body.date ?? ''),
      startTime: String(body.startTime ?? ''),
      endTime: String(body.endTime ?? ''),
      status: String(body.status ?? 'upcoming'),
    })
    if (scheduleError) {
      send(res, 400, { error: scheduleError })
      return true
    }
    const now = new Date().toISOString()
    const id = randomUUID()
    await db.run(
      `
      INSERT INTO stands (id, school_id, school_name, date, start_time, end_time, location, description, notes, products_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      id,
      body.schoolId ?? null,
      sanitizeText(body.schoolName, 200),
      sanitizeText(body.date, 20),
      sanitizeText(body.startTime, 20),
      sanitizeText(body.endTime, 20),
      sanitizeText(body.location, 200),
      sanitizeText(body.description, 2000),
      sanitizeText(body.notes, 2000),
      JSON.stringify(Array.isArray(body.products) ? body.products : []),
      (['upcoming', 'active', 'past'].includes(String(body.status)) ? body.status : 'upcoming') as StandStatus,
      now,
      now,
    )
    const row = (await db.get<Record<string, unknown>>('SELECT * FROM stands WHERE id = ?', id))!
    bumpPublicCache()
    send(res, 201, rowToStand(row))
    return true
  }

  const standMatch = urlPath.match(/^\/api\/admin\/stands\/([^/]+)$/)
  if (standMatch) {
    if (!requirePerm(admin, 'stands', res)) return true
    const id = standMatch[1]
    if (method === 'PATCH') {
      const body = await readJson(req)
      const existing = await db.get('SELECT * FROM stands WHERE id = ?', id)
      if (!existing) {
        send(res, 404, { error: 'Not found' })
        return true
      }
      const scheduleError = validateStandSchedule({
        date: String(body.date ?? ''),
        startTime: String(body.startTime ?? ''),
        endTime: String(body.endTime ?? ''),
        status: String(body.status ?? 'upcoming'),
      })
      if (scheduleError) {
        send(res, 400, { error: scheduleError })
        return true
      }
      await db.run(
        `
        UPDATE stands SET
          school_id = ?, school_name = ?, date = ?, start_time = ?, end_time = ?,
          location = ?, description = ?, notes = ?, products_json = ?, status = ?, updated_at = ?
        WHERE id = ?
      `,
        body.schoolId ?? null,
        sanitizeText(body.schoolName, 200),
        sanitizeText(body.date, 20),
        sanitizeText(body.startTime, 20),
        sanitizeText(body.endTime, 20),
        sanitizeText(body.location, 200),
        sanitizeText(body.description, 2000),
        sanitizeText(body.notes, 2000),
        JSON.stringify(Array.isArray(body.products) ? body.products : []),
        (['upcoming', 'active', 'past'].includes(String(body.status)) ? body.status : 'upcoming') as StandStatus,
        new Date().toISOString(),
        id,
      )
      const row = (await db.get<Record<string, unknown>>('SELECT * FROM stands WHERE id = ?', id))!
      bumpPublicCache()
      send(res, 200, rowToStand(row))
      return true
    }
    if (method === 'DELETE') {
      await db.run('DELETE FROM stands WHERE id = ?', id)
      bumpPublicCache()
      send(res, 200, { ok: true })
      return true
    }
  }

  if (urlPath === '/api/admin/products' && method === 'GET') {
    // Designs are stand products — return approved catalog designs for stand pickers.
    if (!adminCan(admin, 'products') && !adminCan(admin, 'stands')) {
      return forbid(res)
    }

    const rows = await db.all<Record<string, unknown>>(`
      SELECT * FROM designs WHERE status = 'approved' ORDER BY name ASC
    `)
    send(
      res,
      200,
      rows.map((r) => {
        const d = rowToDesign(r)
        return {
          id: d.id,
          name: d.name,
          description: d.description,
          price: d.catalogPriceUsd ?? 0,
          category: d.category,
          image: d.imageUrl,
          emoji: 'package',
          imageGradient: 'from-navy to-electric',
          available: true,
          featured: false,
          displayOrder: 0,
        }
      }),
    )
    return true
  }

  if (urlPath === '/api/admin/products' && method === 'POST') {
    if (!requirePerm(admin, 'products', res)) return true

    const body = await readJson(req)
    const now = new Date().toISOString()
    const id = randomUUID()
    await db.run(
      `
      INSERT INTO products (id, name, description, price, category, image, emoji, image_gradient, available, featured, display_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      id,
      sanitizeText(body.name, 120),
      sanitizeText(body.description, 2000),
      Number(body.price) || 0,
      sanitizeText(body.category, 80),
      sanitizeText(body.image, 500),
      sanitizeText(body.emoji, 64) || 'package',
      sanitizeText(body.imageGradient, 80) || 'from-blue-500 to-cyan-400',
      body.available === false ? 0 : 1,
      body.featured ? 1 : 0,
      Number(body.displayOrder) || 0,
      now,
      now,
    )
    const row = (await db.get<Record<string, unknown>>('SELECT * FROM products WHERE id = ?', id))!
    bumpPublicCache()
    send(res, 201, rowToProduct(row))
    return true
  }

  if (urlPath === '/api/admin/products/upload-image' && method === 'POST') {
    if (!requirePerm(admin, 'products', res)) return true
    try {
      const { filePath } = await parseMultipart(req, {
        allowedExt: ALLOWED_IMAGE_EXT,
        invalidTypeMessage: 'Invalid image type. Use JPG, PNG, WEBP, or GIF.',
        maxFileSize: 12 * 1024 * 1024,
      })
      if (!filePath) {
        send(res, 400, { error: 'Image file is required.' })
        return true
      }
      send(res, 201, { url: `/api/public/uploads/${filePath}` })
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      send(res, 400, {
        error: /maxTotalFileSize|maxFileSize/i.test(msg)
          ? 'That photo is too big — please pick one under 12 MB.'
          : msg,
      })
      return true
    }
  }

  // Upload your own photo for one color of a design (instead of generating).
  const realisticUploadMatch =
    /^\/api\/admin\/designs\/([^/]+)\/realistic-image\/upload$/.exec(urlPath)
  if (realisticUploadMatch && method === 'POST') {
    if (!requirePerm(admin, 'products', res)) return true
    const designId = realisticUploadMatch[1]!
    try {
      const designRow = await db.get<Record<string, unknown>>(
        'SELECT * FROM designs WHERE id = ?',
        designId,
      )
      if (!designRow) {
        send(res, 404, { error: 'Design not found' })
        return true
      }
      const { fields, filePath } = await parseMultipart(req, {
        allowedExt: ALLOWED_IMAGE_EXT,
        invalidTypeMessage: 'Invalid image type. Use JPG, PNG, WEBP, or GIF.',
        maxFileSize: 12 * 1024 * 1024,
      })
      if (!filePath) {
        send(res, 400, { error: 'Image file is required.' })
        return true
      }
      const colorId = String(fields.colorId ?? '').trim()
      if (!colorId) {
        send(res, 400, { error: 'Pick which color this photo is for.' })
        return true
      }
      const { setUploadedColorImage } = await import('./realisticImages.ts')
      const imageUrl = `/api/public/uploads/${filePath}`
      const ok = await setUploadedColorImage(db, rowToDesign(designRow), colorId, imageUrl)
      if (!ok) {
        send(res, 400, { error: 'That color is not offered for this design.' })
        return true
      }
      bumpPublicCache()
      send(res, 201, { ok: true, imageUrl })
      return true
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed'
      send(res, 400, {
        error: /maxTotalFileSize|maxFileSize/i.test(msg)
          ? 'That photo is too big — please pick one under 12 MB.'
          : msg,
      })
      return true
    }
  }

  const productMatch = urlPath.match(/^\/api\/admin\/products\/([^/]+)$/)
  if (productMatch) {
    if (!requirePerm(admin, 'products', res)) return true
    const id = productMatch[1]
    if (method === 'PATCH') {
      const body = await readJson(req)
      await db.run(
        `
        UPDATE products SET
          name = ?, description = ?, price = ?, category = ?, image = ?, emoji = ?,
          image_gradient = ?, available = ?, featured = ?, display_order = ?, updated_at = ?
        WHERE id = ?
      `,
        sanitizeText(body.name, 120),
        sanitizeText(body.description, 2000),
        Number(body.price) || 0,
        sanitizeText(body.category, 80),
        sanitizeText(body.image, 500),
        sanitizeText(body.emoji, 64) || 'package',
        sanitizeText(body.imageGradient, 80) || 'from-blue-500 to-cyan-400',
        body.available === false ? 0 : 1,
        body.featured ? 1 : 0,
        Number(body.displayOrder) || 0,
        new Date().toISOString(),
        id,
      )
      const row = (await db.get<Record<string, unknown>>('SELECT * FROM products WHERE id = ?', id))!
      bumpPublicCache()
      send(res, 200, rowToProduct(row))
      return true
    }
    if (method === 'DELETE') {
      await db.run('DELETE FROM products WHERE id = ?', id)
      bumpPublicCache()
      send(res, 200, { ok: true })
      return true
    }
  }

  if (urlPath === '/api/admin/custom-requests' && method === 'GET') {
    if (!requirePerm(admin, 'requests', res)) return true
    // Hide unpaid estimates — they enter the queue after Stripe payment (status → new).
    const rows = await db.all<Record<string, unknown>>(
      `SELECT * FROM custom_requests
       WHERE status != 'awaiting_payment'
       ORDER BY created_at DESC`,
    )
    send(
      res,
      200,
      rows.map((r) => {
        const mapped = mapCustomRequestRow(r)
        return {
          id: mapped.id,
          name: mapped.name,
          email: mapped.email,
          school: mapped.school,
          description: mapped.description,
          size: mapped.size,
          uploaded_file: mapped.uploaded_file,
          status: mapped.status,
          slice_status: mapped.slice_status,
          slice_error: mapped.slice_error,
          grams_pablo_p1s: mapped.grams_pablo_p1s,
          hours_pablo_p1s: mapped.hours_pablo_p1s,
          grams_court_ender: mapped.grams_court_ender,
          hours_court_ender: mapped.hours_court_ender,
          grams_josh_kobra: mapped.grams_josh_kobra,
          hours_josh_kobra: mapped.hours_josh_kobra,
          worst_printer_id: mapped.worst_printer_id,
          worst_cost_usd: mapped.worst_cost_usd,
          catalog_price_usd: mapped.catalog_price_usd,
          quoted_at: mapped.quoted_at,
          has_gcode: Object.keys(mapped.quote_ids).length > 0,
          quoted_printer_ids: Object.keys(mapped.quote_ids),
          worst_printer_label:
            mapped.worst_printer_id === 'pablo_p1s'
              ? 'P1S'
              : mapped.worst_printer_id === 'court_ender'
                ? 'Ender 3v2'
                : mapped.worst_printer_id === 'josh_kobra'
                  ? 'Kobra X'
                  : mapped.worst_printer_id,
          shipping_name: mapped.shipping_name,
          shipping_line1: mapped.shipping_line1,
          shipping_line2: mapped.shipping_line2,
          shipping_city: mapped.shipping_city,
          shipping_state: mapped.shipping_state,
          shipping_postal: mapped.shipping_postal,
          shipping_country: mapped.shipping_country,
          shipping_method: mapped.shipping_method,
          shipping_usd: mapped.shipping_usd,
          tracking_number: mapped.tracking_number,
          tracking_carrier: mapped.tracking_carrier,
          tracking_url: mapped.tracking_url,
          shipped_at: mapped.shipped_at,
          paid_at: mapped.paid_at,
          created_at: mapped.created_at,
          updated_at: mapped.updated_at,
        }
      }),
    )
    return true
  }

  const adminCustomGcodeMatch = /^\/api\/admin\/custom-requests\/([^/]+)\/gcode$/.exec(urlPath)
  if (adminCustomGcodeMatch && method === 'GET') {
    if (!requirePerm(admin, 'requests', res)) return true
    if (!admin.isMainAdmin) {
      send(res, 403, { error: 'Only the main admin can download sliced G-code.' })
      return true
    }
    const id = adminCustomGcodeMatch[1]!
    const qs = (req.url ?? '').split('?')[1] ?? ''
    const printerId = new URLSearchParams(qs).get('printerId')?.trim() || ''
    try {
      const { buffer, filename } = await downloadCustomRequestGcode(db, id, printerId || null)
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

  if (urlPath === '/api/admin/contact-messages' && method === 'GET') {
    if (!requirePerm(admin, 'messages', res)) return true
    send(res, 200, await db.all('SELECT * FROM contact_messages ORDER BY created_at DESC'))
    return true
  }

  if (urlPath === '/api/admin/mail/recipients' && method === 'GET') {
    if (!requirePerm(admin, 'mail', res)) return true
    // Admin-only mailbox — never list customer accounts as recipients.
    const rows = await db.all<MailUserRow>(
      `SELECT id, email, display_name FROM users
       WHERE role = 'admin'
       ORDER BY lower(email) ASC`,
    )
    send(
      res,
      200,
      rows.map((r) => ({ id: r.id, email: r.email, displayName: r.display_name })),
    )
    return true
  }

  if (urlPath === '/api/admin/mail/unread-count' && method === 'GET') {
    if (!requirePerm(admin, 'mail', res)) return true
    await flushDueScheduledMail(db)
    const countRow = await db.get<{ c: number | string }>(
      `
      SELECT COUNT(*) as c
      FROM mail_recipients r
      JOIN mail_messages m ON m.id = r.message_id
      WHERE r.recipient_id = ?
        AND r.read_at IS NULL
        AND r.deleted_at IS NULL
        AND m.scheduled_at IS NULL
        AND COALESCE(m.is_draft, 0) = 0
    `,
      admin.id,
    )
    const latest = await db.get<{
      id: string
      subject: string
      sender_email: string
      sender_display_name: string | null
    }>(
      `
      SELECT m.id, m.subject, u.email as sender_email, u.display_name as sender_display_name
      FROM mail_recipients r
      JOIN mail_messages m ON m.id = r.message_id
      JOIN users u ON u.id = m.sender_id
      WHERE r.recipient_id = ?
        AND r.read_at IS NULL
        AND r.deleted_at IS NULL
        AND m.scheduled_at IS NULL
        AND COALESCE(m.is_draft, 0) = 0
      ORDER BY m.created_at DESC
      LIMIT 1
    `,
      admin.id,
    )
    send(res, 200, {
      count: Number(countRow?.c ?? 0),
      latestId: latest?.id ?? null,
      latestSubject: latest?.subject ?? null,
      latestFrom: latest
        ? latest.sender_display_name?.trim() || latest.sender_email
        : null,
    })
    return true
  }

  if (urlPath === '/api/admin/mail/signature' && method === 'GET') {
    if (!requirePerm(admin, 'mail', res)) return true
    send(res, 200, { signature: await getAdminMailSignature(admin.id) })
    return true
  }

  if (urlPath === '/api/admin/mail/signature' && method === 'PATCH') {
    if (!requirePerm(admin, 'mail', res)) return true
    const body = await readJson(req)
    const signature = await updateAdminMailSignature(admin.id, body.signature)
    send(res, 200, { signature })
    return true
  }

  if (urlPath === '/api/admin/mail/inbox' && method === 'GET') {
    if (!requirePerm(admin, 'mail', res)) return true
    await flushDueScheduledMail(db)
    await purgeExpiredMailTrash(db)
    // Inbox = messages where you are a recipient (including mail you send yourself).
    const rows = await db.all<{ id: string }>(
      `
      SELECT m.id
      FROM mail_messages m
      JOIN mail_recipients r ON r.message_id = m.id
      WHERE r.recipient_id = ?
        AND r.archived_at IS NULL
        AND r.deleted_at IS NULL
        AND m.scheduled_at IS NULL
        AND COALESCE(m.is_draft, 0) = 0
      ORDER BY m.created_at DESC
    `,
      admin.id,
    )
    const messages = []
    for (const row of rows) {
      const full = await loadMailMessage(db, row.id, admin.id, true)
      if (full) messages.push(full)
    }
    send(res, 200, messages)
    return true
  }

  if (urlPath === '/api/admin/mail/archived' && method === 'GET') {
    if (!requirePerm(admin, 'mail', res)) return true
    await flushDueScheduledMail(db)
    await purgeExpiredMailTrash(db)
    const rows = await db.all<{ id: string }>(
      `
      SELECT m.id
      FROM mail_messages m
      JOIN mail_recipients r ON r.message_id = m.id
      WHERE r.recipient_id = ?
        AND r.archived_at IS NOT NULL
        AND r.deleted_at IS NULL
        AND m.scheduled_at IS NULL
        AND COALESCE(m.is_draft, 0) = 0
      ORDER BY r.archived_at DESC
    `,
      admin.id,
    )
    const messages = []
    for (const row of rows) {
      const full = await loadMailMessage(db, row.id, admin.id, true)
      if (full) messages.push(full)
    }
    send(res, 200, messages)
    return true
  }

  if (urlPath === '/api/admin/mail/scheduled' && method === 'GET') {
    if (!requirePerm(admin, 'mail', res)) return true
    await flushDueScheduledMail(db)
    const now = new Date().toISOString()
    const rows = await db.all<{ id: string }>(
      `
      SELECT id FROM mail_messages
      WHERE sender_id = ?
        AND scheduled_at IS NOT NULL
        AND scheduled_at > ?
        AND COALESCE(is_draft, 0) = 0
        AND sender_deleted_at IS NULL
      ORDER BY scheduled_at ASC
    `,
      admin.id,
      now,
    )
    const messages = []
    for (const row of rows) {
      const full = await loadMailMessage(db, row.id, admin.id, false)
      if (full) messages.push(full)
    }
    send(res, 200, messages)
    return true
  }

  if (urlPath === '/api/admin/mail/drafts' && method === 'GET') {
    if (!requirePerm(admin, 'mail', res)) return true
    const rows = await db.all<{ id: string }>(
      `
      SELECT id FROM mail_messages
      WHERE sender_id = ?
        AND COALESCE(is_draft, 0) = 1
        AND sender_deleted_at IS NULL
      ORDER BY created_at DESC
    `,
      admin.id,
    )
    const messages = []
    for (const row of rows) {
      const full = await loadMailMessage(db, row.id, admin.id, false)
      if (full) messages.push(full)
    }
    send(res, 200, messages)
    return true
  }

  if (urlPath === '/api/admin/mail/drafts' && method === 'POST') {
    if (!requirePerm(admin, 'mail', res)) return true
    const body = await readJson(req)
    const subject = sanitizeText(body.subject, 200)
    const messageBody = sanitizeText(body.body, 8000)
    const draftId = typeof body.id === 'string' ? body.id.trim() : ''
    const recipientIds = Array.isArray(body.recipientIds)
      ? [...new Set(body.recipientIds.map((id) => String(id)).filter(Boolean))]
      : []
    if (!subject.trim() && !messageBody.trim() && recipientIds.length === 0) {
      send(res, 400, { error: 'Nothing to save in this draft.' })
      return true
    }
    const validRecipientIds = await resolveAdminRecipientIds(db, recipientIds)
    const now = new Date().toISOString()
    if (draftId) {
      const existing = await db.get<{ id: string }>(
        `SELECT id FROM mail_messages
         WHERE id = ? AND sender_id = ? AND COALESCE(is_draft, 0) = 1`,
        draftId,
        admin.id,
      )
      if (!existing) {
        send(res, 404, { error: 'Draft not found' })
        return true
      }
      await db.run(
        `UPDATE mail_messages
         SET subject = ?, body = ?, created_at = ?, scheduled_at = NULL, is_draft = 1
         WHERE id = ?`,
        subject || '(no subject)',
        messageBody,
        now,
        draftId,
      )
      await replaceMailRecipients(db, draftId, validRecipientIds)
      const full = await loadMailMessage(db, draftId, admin.id, false)
      send(res, 200, full)
      return true
    }
    const messageId = randomUUID()
    await db.run(
      `INSERT INTO mail_messages
         (id, sender_id, subject, body, created_at, scheduled_at, is_draft)
       VALUES (?, ?, ?, ?, ?, NULL, 1)`,
      messageId,
      admin.id,
      subject || '(no subject)',
      messageBody,
      now,
    )
    await replaceMailRecipients(db, messageId, validRecipientIds)
    const full = await loadMailMessage(db, messageId, admin.id, false)
    send(res, 201, full)
    return true
  }

  if (urlPath === '/api/admin/mail/trash' && method === 'GET') {
    if (!requirePerm(admin, 'mail', res)) return true
    await flushDueScheduledMail(db)
    await purgeExpiredMailTrash(db)
    const cutoff = mailTrashCutoffIso()
    const byId = new Map<
      string,
      Awaited<ReturnType<typeof loadMailMessage>> & { trashSource: 'received' | 'sent' | 'both' }
    >()

    const received = await db.all<{ id: string }>(
      `
      SELECT m.id
      FROM mail_messages m
      JOIN mail_recipients r ON r.message_id = m.id
      WHERE r.recipient_id = ?
        AND r.deleted_at IS NOT NULL
        AND r.deleted_at >= ?
      ORDER BY r.deleted_at DESC
    `,
      admin.id,
      cutoff,
    )
    for (const row of received) {
      const full = await loadMailMessage(db, row.id, admin.id, true)
      if (full) byId.set(row.id, { ...full, trashSource: 'received' })
    }

    const sentTrash = await db.all<{ id: string }>(
      `
      SELECT id FROM mail_messages
      WHERE sender_id = ?
        AND sender_deleted_at IS NOT NULL
        AND sender_deleted_at >= ?
        AND scheduled_at IS NULL
      ORDER BY sender_deleted_at DESC
    `,
      admin.id,
      cutoff,
    )
    for (const row of sentTrash) {
      const full = await loadMailMessage(db, row.id, admin.id, false)
      if (!full) continue
      const existing = byId.get(row.id)
      if (existing) {
        byId.set(row.id, { ...existing, trashSource: 'both', senderDeletedAt: full.senderDeletedAt })
      } else {
        byId.set(row.id, { ...full, trashSource: 'sent' })
      }
    }

    const messages = [...byId.values()].sort((a, b) => {
      const aAt = a.deletedAt || a.senderDeletedAt || a.createdAt
      const bAt = b.deletedAt || b.senderDeletedAt || b.createdAt
      return new Date(bAt).getTime() - new Date(aAt).getTime()
    })
    send(res, 200, messages)
    return true
  }

  if (urlPath === '/api/admin/mail/sent' && method === 'GET') {
    if (!requirePerm(admin, 'mail', res)) return true
    await flushDueScheduledMail(db)
    await purgeExpiredMailTrash(db)
    const rows = await db.all<{ id: string }>(
      `
      SELECT id FROM mail_messages
      WHERE sender_id = ?
        AND sender_deleted_at IS NULL
        AND scheduled_at IS NULL
        AND COALESCE(is_draft, 0) = 0
      ORDER BY created_at DESC
    `,
      admin.id,
    )
    const messages = []
    for (const row of rows) {
      const full = await loadMailMessage(db, row.id, admin.id, false)
      if (full) messages.push(full)
    }
    send(res, 200, messages)
    return true
  }

  if (urlPath === '/api/admin/mail' && method === 'POST') {
    if (!requirePerm(admin, 'mail', res)) return true
    await flushDueScheduledMail(db)
    const body = await readJson(req)
    const subject = sanitizeText(body.subject, 200)
    const messageBody = sanitizeText(body.body, 8000)
    const draftId = typeof body.draftId === 'string' ? body.draftId.trim() : ''
    const recipientIds = Array.isArray(body.recipientIds)
      ? [...new Set(body.recipientIds.map((id) => String(id)).filter(Boolean))]
      : []
    if (!subject.trim() && !messageBody.trim()) {
      send(res, 400, { error: 'Subject or message is required.' })
      return true
    }
    if (recipientIds.length === 0) {
      send(res, 400, { error: 'Pick at least one recipient.' })
      return true
    }

    let scheduledAt: string | null = null
    if (body.scheduledAt != null && String(body.scheduledAt).trim()) {
      const parsed = new Date(String(body.scheduledAt))
      if (Number.isNaN(parsed.getTime())) {
        send(res, 400, { error: 'Invalid schedule time.' })
        return true
      }
      if (parsed.getTime() < Date.now() + 60_000) {
        send(res, 400, { error: 'Schedule time must be at least 1 minute from now.' })
        return true
      }
      scheduledAt = parsed.toISOString()
    }

    const validRecipientIds = await resolveAdminRecipientIds(db, recipientIds)
    if (validRecipientIds.length === 0) {
      send(res, 400, { error: 'No valid admin recipients found.' })
      return true
    }
    const now = new Date().toISOString()
    let messageId = draftId
    if (draftId) {
      const existing = await db.get<{ id: string }>(
        `SELECT id FROM mail_messages
         WHERE id = ? AND sender_id = ? AND COALESCE(is_draft, 0) = 1`,
        draftId,
        admin.id,
      )
      if (!existing) {
        send(res, 404, { error: 'Draft not found' })
        return true
      }
      await db.run(
        `UPDATE mail_messages
         SET subject = ?, body = ?, created_at = ?, scheduled_at = ?, is_draft = 0
         WHERE id = ?`,
        subject || '(no subject)',
        messageBody,
        now,
        scheduledAt,
        draftId,
      )
      await replaceMailRecipients(db, draftId, validRecipientIds)
    } else {
      messageId = randomUUID()
      await db.run(
        `INSERT INTO mail_messages
           (id, sender_id, subject, body, created_at, scheduled_at, is_draft)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
        messageId,
        admin.id,
        subject || '(no subject)',
        messageBody,
        now,
        scheduledAt,
      )
      await replaceMailRecipients(db, messageId, validRecipientIds)
    }
    if (!scheduledAt) {
      runInBackground('push-mail', () =>
        notifyAdminUsers(db, validRecipientIds, {
          title: 'New PrintX mail',
          body: subject || '(no subject)',
          url: '/mail',
        }),
      )
    }
    // Always return a DTO for the sender (scheduled msgs are hidden from recipients until due).
    const created = await loadMailMessage(db, messageId, admin.id, false)
    if (!created) {
      send(res, 201, {
        id: messageId,
        subject: subject || '(no subject)',
        body: messageBody,
        createdAt: now,
        senderId: admin.id,
        senderEmail: admin.email,
        senderDisplayName: admin.displayName,
        readAt: null,
        archivedAt: null,
        deletedAt: null,
        senderDeletedAt: null,
        scheduledAt,
        isDraft: false,
        recipients: [],
      })
      return true
    }
    send(res, 201, created)
    return true
  }

  const mailMatch = urlPath.match(
    /^\/api\/admin\/mail\/([^/]+)(?:\/(read|unread|archive|unarchive|restore|cancel-schedule|send-now))?$/,
  )
  if (mailMatch) {
    if (!requirePerm(admin, 'mail', res)) return true
    const messageId = mailMatch[1]
    const action = mailMatch[2]

    if (method === 'PATCH' && (action === 'read' || action === 'unread')) {
      const asRecipient = await db.get<{ id: string; deleted_at: string | null }>(
        'SELECT id, deleted_at FROM mail_recipients WHERE message_id = ? AND recipient_id = ?',
        messageId,
        admin.id,
      )
      if (!asRecipient || asRecipient.deleted_at) {
        send(res, 404, { error: 'Message not found' })
        return true
      }
      await db.run(
        `
        UPDATE mail_recipients
        SET read_at = ?
        WHERE message_id = ? AND recipient_id = ?
      `,
        action === 'read' ? new Date().toISOString() : null,
        messageId,
        admin.id,
      )
      const full = await loadMailMessage(db, messageId, admin.id, true)
      if (!full) {
        send(res, 404, { error: 'Message not found' })
        return true
      }
      send(res, 200, full)
      return true
    }

    if (method === 'PATCH' && (action === 'archive' || action === 'unarchive')) {
      const asRecipient = await db.get<{ id: string; deleted_at: string | null }>(
        'SELECT id, deleted_at FROM mail_recipients WHERE message_id = ? AND recipient_id = ?',
        messageId,
        admin.id,
      )
      if (!asRecipient || asRecipient.deleted_at) {
        send(res, 404, { error: 'Message not found' })
        return true
      }
      await db.run(
        `
        UPDATE mail_recipients
        SET archived_at = ?
        WHERE message_id = ? AND recipient_id = ?
      `,
        action === 'archive' ? new Date().toISOString() : null,
        messageId,
        admin.id,
      )
      const full = await loadMailMessage(db, messageId, admin.id, true)
      if (!full) {
        send(res, 404, { error: 'Message not found' })
        return true
      }
      send(res, 200, full)
      return true
    }

    if (method === 'PATCH' && action === 'cancel-schedule') {
      await flushDueScheduledMail(db)
      const row = await db.get<{ id: string; scheduled_at: string | null }>(
        `
        SELECT id, scheduled_at FROM mail_messages
        WHERE id = ? AND sender_id = ?
      `,
        messageId,
        admin.id,
      )
      const now = new Date().toISOString()
      if (!row?.scheduled_at || row.scheduled_at <= now) {
        send(res, 404, { error: 'Scheduled message not found' })
        return true
      }
      await db.run('DELETE FROM mail_messages WHERE id = ?', messageId)
      send(res, 200, { ok: true })
      return true
    }

    if (method === 'PATCH' && action === 'send-now') {
      await flushDueScheduledMail(db)
      const row = await db.get<{ id: string; scheduled_at: string | null }>(
        `
        SELECT id, scheduled_at FROM mail_messages
        WHERE id = ? AND sender_id = ?
      `,
        messageId,
        admin.id,
      )
      const now = new Date().toISOString()
      if (!row?.scheduled_at || row.scheduled_at <= now) {
        send(res, 404, { error: 'Scheduled message not found' })
        return true
      }
      await db.run(
        `
        UPDATE mail_messages
        SET scheduled_at = NULL, created_at = ?
        WHERE id = ?
      `,
        now,
        messageId,
      )
      // Mark self-recipient as read now that it is delivered.
      await db.run(
        `
        UPDATE mail_recipients
        SET read_at = ?
        WHERE message_id = ? AND recipient_id = ? AND read_at IS NULL
      `,
        now,
        messageId,
        admin.id,
      )
      const recipients = await db.all<{ recipient_id: string; subject: string }>(
        `SELECT r.recipient_id, m.subject
         FROM mail_recipients r
         JOIN mail_messages m ON m.id = r.message_id
         WHERE r.message_id = ?`,
        messageId,
      )
      runInBackground('push-send-now', () =>
        notifyAdminUsers(
          db,
          recipients.map((r) => r.recipient_id),
          {
            title: 'New PrintX mail',
            body: recipients[0]?.subject || '(no subject)',
            url: '/mail',
          },
        ),
      )
      const full = await loadMailMessage(db, messageId, admin.id, false)
      if (!full) {
        send(res, 404, { error: 'Message not found' })
        return true
      }
      send(res, 200, full)
      return true
    }

    if (method === 'PATCH' && action === 'restore') {
      await purgeExpiredMailTrash(db)
      const asRecipient = await db.get<{ id: string; deleted_at: string | null; archived_at: string | null }>(
        'SELECT id, deleted_at, archived_at FROM mail_recipients WHERE message_id = ? AND recipient_id = ?',
        messageId,
        admin.id,
      )
      const asSender = await db.get<{ id: string; sender_deleted_at: string | null }>(
        'SELECT id, sender_deleted_at FROM mail_messages WHERE id = ? AND sender_id = ?',
        messageId,
        admin.id,
      )
      const canRestoreReceived = Boolean(asRecipient?.deleted_at)
      const canRestoreSent = Boolean(asSender?.sender_deleted_at && asSender.sender_deleted_at >= mailTrashCutoffIso())
      if (!canRestoreReceived && !canRestoreSent) {
        send(res, 404, { error: 'Message not found in Trash' })
        return true
      }
      if (canRestoreReceived) {
        await db.run(
          `UPDATE mail_recipients SET deleted_at = NULL WHERE message_id = ? AND recipient_id = ?`,
          messageId,
          admin.id,
        )
      }
      if (canRestoreSent) {
        await db.run(`UPDATE mail_messages SET sender_deleted_at = NULL WHERE id = ? AND sender_id = ?`, messageId, admin.id)
      }
      const full = canRestoreReceived
        ? await loadMailMessage(db, messageId, admin.id, true)
        : await loadMailMessage(db, messageId, admin.id, false)
      if (!full) {
        send(res, 404, { error: 'Message not found' })
        return true
      }
      send(res, 200, {
        ...full,
        trashSource: canRestoreReceived && canRestoreSent ? 'both' : canRestoreSent ? 'sent' : 'received',
      })
      return true
    }

    if (method === 'DELETE' && !action) {
      await purgeExpiredMailTrash(db)
      const params = new URL(req.url || '', 'http://localhost').searchParams
      const forever = params.get('forever') === '1'
      const mailbox = params.get('mailbox') || ''
      const now = new Date().toISOString()

      if (forever || mailbox === 'trash') {
        const asRecipient = await db.get<{ id: string; deleted_at: string | null }>(
          'SELECT id, deleted_at FROM mail_recipients WHERE message_id = ? AND recipient_id = ?',
          messageId,
          admin.id,
        )
        if (asRecipient?.deleted_at) {
          await db.run('DELETE FROM mail_recipients WHERE id = ?', asRecipient.id)
        }
        const asSender = await db.get<{ id: string; sender_deleted_at: string | null }>(
          'SELECT id, sender_deleted_at FROM mail_messages WHERE id = ? AND sender_id = ?',
          messageId,
          admin.id,
        )
        if (asSender?.sender_deleted_at) {
          const remaining = await db.get<{ c: number | string }>(
            'SELECT COUNT(*) as c FROM mail_recipients WHERE message_id = ?',
            messageId,
          )
          if (Number(remaining?.c ?? 0) === 0) {
            await db.run('DELETE FROM mail_messages WHERE id = ?', messageId)
          } else {
            await db.run(
              `UPDATE mail_messages SET sender_deleted_at = ? WHERE id = ?`,
              '1970-01-01T00:00:00.000Z',
              messageId,
            )
          }
        }
        if (!asRecipient?.deleted_at && !asSender?.sender_deleted_at) {
          send(res, 404, { error: 'Message not found in Trash' })
          return true
        }
        send(res, 200, { ok: true })
        return true
      }

      // Drafts: discard permanently (not kept in Trash).
      if (mailbox === 'drafts') {
        const draft = await db.get<{ id: string }>(
          `SELECT id FROM mail_messages
           WHERE id = ? AND sender_id = ? AND COALESCE(is_draft, 0) = 1`,
          messageId,
          admin.id,
        )
        if (!draft) {
          send(res, 404, { error: 'Draft not found' })
          return true
        }
        await db.run('DELETE FROM mail_recipients WHERE message_id = ?', messageId)
        await db.run('DELETE FROM mail_messages WHERE id = ?', messageId)
        send(res, 200, { ok: true })
        return true
      }

      // Soft-delete → Trash (kept 30 days, then purged).
      if (mailbox === 'sent') {
        const asSender = await db.get<{ id: string; sender_deleted_at: string | null }>(
          'SELECT id, sender_deleted_at FROM mail_messages WHERE id = ? AND sender_id = ?',
          messageId,
          admin.id,
        )
        if (!asSender || asSender.sender_deleted_at) {
          send(res, 404, { error: 'Message not found' })
          return true
        }
        await db.run(`UPDATE mail_messages SET sender_deleted_at = ? WHERE id = ?`, now, messageId)
        const full = await loadMailMessage(db, messageId, admin.id, false)
        send(res, 200, full ? { ...full, trashSource: 'sent' as const } : { ok: true })
        return true
      }

      const asRecipient = await db.get<{ id: string; deleted_at: string | null }>(
        'SELECT id, deleted_at FROM mail_recipients WHERE message_id = ? AND recipient_id = ?',
        messageId,
        admin.id,
      )
      if (asRecipient && !asRecipient.deleted_at) {
        await db.run(`UPDATE mail_recipients SET deleted_at = ? WHERE id = ?`, now, asRecipient.id)
        const full = await loadMailMessage(db, messageId, admin.id, true)
        send(res, 200, full ? { ...full, trashSource: 'received' as const } : { ok: true })
        return true
      }

      send(res, 404, { error: 'Message not found' })
      return true
    }
  }

  const contactMatch = urlPath.match(/^\/api\/admin\/contact-messages\/([^/]+)$/)
  if (contactMatch) {
    if (!requirePerm(admin, 'messages', res)) return true
    const id = contactMatch[1]
    if (method === 'PATCH') {
      const body = await readJson(req)
      const status = body.status === 'read' ? 'read' : 'new'
      await db.run('UPDATE contact_messages SET status = ? WHERE id = ?', status, id)
      send(res, 200, { ok: true })
      return true
    }
    if (method === 'DELETE') {
      await db.run('DELETE FROM contact_messages WHERE id = ?', id)
      send(res, 200, { ok: true })
      return true
    }
  }

  const requestMatch = urlPath.match(/^\/api\/admin\/custom-requests\/([^/]+)$/)
  if (requestMatch && (method === 'PATCH' || method === 'DELETE')) {
    if (!requirePerm(admin, 'requests', res)) return true
    const id = requestMatch[1]!

    if (method === 'DELETE') {
      const row = await db.get<{ uploaded_file: string | null }>(
        'SELECT uploaded_file FROM custom_requests WHERE id = ?',
        id,
      )
      if (!row) {
        send(res, 404, { error: 'Request not found' })
        return true
      }
      // Clear CS artifacts before removing the row.
      await clearCustomRequestSliceArtifacts(db, id)
      await db.run('DELETE FROM custom_requests WHERE id = ?', id)
      const fileName = row.uploaded_file?.trim()
      if (fileName && !fileName.includes('..') && !fileName.includes('/') && !fileName.includes('\\')) {
        try {
          const uploadsDir = await getUploadsDir()
          const full = path.join(uploadsDir, fileName)
          if (full.startsWith(uploadsDir) && fs.existsSync(full)) fs.unlinkSync(full)
        } catch {
          /* best-effort local cleanup */
        }
      }
      send(res, 200, { ok: true })
      return true
    }

    const body = await readJson(req)
    const status = ['new', 'reviewing', 'approved', 'declined', 'completed', 'awaiting_payment'].includes(
      String(body.status),
    )
      ? (body.status as RequestStatus)
      : 'new'
    // Accept / decline (and other status changes) are main-admin only.
    if (!admin.isMainAdmin) {
      send(res, 403, { error: 'Only the main admin can accept or decline custom print requests.' })
      return true
    }
    if (status === 'declined') {
      // Keep contact info; only remove Cloud Slicer sliced artifacts.
      await clearCustomRequestSliceArtifacts(db, id)
    }
    await db.run('UPDATE custom_requests SET status = ?, updated_at = ? WHERE id = ?', status, new Date().toISOString(), id)
    send(res, 200, { ok: true })
    return true
  }

  if (urlPath === '/api/admin/schools' && (method === 'GET' || method === 'POST')) {
    send(res, 410, { error: 'Schools management has been removed.' })
    return true
  }

  const schoolMatch = urlPath.match(/^\/api\/admin\/schools\/([^/]+)$/)
  if (schoolMatch && (method === 'PATCH' || method === 'DELETE')) {
    send(res, 410, { error: 'Schools management has been removed.' })
    return true
  }

  if (urlPath === '/api/admin/content' && method === 'GET') {
    // Website copy editing removed from the portal; status toggle still needs a read.
    if (!adminCan(admin, 'website_status') && !adminCan(admin, 'settings')) {
      return forbid(res)
    }
    send(res, 200, await getWebsiteContent(db))
    return true
  }

  if (urlPath === '/api/admin/content' && method === 'PATCH') {
    const body = await readJson(req)
    const keys = Object.keys(body)
    // Only pause/unpause remains editable from the portal (Settings).
    const onlyWebsiteOnline = keys.length > 0 && keys.every((k) => k === 'websiteOnline')
    if (!onlyWebsiteOnline) {
      send(res, 403, { error: 'Website content editing has been removed from the portal.' })
      return true
    }
    if (!requirePerm(admin, 'website_status', res)) return true
    await setWebsiteSetting(db, 'websiteOnline', body.websiteOnline)
    bumpPublicCache()
    send(res, 200, await getWebsiteContent(db))
    return true
  }

  if (urlPath === '/api/admin/settings/password' && method === 'PATCH') {
    if (!admin.isMainAdmin) {
      return forbid(res, 'Only the main admin can change passwords. Ask the main admin to update yours.')
    }
    if (!requirePerm(admin, 'settings', res)) return true
    const body = await readJson(req)
    const ok = await updateAdminPassword(
      db,
      admin.id,
      String(body.currentPassword ?? ''),
      String(body.newPassword ?? ''),
    )
    if (!ok) {
      send(res, 400, { error: 'Current password is incorrect' })
      return true
    }
    {
      const opts = cookieOptions(req)
      send(res, 200, { ok: true }, [clearSessionCookieHeader(opts.secure, opts.domain)])
    }
    return true
  }

  if (urlPath === '/api/admin/settings/email' && method === 'PATCH') {
    if (!admin.isMainAdmin) {
      return forbid(res, 'Only the main admin can change their email. Ask the main admin to update yours.')
    }
    if (!requirePerm(admin, 'settings', res)) return true
    const body = await readJson(req)
    const result = await updateAdminEmail(
      admin.id,
      body.email,
      String(body.currentPassword ?? ''),
    )
    if (!result.ok) {
      send(res, 400, { error: result.error })
      return true
    }
    {
      const opts = cookieOptions(req)
      send(res, 200, { ok: true, email: result.email }, [
        clearSessionCookieHeader(opts.secure, opts.domain),
      ])
    }
    return true
  }

  if (urlPath === '/api/admin/settings/profile' && method === 'PATCH') {
    if (!requirePerm(admin, 'settings', res)) return true
    const body = await readJson(req)
    const displayName = await updateAdminDisplayName(admin.id, body.displayName)
    send(res, 200, { ok: true, displayName })
    return true
  }

  if (urlPath === '/api/admin/settings/filament-colors' && method === 'GET') {
    const { filamentStock } = await import('./catalog.ts')
    const { parseOwnedColorIds, solidBuiltinColors } = await import('../shared/colors.ts')
    const row = await db.get<{ owned_color_ids: string | null }>(
      `SELECT owned_color_ids FROM users WHERE id = ?`,
      admin.id,
    )
    send(res, 200, {
      mine: parseOwnedColorIds(row?.owned_color_ids),
      inStock: await filamentStock(db),
      colors: solidBuiltinColors().map((c) => ({ id: c.id, name: c.name, hex: c.hex })),
    })
    return true
  }

  if (urlPath === '/api/admin/settings/filament-colors' && method === 'PATCH') {
    const { filamentStock } = await import('./catalog.ts')
    const { parseOwnedColorIds } = await import('../shared/colors.ts')
    const body = await readJson(req)
    const mine = parseOwnedColorIds(body.colorIds)
    await db.run(`UPDATE users SET owned_color_ids = ? WHERE id = ?`, JSON.stringify(mine), admin.id)
    send(res, 200, { mine, inStock: await filamentStock(db) })
    return true
  }

  if (urlPath === '/api/admin/settings/cloud-slicer' && method === 'GET') {
    const { maskCloudSlicerToken } = await import('./cloudSlicer.ts')
    const { seedCatalogDefaults, listPrinters } = await import('./catalog.ts')
    await seedCatalogDefaults(db)
    const printers = await listPrinters(db)
    const ownedPrinterId =
      printers.find((p) => p.ownerUserId === admin.id)?.id ?? null
    // Credentials live on the printer row (stable). Fall back to legacy user columns once.
    const printerCreds = ownedPrinterId
      ? await db.get<{
          cloud_slicer_token: string
          cloud_slicer_printer_id: string
          cloud_slicer_filament_id: string
          cloud_slicer_configured_at: string | null
        }>(
          `SELECT cloud_slicer_token, cloud_slicer_printer_id, cloud_slicer_filament_id, cloud_slicer_configured_at
           FROM printers WHERE id = ?`,
          ownedPrinterId,
        )
      : null
    const userCreds = await db.get<{
      cloud_slicer_token: string
      cloud_slicer_printer_id: string
      cloud_slicer_filament_id: string
      cloud_slicer_configured_at: string | null
    }>(
      `SELECT cloud_slicer_token, cloud_slicer_printer_id, cloud_slicer_filament_id, cloud_slicer_configured_at
       FROM users WHERE id = ?`,
      admin.id,
    )
    const token =
      (printerCreds?.cloud_slicer_token || '').trim() || (userCreds?.cloud_slicer_token || '').trim()
    const printerIdCs =
      (printerCreds?.cloud_slicer_printer_id || '').trim() ||
      (userCreds?.cloud_slicer_printer_id || '').trim()
    const filamentId =
      (printerCreds?.cloud_slicer_filament_id || '').trim() ||
      (userCreds?.cloud_slicer_filament_id || '').trim()
    const configuredAt =
      printerCreds?.cloud_slicer_configured_at || userCreds?.cloud_slicer_configured_at || null
    send(res, 200, {
      tokenMasked: maskCloudSlicerToken(token),
      hasToken: Boolean(token),
      printerId: printerIdCs,
      filamentId,
      configuredAt,
      ownedPrinterId,
      printers: printers.map((p) => ({
        id: p.id,
        ownerLabel: p.ownerLabel,
        modelName: p.modelName,
        ownerUserId: p.ownerUserId,
      })),
    })
    return true
  }

  if (urlPath === '/api/admin/settings/cloud-slicer' && method === 'PATCH') {
    const body = await readJson(req)
    const { seedCatalogDefaults, listPrinters } = await import('./catalog.ts')
    await seedCatalogDefaults(db)
    const printers = await listPrinters(db)
    const currentlyOwned = printers.find((p) => p.ownerUserId === admin.id)?.id ?? ''
    const validPrinterIds = new Set(['pablo_p1s', 'court_ender', 'josh_kobra'])

    // Never wipe the printer link when the client omits / sends empty ownedPrinterId.
    const requestedPrinter = body.ownedPrinterId !== undefined
      ? sanitizeText(String(body.ownedPrinterId ?? ''), 60)
      : currentlyOwned
    const printxPrinterId = requestedPrinter || currentlyOwned
    if (!printxPrinterId || !validPrinterIds.has(printxPrinterId)) {
      send(res, 400, {
        error: 'Pick your PrintX printer (P1S, Ender 3v2, or Anycubic Kobra X) before saving.',
      })
      return true
    }

    const existingPrinter = await db.get<{
      cloud_slicer_token: string
      cloud_slicer_printer_id: string
      cloud_slicer_filament_id: string
    }>(
      `SELECT cloud_slicer_token, cloud_slicer_printer_id, cloud_slicer_filament_id
       FROM printers WHERE id = ?`,
      printxPrinterId,
    )
    const existingUser = await db.get<{
      cloud_slicer_token: string
      cloud_slicer_printer_id: string
      cloud_slicer_filament_id: string
    }>(
      `SELECT cloud_slicer_token, cloud_slicer_printer_id, cloud_slicer_filament_id FROM users WHERE id = ?`,
      admin.id,
    )

    const tokenRaw = body.token !== undefined ? String(body.token ?? '').trim() : undefined
    const printerIdCs = sanitizeText(
      String(
        body.printerId ??
          existingPrinter?.cloud_slicer_printer_id ??
          existingUser?.cloud_slicer_printer_id ??
          '',
      ),
      120,
    )
    const filamentId = sanitizeText(
      String(
        body.filamentId ??
          existingPrinter?.cloud_slicer_filament_id ??
          existingUser?.cloud_slicer_filament_id ??
          '',
      ),
      120,
    )

    let token =
      (existingPrinter?.cloud_slicer_token || '').trim() ||
      (existingUser?.cloud_slicer_token || '').trim()
    if (tokenRaw !== undefined) {
      if (body.clearToken) token = ''
      else if (tokenRaw) token = tokenRaw
      // Blank token without clearToken → keep existing (password-manager empty fields).
    }

    const now = new Date().toISOString()
    const configured =
      token.trim() && printerIdCs.trim() && filamentId.trim() ? now : null

    // Store on the printer — this is what quoting / approve / G-code download use.
    await db.run(
      `UPDATE printers SET
        cloud_slicer_token = ?,
        cloud_slicer_printer_id = ?,
        cloud_slicer_filament_id = ?,
        cloud_slicer_configured_at = ?,
        owner_user_id = ?
       WHERE id = ?`,
      token,
      printerIdCs,
      filamentId,
      configured,
      admin.id,
      printxPrinterId,
    )
    // Drop this admin's claim on any other printer only (never wipe all links to NULL).
    await db.run(
      `UPDATE printers SET owner_user_id = NULL WHERE owner_user_id = ? AND id != ?`,
      admin.id,
      printxPrinterId,
    )
    // Keep legacy user columns in sync for older UI reads.
    await db.run(
      `UPDATE users SET
        cloud_slicer_token = ?,
        cloud_slicer_printer_id = ?,
        cloud_slicer_filament_id = ?,
        cloud_slicer_configured_at = ?
       WHERE id = ?`,
      token,
      printerIdCs,
      filamentId,
      configured,
      admin.id,
    )

    // Never await slicing here — local quotes can take many minutes and exhaust the
    // Postgres session pool (pool max 1), which makes Designs/Settings look broken.
    if (configured && token.trim() && printerIdCs.trim() && filamentId.trim()) {
      const { scheduleFillMissingQuotesForPrinter } = await import('./catalogApi.ts')
      scheduleFillMissingQuotesForPrinter(printxPrinterId)
    }

    const { maskCloudSlicerToken } = await import('./cloudSlicer.ts')
    send(res, 200, {
      ok: true,
      tokenMasked: maskCloudSlicerToken(token),
      hasToken: Boolean(token.trim()),
      printerId: printerIdCs,
      filamentId,
      configuredAt: configured,
      ownedPrinterId: printxPrinterId,
      filledMissingQuotes: 0,
      fillWarnings: [],
      quotingInBackground: Boolean(configured && token.trim() && printerIdCs.trim() && filamentId.trim()),
    })
    return true
  }

  if (urlPath === '/api/admin/users' && method === 'GET') {
    if (!admin.isMainAdmin) {
      return forbid(res, 'Only the main admin can manage accounts.')
    }
    send(res, 200, await listAdminUsers())
    return true
  }

  if (urlPath === '/api/admin/users' && method === 'POST') {
    if (!admin.isMainAdmin) {
      return forbid(res, 'Only the main admin can create accounts.')
    }
    const body = await readJson(req)
    const email = sanitizeEmail(body.email)
    const password = typeof body.password === 'string' ? body.password : ''
    try {
      const created = await createAdminUser(
        email,
        password,
        body.permissions && typeof body.permissions === 'object'
          ? (body.permissions as Record<string, boolean>)
          : undefined,
        body.displayName,
      )
      if (!created) {
        send(res, 400, {
          error:
            'Could not create admin. Use a valid unique email and password (8+ characters). The main admin email is reserved.',
        })
        return true
      }
      send(res, 201, created)
    } catch (err) {
      console.error('[printx] create admin failed', err)
      send(res, 500, { error: 'Could not create admin account. Try again.' })
    }
    return true
  }

  const userPasswordMatch = urlPath.match(/^\/api\/admin\/users\/([^/]+)\/password$/)
  if (userPasswordMatch && method === 'PATCH') {
    if (!admin.isMainAdmin) {
      return forbid(res, 'Only the main admin can change passwords for other admins.')
    }
    const targetId = userPasswordMatch[1]
    const body = await readJson(req)
    const result = await setAdminPasswordByMain(admin.id, targetId, String(body.password ?? ''))
    if (!result.ok) {
      send(res, 400, { error: result.error })
      return true
    }
    send(res, 200, { ok: true })
    return true
  }

  const userEmailMatch = urlPath.match(/^\/api\/admin\/users\/([^/]+)\/email$/)
  if (userEmailMatch && method === 'PATCH') {
    if (!admin.isMainAdmin) {
      return forbid(res, 'Only the main admin can change emails for other admins.')
    }
    const targetId = userEmailMatch[1]
    const body = await readJson(req)
    const result = await setAdminEmailByMain(admin.id, targetId, body.email)
    if (!result.ok) {
      send(res, 400, { error: result.error })
      return true
    }
    send(res, 200, { ok: true, email: result.email })
    return true
  }

  const userMatch = urlPath.match(/^\/api\/admin\/users\/([^/]+)$/)
  if (userMatch) {
    if (!admin.isMainAdmin) {
      return forbid(res, 'Only the main admin can manage accounts.')
    }
    const targetId = userMatch[1]
    if (method === 'PATCH') {
      const body = await readJson(req)
      const updated = await updateAdminPermissions(
        targetId,
        body.permissions && typeof body.permissions === 'object'
          ? (body.permissions as Record<string, boolean>)
          : {},
      )
      if (!updated) {
        send(res, 400, { error: 'Cannot update permissions for this admin.' })
        return true
      }
      send(res, 200, updated)
      return true
    }
    if (method === 'DELETE') {
      if (!admin.isMainAdmin) {
        return forbid(res, 'Only the main admin can delete accounts.')
      }
      const result = await deleteAdminUser(admin.id, targetId)
      if (!result.ok) {
        send(res, 400, { error: result.error })
        return true
      }
      send(res, 200, { ok: true })
      return true
    }
  }

  return false
}
