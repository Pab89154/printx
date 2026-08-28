import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { Db } from './db.ts'
import { getDb } from './db.ts'

const SESSION_COOKIE = 'printx_session'
const SESSION_DAYS = 7

function hashToken(token: string): string {
  const secret = process.env.PRINTX_SESSION_SECRET ?? 'dev-session-secret-change-me'
  return createHash('sha256').update(`${token}:${secret}`).digest('hex')
}

export function createSession(userId: string): string {
  const db = getDb()
  const token = randomBytes(32).toString('hex')
  const tokenHash = hashToken(token)
  const now = new Date()
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  const sessionId = randomUUID()

  db.prepare(
    'INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(sessionId, userId, tokenHash, expires.toISOString(), now.toISOString())

  return token
}

export function destroySession(token: string | null) {
  if (!token) return
  const db = getDb()
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
}

export function getSessionUser(token: string | null): { id: string; role: string; email: string } | null {
  if (!token) return null
  const db = getDb()
  const tokenHash = hashToken(token)
  const row = db.prepare(`
    SELECT u.id, u.role, u.email, s.expires_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `).get(tokenHash) as { id: string; role: string; email: string; expires_at: string } | undefined

  if (!row) return null
  if (new Date(row.expires_at) < new Date()) {
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash)
    return null
  }
  return { id: row.id, role: row.role, email: row.email ?? '' }
}

export function verifyAdminLogin(email: string, password: string): { id: string; role: string; email: string } | null {
  const normalized = sanitizeEmail(email).toLowerCase()
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null

  const db = getDb()
  const user = db.prepare(`
    SELECT id, password_hash, role, email, email_verified
    FROM users
    WHERE role = 'admin' AND LOWER(email) = ?
  `).get(normalized) as
    | { id: string; password_hash: string; role: string; email: string; email_verified: number }
    | undefined

  if (!user || !user.email_verified) return null
  if (!bcrypt.compareSync(password, user.password_hash)) return null
  return { id: user.id, role: user.role, email: user.email }
}

/** @deprecated use verifyAdminLogin */
export function verifyAdminPassword(password: string): { id: string; role: string } | null {
  const db = getDb()
  const user = db.prepare(`
    SELECT id, password_hash, role FROM users WHERE role = 'admin' AND email_verified = 1 LIMIT 1
  `).get() as { id: string; password_hash: string; role: string } | undefined
  if (!user) return null
  if (!bcrypt.compareSync(password, user.password_hash)) return null
  return { id: user.id, role: user.role }
}

export function updateAdminPassword(db: Db, userId: string, currentPassword: string, newPassword: string): boolean {
  const user = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as { password_hash: string } | undefined
  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) return false
  if (newPassword.length < 8) return false
  const hash = bcrypt.hashSync(newPassword, 12)
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, userId)
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId)
  return true
}

export type AdminUserRecord = {
  id: string
  email: string
  emailVerified: boolean
  createdAt: string
}

export function listAdminUsers(): AdminUserRecord[] {
  const db = getDb()
  const rows = db.prepare(`
    SELECT id, email, email_verified, created_at FROM users WHERE role = 'admin' ORDER BY created_at ASC
  `).all() as { id: string; email: string; email_verified: number; created_at: string }[]
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    emailVerified: Boolean(r.email_verified),
    createdAt: r.created_at,
  }))
}

export function createAdminUser(email: string, password: string): AdminUserRecord | null {
  const normalized = sanitizeEmail(email).toLowerCase()
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null
  if (password.length < 8) return null

  const db = getDb()
  const existing = db.prepare('SELECT id FROM users WHERE LOWER(email) = ?').get(normalized)
  if (existing) return null

  const id = randomUUID()
  const now = new Date().toISOString()
  const hash = bcrypt.hashSync(password, 12)
  db.prepare(
    'INSERT INTO users (id, email, password_hash, role, email_verified, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id, normalized, hash, 'admin', 1, now)

  return { id, email: normalized, emailVerified: true, createdAt: now }
}

export function deleteAdminUser(actorId: string, targetId: string): boolean {
  if (actorId === targetId) return false
  const db = getDb()
  const count = (db.prepare('SELECT COUNT(*) as c FROM users WHERE role = ?').get('admin') as { c: number }).c
  if (count <= 1) return false
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(targetId)
  const result = db.prepare('DELETE FROM users WHERE id = ? AND role = ?').run(targetId, 'admin')
  return result.changes > 0
}

export function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {}
  return Object.fromEntries(
    header.split(';').map((part) => {
      const [key, ...rest] = part.trim().split('=')
      return [key, decodeURIComponent(rest.join('='))]
    }),
  )
}

export function sessionCookieHeader(token: string, maxAgeSeconds = SESSION_DAYS * 86400): string {
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ]
  return parts.join('; ')
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

export { SESSION_COOKIE }

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

export function sanitizeText(input: unknown, maxLen = 5000): string {
  if (typeof input !== 'string') return ''
  return input.trim().slice(0, maxLen)
}

export function sanitizeEmail(input: unknown): string {
  if (typeof input !== 'string') return ''
  return input.trim().slice(0, 254)
}
