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
import { notifyContactMessage, notifyCustomRequest } from './mail.ts'
import {
  getCachedBootstrap,
  invalidateBootstrapCache,
  setCachedBootstrap,
} from './bootstrapCache.ts'
import { syncStandLifecycle } from './standLifecycle.ts'
import type { PermissionKey } from '../shared/permissions.ts'
import { validateStandSchedule } from '../shared/standSchedule.ts'
import type { RequestStatus, StandStatus } from './types.ts'

const ALLOWED_UPLOAD_EXT = new Set(['.stl', '.obj'])
const ALLOWED_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif'])
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024
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
  opts?: { allowedExt?: Set<string>; invalidTypeMessage?: string },
): Promise<{ fields: Record<string, string>; filePath: string | null }> {
  const allowedExt = opts?.allowedExt ?? ALLOWED_UPLOAD_EXT
  const invalidTypeMessage = opts?.invalidTypeMessage ?? 'Invalid file type. Only .stl and .obj allowed.'
  const uploadsDir = await getUploadsDir()
  const form = formidable({
    uploadDir: uploadsDir,
    keepExtensions: true,
    maxFileSize: MAX_UPLOAD_BYTES,
    multiples: false,
  })

  return new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) return reject(err)
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
        filePath = safeName
      }
      resolve({ fields: normalized, filePath })
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
  const due = await db.all<{ id: string }>(
    `
    SELECT id FROM mail_messages
    WHERE scheduled_at IS NOT NULL AND scheduled_at <= ?
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
  }>(
    `
    SELECT m.id, m.subject, m.body, m.created_at, m.sender_id, m.sender_deleted_at, m.scheduled_at,
           u.email as sender_email, u.display_name as sender_display_name
    FROM mail_messages m
    JOIN users u ON u.id = m.sender_id
    WHERE m.id = ?
  `,
    messageId,
  )
  if (!msg) return null

  let readAt: string | null = null
  let archivedAt: string | null = null
  let deletedAt: string | null = null
  if (asRecipient) {
    // Hold scheduled messages until flush delivers them.
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
    recipients: recipients.map((r) => ({
      id: r.id,
      email: r.email,
      displayName: r.display_name,
    })),
  }
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, urlPath: string, method: string): Promise<boolean> {
  // Dev/preview middleware hits the router; production also short-circuits in production.ts.
  if (urlPath === '/api/health' && method === 'GET') {
    res.setHeader('Cache-Control', 'no-store')
    send(res, 200, { ok: true })
    return true
  }

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

    const [standRows, productRows, schools] = await Promise.all([
      db.all<Record<string, unknown>>(`
        SELECT * FROM stands WHERE status IN ('upcoming', 'active') ORDER BY date ASC, start_time ASC
      `),
      db.all<Record<string, unknown>>(`
        SELECT * FROM products ORDER BY display_order ASC, name ASC
      `),
      db.all('SELECT * FROM schools WHERE active = 1 ORDER BY name ASC'),
    ])

    const body = {
      stands: standRows.map((r) => publicStand(rowToStand(r))),
      // Past stands stay in admin only — never shown on the public site.
      pastStands: [],
      products: productRows.map(rowToProduct),
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
      const { fields, filePath } = await parseMultipart(req)
      const now = new Date().toISOString()
      const id = randomUUID()
      const name = sanitizeText(fields.name, 120)
      const email = sanitizeEmail(fields.email)
      const school = sanitizeText(fields.school, 200)
      const description = sanitizeText(fields.description, 3000)
      const size = sanitizeText(fields.size, 100)
      await db.run(
        `
        INSERT INTO custom_requests (id, name, email, school, description, size, uploaded_file, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)
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
      void notifyCustomRequest({ name, email, school, description, size })
      send(res, 201, { ok: true, id })
    } catch (e) {
      send(res, 400, { error: e instanceof Error ? e.message : 'Upload failed' })
    }
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
    void notifyContactMessage({ name, email, inquiryType, message })
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
    const uploadsDir = await getUploadsDir()
    const filePath = path.join(uploadsDir, filename)
    if (!filePath.startsWith(uploadsDir) || !fs.existsSync(filePath)) {
      send(res, 404, { error: 'File not found' })
      return true
    }
    const ext = path.extname(filename).toLowerCase()
    res.statusCode = 200
    res.setHeader('Content-Type', IMAGE_MIME[ext] ?? 'application/octet-stream')
    res.setHeader('Cache-Control', 'public, max-age=86400')
    fs.createReadStream(filePath).pipe(res)
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

  const uploadMatch = urlPath.match(/^\/api\/admin\/uploads\/([^/]+)$/)
  if (uploadMatch && method === 'GET') {
    const adminUser = await requireAdmin(req)
    if (!adminUser) {
      send(res, 401, { error: 'Unauthorized' })
      return true
    }
    if (!requirePerm(adminUser, 'requests', res)) return true
    const filename = uploadMatch[1] ?? ''
    if (!/^[\w-]+\.(stl|obj)$/i.test(filename)) {
      send(res, 400, { error: 'Invalid file name' })
      return true
    }
    const uploadsDir = await getUploadsDir()
    const filePath = path.join(uploadsDir, filename)
    if (!filePath.startsWith(uploadsDir) || !fs.existsSync(filePath)) {
      send(res, 404, { error: 'File not found' })
      return true
    }
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    fs.createReadStream(filePath).pipe(res)
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
      (await db.get<{ c: number | string }>('SELECT COUNT(*) as c FROM products WHERE available = 1'))?.c ?? 0,
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
    // Stands editor also needs the product list
    if (!adminCan(admin, 'products') && !adminCan(admin, 'stands')) {
      return forbid(res)
    }

    const rows = await db.all<Record<string, unknown>>('SELECT * FROM products ORDER BY display_order ASC')
    send(res, 200, rows.map(rowToProduct))
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
      })
      if (!filePath) {
        send(res, 400, { error: 'Image file is required.' })
        return true
      }
      send(res, 201, { url: `/api/public/uploads/${filePath}` })
      return true
    } catch (err) {
      send(res, 400, { error: err instanceof Error ? err.message : 'Upload failed' })
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
    send(res, 200, await db.all('SELECT * FROM custom_requests ORDER BY created_at DESC'))
    return true
  }

  if (urlPath === '/api/admin/contact-messages' && method === 'GET') {
    if (!requirePerm(admin, 'messages', res)) return true
    send(res, 200, await db.all('SELECT * FROM contact_messages ORDER BY created_at DESC'))
    return true
  }

  if (urlPath === '/api/admin/mail/recipients' && method === 'GET') {
    if (!requirePerm(admin, 'mail', res)) return true
    const rows = await db.all<MailUserRow>(
      'SELECT id, email, display_name FROM users ORDER BY lower(email) ASC',
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

    const validRecipients = await db.all<{ id: string }>(
      `SELECT id FROM users WHERE id IN (${recipientIds.map(() => '?').join(',')})`,
      ...recipientIds,
    )
    if (validRecipients.length === 0) {
      send(res, 400, { error: 'No valid recipients found.' })
      return true
    }
    const messageId = randomUUID()
    const now = new Date().toISOString()
    await db.run(
      'INSERT INTO mail_messages (id, sender_id, subject, body, created_at, scheduled_at) VALUES (?, ?, ?, ?, ?, ?)',
      messageId,
      admin.id,
      subject || '(no subject)',
      messageBody,
      now,
      scheduledAt,
    )
    for (const recipient of validRecipients) {
      await db.run(
        'INSERT INTO mail_recipients (id, message_id, recipient_id, read_at) VALUES (?, ?, ?, ?)',
        randomUUID(),
        messageId,
        recipient.id,
        null,
      )
    }
    const created = await loadMailMessage(db, messageId, admin.id, false)
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
  if (requestMatch && method === 'PATCH') {
    if (!requirePerm(admin, 'requests', res)) return true
    const id = requestMatch[1]
    const body = await readJson(req)
    const status = ['new', 'reviewing', 'approved', 'declined', 'completed'].includes(String(body.status))
      ? (body.status as RequestStatus)
      : 'new'
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
    if (!adminCan(admin, 'content') && !adminCan(admin, 'website_status')) {
      return forbid(res)
    }
    send(res, 200, await getWebsiteContent(db))
    return true
  }

  if (urlPath === '/api/admin/content' && method === 'PATCH') {
    const body = await readJson(req)
    const keys = Object.keys(body)
    const onlyWebsiteOnline = keys.length > 0 && keys.every((k) => k === 'websiteOnline')
    if (onlyWebsiteOnline) {
      if (!requirePerm(admin, 'website_status', res)) return true
    } else if (!requirePerm(admin, 'content', res)) {
      return true
    }
    for (const [key, value] of Object.entries(body)) {
      if (key === 'websiteOnline' && !adminCan(admin, 'website_status')) continue
      await setWebsiteSetting(db, key, value)
    }
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

  if (urlPath === '/api/admin/settings/cloud-slicer' && method === 'GET') {
    const { maskCloudSlicerToken } = await import('./cloudSlicer.ts')
    const { seedCatalogDefaults, listPrinters } = await import('./catalog.ts')
    await seedCatalogDefaults(db)
    const row = await db.get<{
      cloud_slicer_token: string
      cloud_slicer_printer_id: string
      cloud_slicer_filament_id: string
      cloud_slicer_configured_at: string | null
    }>(
      `SELECT cloud_slicer_token, cloud_slicer_printer_id, cloud_slicer_filament_id, cloud_slicer_configured_at
       FROM users WHERE id = ?`,
      admin.id,
    )
    const printers = await listPrinters(db)
    const ownedPrinterId =
      printers.find((p) => p.ownerUserId === admin.id)?.id ?? null
    send(res, 200, {
      tokenMasked: maskCloudSlicerToken(row?.cloud_slicer_token ?? ''),
      hasToken: Boolean(row?.cloud_slicer_token?.trim()),
      printerId: row?.cloud_slicer_printer_id ?? '',
      filamentId: row?.cloud_slicer_filament_id ?? '',
      configuredAt: row?.cloud_slicer_configured_at ?? null,
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
    const existing = await db.get<{
      cloud_slicer_token: string
      cloud_slicer_printer_id: string
      cloud_slicer_filament_id: string
    }>(
      `SELECT cloud_slicer_token, cloud_slicer_printer_id, cloud_slicer_filament_id FROM users WHERE id = ?`,
      admin.id,
    )
    const tokenRaw = body.token !== undefined ? String(body.token ?? '').trim() : undefined
    const printerIdCs = sanitizeText(String(body.printerId ?? existing?.cloud_slicer_printer_id ?? ''), 120)
    const filamentId = sanitizeText(String(body.filamentId ?? existing?.cloud_slicer_filament_id ?? ''), 120)
    const printxPrinterId = sanitizeText(String(body.ownedPrinterId ?? ''), 60)
    const validPrinterIds = new Set(['pablo_p1s', 'court_ender', 'josh_kobra'])
    if (printxPrinterId && !validPrinterIds.has(printxPrinterId)) {
      send(res, 400, { error: 'Pick a valid PrintX printer (P1S, Ender, or Kobra).' })
      return true
    }

    let token = existing?.cloud_slicer_token ?? ''
    if (tokenRaw !== undefined) {
      // Empty string clears; omit/unchanged keeps existing when client sends blank intentionally via clearToken
      if (body.clearToken) token = ''
      else if (tokenRaw) token = tokenRaw
    }

    const now = new Date().toISOString()
    const configured =
      token.trim() && printerIdCs.trim() && filamentId.trim() ? now : null
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

    const { seedCatalogDefaults } = await import('./catalog.ts')
    await seedCatalogDefaults(db)
    // Link this admin as owner of the chosen PrintX printer (and clear their previous claim).
    await db.run(`UPDATE printers SET owner_user_id = NULL WHERE owner_user_id = ?`, admin.id)
    if (printxPrinterId) {
      await db.run(`UPDATE printers SET owner_user_id = ? WHERE id = ?`, admin.id, printxPrinterId)
    }

    const { maskCloudSlicerToken } = await import('./cloudSlicer.ts')
    send(res, 200, {
      ok: true,
      tokenMasked: maskCloudSlicerToken(token),
      hasToken: Boolean(token.trim()),
      printerId: printerIdCs,
      filamentId,
      configuredAt: configured,
      ownedPrinterId: printxPrinterId || null,
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
