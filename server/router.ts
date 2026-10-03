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
  updateAdminPermissions,
  updateAdminDisplayName,
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
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

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

function cookieOptions(req: IncomingMessage): { secure: boolean; domain?: string } {
  const host = typeof req.headers.host === 'string' ? req.headers.host : ''
  return {
    secure: isSecureRequest(req),
    domain: sessionCookieDomain(host),
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

async function parseMultipart(req: IncomingMessage): Promise<{ fields: Record<string, string>; filePath: string | null }> {
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
        if (!ALLOWED_UPLOAD_EXT.has(ext)) {
          fs.unlinkSync(file.filepath)
          return reject(new Error('Invalid file type. Only .stl and .obj allowed.'))
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

export async function handleApi(req: IncomingMessage, res: ServerResponse, urlPath: string, method: string): Promise<boolean> {
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

  if (urlPath === '/api/admin/schools' && method === 'GET') {
    // Stands editor also needs the school list
    if (!adminCan(admin, 'schools') && !adminCan(admin, 'stands')) {
      return forbid(res)
    }
    send(res, 200, await db.all('SELECT * FROM schools ORDER BY name ASC'))
    return true
  }

  if (urlPath === '/api/admin/schools' && method === 'POST') {
    if (!requirePerm(admin, 'schools', res)) return true
    const body = await readJson(req)
    const now = new Date().toISOString()
    const id = randomUUID()
    await db.run(
      `
      INSERT INTO schools (id, name, address, description, image, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      id,
      sanitizeText(body.name, 200),
      sanitizeText(body.address, 300),
      sanitizeText(body.description, 2000),
      sanitizeText(body.image, 500),
      body.active === false ? 0 : 1,
      now,
      now,
    )
    bumpPublicCache()
    send(res, 201, await db.get('SELECT * FROM schools WHERE id = ?', id))
    return true
  }

  const schoolMatch = urlPath.match(/^\/api\/admin\/schools\/([^/]+)$/)
  if (schoolMatch) {
    if (!requirePerm(admin, 'schools', res)) return true
    const id = schoolMatch[1]
    if (method === 'PATCH') {
      const body = await readJson(req)
      await db.run(
        `
        UPDATE schools SET name = ?, address = ?, description = ?, image = ?, active = ?, updated_at = ?
        WHERE id = ?
      `,
        sanitizeText(body.name, 200),
        sanitizeText(body.address, 300),
        sanitizeText(body.description, 2000),
        sanitizeText(body.image, 500),
        body.active === false ? 0 : 1,
        new Date().toISOString(),
        id,
      )
      bumpPublicCache()
      send(res, 200, await db.get('SELECT * FROM schools WHERE id = ?', id))
      return true
    }
    if (method === 'DELETE') {
      await db.run('DELETE FROM schools WHERE id = ?', id)
      bumpPublicCache()
      send(res, 200, { ok: true })
      return true
    }
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

  if (urlPath === '/api/admin/settings/profile' && method === 'PATCH') {
    if (!requirePerm(admin, 'settings', res)) return true
    const body = await readJson(req)
    const displayName = await updateAdminDisplayName(admin.id, body.displayName)
    send(res, 200, { ok: true, displayName })
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
