import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import formidable from 'formidable'
import {
  clearSessionCookieHeader,
  createSession,
  destroySession,
  getSessionUser,
  parseCookies,
  sanitizeEmail,
  sanitizeText,
  sessionCookieHeader,
  SESSION_COOKIE,
  updateAdminPassword,
  verifyAdminLogin,
  listAdminUsers,
  createAdminUser,
  deleteAdminUser,
} from './auth.ts'
import {
  getDb,
  getUploadsDir,
  getWebsiteContent,
  rowToProduct,
  rowToStand,
  setWebsiteSetting,
} from './db.ts'
import type { RequestStatus, StandStatus } from './types.ts'

const ALLOWED_UPLOAD_EXT = new Set(['.stl', '.obj'])
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024

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

function requireAdmin(req: IncomingMessage): { id: string; role: string } | null {
  const cookies = parseCookies(req.headers.cookie)
  const user = getSessionUser(cookies[SESSION_COOKIE] ?? null)
  if (!user || user.role !== 'admin') return null
  return user
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
  const form = formidable({
    uploadDir: getUploadsDir(),
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
        const dest = path.join(getUploadsDir(), safeName)
        fs.renameSync(file.filepath, dest)
        filePath = safeName
      }
      resolve({ fields: normalized, filePath })
    })
  })
}

