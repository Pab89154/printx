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

export async function createSession(userId: string): Promise<string> {
  const db = await getDb()
  const token = randomBytes(32).toString('hex')
  const tokenHash = hashToken(token)
  const now = new Date()
  const expires = new Date(now.getTime() + SESSION_DAYS * 24 * 60 * 60 * 1000)
  const sessionId = randomUUID()

  await db.run(
    'INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
    sessionId,
    userId,
    tokenHash,
    expires.toISOString(),
    now.toISOString(),
  )

  return token
}

export async function destroySession(token: string | null): Promise<void> {
  if (!token) return
  const db = await getDb()
  await db.run('DELETE FROM sessions WHERE token_hash = ?', hashToken(token))
}

export async function getSessionUser(
  token: string | null,
): Promise<{ id: string; role: string; email: string } | null> {
  if (!token) return null
  const db = await getDb()
  const tokenHash = hashToken(token)
  const row = await db.get<{ id: string; role: string; email: string; expires_at: string }>(
    `
    SELECT u.id, u.role, u.email, s.expires_at
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `,
    tokenHash,
  )

  if (!row) return null
  if (new Date(row.expires_at) < new Date()) {
    await db.run('DELETE FROM sessions WHERE token_hash = ?', tokenHash)
    return null
  }
  return { id: row.id, role: row.role, email: row.email ?? '' }
}

export async function verifyAdminLogin(
  email: string,
  password: string,
): Promise<{ id: string; role: string; email: string } | null> {
  const normalized = sanitizeEmail(email).toLowerCase()
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null

  const db = await getDb()
  const user = await db.get<{ id: string; password_hash: string; role: string; email: string }>(
    `
    SELECT id, password_hash, role, email
    FROM users
    WHERE role = 'admin' AND LOWER(email) = ?
  `,
    normalized,
  )

  if (!user) return null
  if (!bcrypt.compareSync(password, user.password_hash)) return null
  return { id: user.id, role: user.role, email: user.email }
}

/** @deprecated use verifyAdminLogin */
export async function verifyAdminPassword(
  password: string,
): Promise<{ id: string; role: string } | null> {
  const db = await getDb()
  const user = await db.get<{ id: string; password_hash: string; role: string }>(
    `SELECT id, password_hash, role FROM users WHERE role = 'admin' LIMIT 1`,
  )
  if (!user) return null
  if (!bcrypt.compareSync(password, user.password_hash)) return null
  return { id: user.id, role: user.role }
}

export async function updateAdminPassword(
  db: Db,
  userId: string,
  currentPassword: string,
  newPassword: string,
): Promise<boolean> {
  const user = await db.get<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = ?', userId)
  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) return false
  if (newPassword.length < 8) return false
  const hash = bcrypt.hashSync(newPassword, 12)
  await db.run('UPDATE users SET password_hash = ? WHERE id = ?', hash, userId)
  await db.run('DELETE FROM sessions WHERE user_id = ?', userId)
  return true
}

export type AdminUserRecord = {
  id: string
  email: string
  emailVerified: boolean
  createdAt: string
}

export async function listAdminUsers(): Promise<AdminUserRecord[]> {
  const db = await getDb()
  const rows = await db.all<{ id: string; email: string; email_verified: number; created_at: string }>(
    `SELECT id, email, email_verified, created_at FROM users WHERE role = 'admin' ORDER BY created_at ASC`,
  )
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    emailVerified: Boolean(r.email_verified),
    createdAt: r.created_at,
  }))
}

export async function createAdminUser(email: string, password: string): Promise<AdminUserRecord | null> {
  const normalized = sanitizeEmail(email).toLowerCase()
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null
  if (password.length < 8) return null

  const db = await getDb()
  const existing = await db.get('SELECT id FROM users WHERE LOWER(email) = ?', normalized)
  if (existing) return null

  const id = randomUUID()
  const now = new Date().toISOString()
  const hash = bcrypt.hashSync(password, 12)
  await db.run(
    'INSERT INTO users (id, email, password_hash, role, email_verified, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    id,
    normalized,
    hash,
    'admin',
    1,
    now,
  )

  return { id, email: normalized, emailVerified: true, createdAt: now }
}

export async function deleteAdminUser(actorId: string, targetId: string): Promise<boolean> {
  if (actorId === targetId) return false
  const db = await getDb()
  const countRow = await db.get<{ c: number | string }>('SELECT COUNT(*) as c FROM users WHERE role = ?', 'admin')
  if (Number(countRow?.c ?? 0) <= 1) return false
  await db.run('DELETE FROM sessions WHERE user_id = ?', targetId)
  const result = await db.run('DELETE FROM users WHERE id = ? AND role = ?', targetId, 'admin')
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

export function sessionCookieHeader(
  token: string,
  options?: { maxAgeSeconds?: number; secure?: boolean },
): string {
  const maxAgeSeconds = options?.maxAgeSeconds ?? SESSION_DAYS * 86400
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ]
  if (options?.secure) parts.push('Secure')
  return parts.join('; ')
}

export function clearSessionCookieHeader(secure = false): string {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0']
  if (secure) parts.push('Secure')
  return parts.join('; ')
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