export async function handleApi(req: IncomingMessage, res: ServerResponse, urlPath: string, method: string): Promise<boolean> {
  const db = getDb()

  if (urlPath === '/api/public/bootstrap' && method === 'GET') {
    const stands = (db.prepare(`
      SELECT * FROM stands WHERE status IN ('upcoming', 'active') ORDER BY date ASC, start_time ASC
    `).all() as Record<string, unknown>[]).map((r) => publicStand(rowToStand(r)))

    const pastStands = (db.prepare(`
      SELECT * FROM stands WHERE status = 'past' ORDER BY date DESC LIMIT 10
    `).all() as Record<string, unknown>[]).map((r) => publicStand(rowToStand(r)))

    const products = (db.prepare(`
      SELECT * FROM products ORDER BY display_order ASC, name ASC
    `).all() as Record<string, unknown>[]).map(rowToProduct)

    const schools = db.prepare('SELECT * FROM schools WHERE active = 1 ORDER BY name ASC').all()
    const content = getWebsiteContent(db)
    const announcementActive =
      content.announcementEnabled &&
      (!content.announcementExpiresAt || new Date(content.announcementExpiresAt) >= new Date())

    send(res, 200, { stands, pastStands, products, schools, content, announcementActive })
    return true
  }

  if (urlPath === '/api/public/custom-requests' && method === 'POST') {
    try {
      const { fields, filePath } = await parseMultipart(req)
      const now = new Date().toISOString()
      const id = randomUUID()
      db.prepare(`
        INSERT INTO custom_requests (id, name, email, school, description, size, uploaded_file, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'new', ?, ?)
      `).run(
        id,
        sanitizeText(fields.name, 120),
        sanitizeEmail(fields.email),
        sanitizeText(fields.school, 200),
        sanitizeText(fields.description, 3000),
        sanitizeText(fields.size, 100),
        filePath,
        now,
        now,
      )
      send(res, 201, { ok: true, id })
    } catch (e) {
      send(res, 400, { error: e instanceof Error ? e.message : 'Upload failed' })
    }
    return true
  }

  if (urlPath === '/api/public/contact' && method === 'POST') {
    const body = await readJson(req)
    db.prepare(`
      INSERT INTO contact_messages (id, name, email, inquiry_type, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      sanitizeText(body.name, 120),
      sanitizeEmail(body.email),
      sanitizeText(body.inquiryType, 100),
      sanitizeText(body.message, 5000),
      new Date().toISOString(),
    )
    send(res, 201, { ok: true })
    return true
  }

  if (urlPath === '/api/admin/login' && method === 'POST') {
    const body = await readJson(req)
    const email = typeof body.email === 'string' ? body.email : ''
    const password = typeof body.password === 'string' ? body.password : ''
    const user = verifyAdminLogin(email, password)
    if (!user) {
      send(res, 401, { error: 'Invalid email or password.' })
      return true
    }
    const token = createSession(user.id)
    send(res, 200, { ok: true, role: user.role, email: user.email }, [sessionCookieHeader(token)])
    return true
  }

  if (urlPath === '/api/admin/logout' && method === 'POST') {
    const cookies = parseCookies(req.headers.cookie)
    destroySession(cookies[SESSION_COOKIE] ?? null)
    send(res, 200, { ok: true }, [clearSessionCookieHeader()])
    return true
  }

  if (urlPath === '/api/admin/me' && method === 'GET') {
    const user = requireAdmin(req)
    if (!user) {
      send(res, 401, { error: 'Unauthorized' })
      return true
    }
    send(res, 200, { ok: true, role: user.role, email: user.email })
    return true
  }

  const uploadMatch = urlPath.match(/^\/api\/admin\/uploads\/([^/]+)$/)
  if (uploadMatch && method === 'GET') {
    const adminUser = requireAdmin(req)
    if (!adminUser) {
      send(res, 401, { error: 'Unauthorized' })
      return true
    }
    const filename = uploadMatch[1] ?? ''
    if (!/^[\w-]+\.(stl|obj)$/i.test(filename)) {
      send(res, 400, { error: 'Invalid file name' })
      return true
    }
    const filePath = path.join(getUploadsDir(), filename)
    if (!filePath.startsWith(getUploadsDir()) || !fs.existsSync(filePath)) {
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
    if (!requireAdmin(req)) {
      send(res, 401, { error: 'Unauthorized' })
      return true
    }
    const nextRow = db.prepare(`
      SELECT * FROM stands WHERE status IN ('upcoming', 'active') ORDER BY date ASC LIMIT 1
    `).get() as Record<string, unknown> | undefined
    const activeProducts = (db.prepare('SELECT COUNT(*) as c FROM products WHERE available = 1').get() as { c: number }).c
    const newRequests = (db.prepare("SELECT COUNT(*) as c FROM custom_requests WHERE status = 'new'").get() as { c: number }).c
    send(res, 200, {
      nextStand: nextRow ? publicStand(rowToStand(nextRow)) : null,
      activeProducts,
      newRequests,
      websiteOnline: true,
    })
    return true
  }

  const admin = requireAdmin(req)
  if (!admin) {
    if (urlPath.startsWith('/api/admin/')) {
      send(res, 401, { error: 'Unauthorized' })
      return true
    }
    return false
  }

  if (urlPath === '/api/admin/stands' && method === 'GET') {
    const rows = db.prepare('SELECT * FROM stands ORDER BY date DESC').all() as Record<string, unknown>[]
    send(res, 200, rows.map((r) => rowToStand(r)))
    return true
  }

  if (urlPath === '/api/admin/stands' && method === 'POST') {
    const body = await readJson(req)
    const now = new Date().toISOString()
    const id = randomUUID()
    db.prepare(`
      INSERT INTO stands (id, school_id, school_name, date, start_time, end_time, location, description, notes, products_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
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
    const row = db.prepare('SELECT * FROM stands WHERE id = ?').get(id) as Record<string, unknown>
    send(res, 201, rowToStand(row))
    return true
  }

  const standMatch = urlPath.match(/^\/api\/admin\/stands\/([^/]+)$/)
  if (standMatch) {
    const id = standMatch[1]
    if (method === 'PATCH') {
      const body = await readJson(req)
      const existing = db.prepare('SELECT * FROM stands WHERE id = ?').get(id)
      if (!existing) {
        send(res, 404, { error: 'Not found' })
        return true
      }
      db.prepare(`
        UPDATE stands SET
          school_id = ?, school_name = ?, date = ?, start_time = ?, end_time = ?,
          location = ?, description = ?, notes = ?, products_json = ?, status = ?, updated_at = ?
        WHERE id = ?
      `).run(
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
      const row = db.prepare('SELECT * FROM stands WHERE id = ?').get(id) as Record<string, unknown>
      send(res, 200, rowToStand(row))
      return true
    }
    if (method === 'DELETE') {
      db.prepare('DELETE FROM stands WHERE id = ?').run(id)
      send(res, 200, { ok: true })
      return true
    }
  }

  if (urlPath === '/api/admin/products' && method === 'GET') {
    const rows = db.prepare('SELECT * FROM products ORDER BY display_order ASC').all() as Record<string, unknown>[]
    send(res, 200, rows.map(rowToProduct))
    return true
  }

  if (urlPath === '/api/admin/products' && method === 'POST') {
    const body = await readJson(req)
    const now = new Date().toISOString()
    const id = randomUUID()
    db.prepare(`
      INSERT INTO products (id, name, description, price, category, image, emoji, image_gradient, available, featured, display_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
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
    const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Record<string, unknown>
    send(res, 201, rowToProduct(row))
    return true
  }

  const productMatch = urlPath.match(/^\/api\/admin\/products\/([^/]+)$/)
  if (productMatch) {
    const id = productMatch[1]
    if (method === 'PATCH') {
      const body = await readJson(req)
      db.prepare(`
        UPDATE products SET
          name = ?, description = ?, price = ?, category = ?, image = ?, emoji = ?,
          image_gradient = ?, available = ?, featured = ?, display_order = ?, updated_at = ?
        WHERE id = ?
      `).run(
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
      const row = db.prepare('SELECT * FROM products WHERE id = ?').get(id) as Record<string, unknown>
      send(res, 200, rowToProduct(row))
      return true
    }
    if (method === 'DELETE') {
      db.prepare('DELETE FROM products WHERE id = ?').run(id)
      send(res, 200, { ok: true })
      return true
    }
  }

  if (urlPath === '/api/admin/custom-requests' && method === 'GET') {
    send(res, 200, db.prepare('SELECT * FROM custom_requests ORDER BY created_at DESC').all())
    return true
  }

  const requestMatch = urlPath.match(/^\/api\/admin\/custom-requests\/([^/]+)$/)
  if (requestMatch && method === 'PATCH') {
    const id = requestMatch[1]
    const body = await readJson(req)
    const status = ['new', 'reviewing', 'approved', 'declined', 'completed'].includes(String(body.status))
      ? (body.status as RequestStatus)
      : 'new'
    db.prepare('UPDATE custom_requests SET status = ?, updated_at = ? WHERE id = ?').run(
      status,
      new Date().toISOString(),
      id,
    )
    send(res, 200, { ok: true })
    return true
  }

  if (urlPath === '/api/admin/schools' && method === 'GET') {
    send(res, 200, db.prepare('SELECT * FROM schools ORDER BY name ASC').all())
    return true
  }

  if (urlPath === '/api/admin/schools' && method === 'POST') {
    const body = await readJson(req)
    const now = new Date().toISOString()
    const id = randomUUID()
    db.prepare(`
      INSERT INTO schools (id, name, address, description, image, active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      sanitizeText(body.name, 200),
      sanitizeText(body.address, 300),
      sanitizeText(body.description, 2000),
      sanitizeText(body.image, 500),
      body.active === false ? 0 : 1,
      now,
      now,
    )
    send(res, 201, db.prepare('SELECT * FROM schools WHERE id = ?').get(id))
    return true
  }

  const schoolMatch = urlPath.match(/^\/api\/admin\/schools\/([^/]+)$/)
  if (schoolMatch) {
    const id = schoolMatch[1]
    if (method === 'PATCH') {
      const body = await readJson(req)
      db.prepare(`
        UPDATE schools SET name = ?, address = ?, description = ?, image = ?, active = ?, updated_at = ?
        WHERE id = ?
      `).run(
        sanitizeText(body.name, 200),
        sanitizeText(body.address, 300),
        sanitizeText(body.description, 2000),
        sanitizeText(body.image, 500),
        body.active === false ? 0 : 1,
        new Date().toISOString(),
        id,
      )
      send(res, 200, db.prepare('SELECT * FROM schools WHERE id = ?').get(id))
      return true
    }
    if (method === 'DELETE') {
      db.prepare('DELETE FROM schools WHERE id = ?').run(id)
      send(res, 200, { ok: true })
      return true
    }
  }

  if (urlPath === '/api/admin/content' && method === 'GET') {
    send(res, 200, getWebsiteContent(db))
    return true
  }

  if (urlPath === '/api/admin/content' && method === 'PATCH') {
    const body = await readJson(req)
    for (const [key, value] of Object.entries(body)) {
      setWebsiteSetting(db, key, value)
    }
    send(res, 200, getWebsiteContent(db))
    return true
  }

  if (urlPath === '/api/admin/settings/password' && method === 'PATCH') {
    const body = await readJson(req)
    const ok = updateAdminPassword(
      db,
      admin.id,
      String(body.currentPassword ?? ''),
      String(body.newPassword ?? ''),
    )
    if (!ok) {
      send(res, 400, { error: 'Current password is incorrect' })
      return true
    }
    send(res, 200, { ok: true }, [clearSessionCookieHeader()])
    return true
  }

  if (urlPath === '/api/admin/users' && method === 'GET') {
    send(res, 200, listAdminUsers())
    return true
  }

  if (urlPath === '/api/admin/users' && method === 'POST') {
    const body = await readJson(req)
    const email = sanitizeEmail(body.email)
    const password = typeof body.password === 'string' ? body.password : ''
    const created = createAdminUser(email, password)
    if (!created) {
      send(res, 400, { error: 'Could not create admin. Use a valid unique email and password (8+ characters).' })
      return true
    }
    send(res, 201, created)
    return true
  }

  const userMatch = urlPath.match(/^\/api\/admin\/users\/([^/]+)$/)
  if (userMatch && method === 'DELETE') {
    const targetId = userMatch[1]
    const ok = deleteAdminUser(admin.id, targetId)
    if (!ok) {
      send(res, 400, { error: 'Cannot remove this admin (you may be deleting yourself or the last admin).' })
      return true
    }
    send(res, 200, { ok: true })
    return true
  }

  return false
}
