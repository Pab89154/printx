import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import bcrypt from 'bcryptjs'
import type { Db } from './db.ts'
import { getDb } from './db.ts'
import {
  defaultPermissions,
  isMainAdminEmail,
  normalizePermissions,
  permissionsForUser,
  type AdminPermissions,
  type PermissionKey,
} from '../shared/permissions.ts'

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

export type SessionAdmin = {
  id: string
  role: string
  email: string
  displayName: string | null
  isMainAdmin: boolean
  permissions: AdminPermissions
}

function parseStoredPermissions(raw: string | null | undefined): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    return null
  }
}

function cleanDisplayName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.trim().slice(0, 80)
  return name || null
}

function toSessionAdmin(row: {
  id: string
  role: string
  email: string
  display_name?: string | null
  permissions?: string | null
}): SessionAdmin {
  const email = row.email ?? ''
  return {
    id: row.id,
    role: row.role,
    email,
    displayName: cleanDisplayName(row.display_name),
    isMainAdmin: isMainAdminEmail(email),
    permissions: permissionsForUser(email, parseStoredPermissions(row.permissions)),
  }
}

export async function getSessionUser(token: string | null): Promise<SessionAdmin | null> {
  if (!token) return null
  const db = await getDb()
  const tokenHash = hashToken(token)

  let row: {
    id: string
    role: string
    email: string
    display_name?: string | null
    permissions?: string | null
    expires_at: string
  } | null = null

  try {
    row = await db.get(
      `
      SELECT u.id, u.role, u.email, u.display_name, u.permissions, s.expires_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
    `,
      tokenHash,
    )
  } catch {
    // newer columns may be missing before migrate finishes
    row = await db.get(
      `
      SELECT u.id, u.role, u.email, s.expires_at
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
    `,
      tokenHash,
    )
  }

  if (!row) return null
  if (new Date(row.expires_at) < new Date()) {
    await db.run('DELETE FROM sessions WHERE token_hash = ?', tokenHash)
    return null
  }
  return toSessionAdmin(row)
}

export async function verifyAdminLogin(
  email: string,
  password: string,
): Promise<SessionAdmin | null> {
  const normalized = sanitizeEmail(email).toLowerCase()
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null

  const db = await getDb()
  let user: {
    id: string
    password_hash: string
    role: string
    email: string
    display_name?: string | null
    permissions?: string | null
  } | null = null
  try {
    user = await db.get(
      `
      SELECT id, password_hash, role, email, display_name, permissions
      FROM users
      WHERE role = 'admin' AND LOWER(email) = ?
    `,
      normalized,
    )
  } catch {
    user = await db.get(
      `
      SELECT id, password_hash, role, email
      FROM users
      WHERE role = 'admin' AND LOWER(email) = ?
    `,
      normalized,
    )
  }

  if (!user) return null
  if (!bcrypt.compareSync(password, user.password_hash)) return null
  return toSessionAdmin(user)
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
  displayName: string | null
  emailVerified: boolean
  createdAt: string
  isMainAdmin: boolean
  permissions: AdminPermissions
}

export async function listAdminUsers(): Promise<AdminUserRecord[]> {
  const db = await getDb()
  let rows: {
    id: string
    email: string
    display_name?: string | null
    email_verified: number
    created_at: string
    permissions: string | null
  }[] = []
  try {
    rows = await db.all(
      `SELECT id, email, display_name, email_verified, created_at, permissions FROM users WHERE role = 'admin' ORDER BY created_at ASC`,
    )
  } catch {
    rows = await db.all(
      `SELECT id, email, email_verified, created_at, permissions FROM users WHERE role = 'admin' ORDER BY created_at ASC`,
    )
  }
  return rows.map((r) => {
    const email = r.email
    return {
      id: r.id,
      email,
      displayName: cleanDisplayName(r.display_name),
      emailVerified: Boolean(r.email_verified),
      createdAt: r.created_at,
      isMainAdmin: isMainAdminEmail(email),
      permissions: permissionsForUser(email, parseStoredPermissions(r.permissions)),
    }
  })
}

export async function updateAdminDisplayName(
  userId: string,
  displayName: unknown,
): Promise<string | null> {
  const db = await getDb()
  const name = cleanDisplayName(displayName)
  await db.run('UPDATE users SET display_name = ? WHERE id = ? AND role = ?', name, userId, 'admin')
  return name
}

export async function createAdminUser(
  email: string,
  password: string,
  permissions?: Partial<AdminPermissions>,
  displayName?: unknown,
): Promise<AdminUserRecord | null> {
  const normalized = sanitizeEmail(email).toLowerCase()
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null
  if (password.length < 8) return null
  // Cannot create a second main admin account via email collision with reserved address by others —
  // only one account may use the main email.
  if (isMainAdminEmail(normalized)) return null

  const db = await getDb()
  const existing = await db.get('SELECT id FROM users WHERE LOWER(email) = ?', normalized)
  if (existing) return null

  const id = randomUUID()
  const now = new Date().toISOString()
  const hash = bcrypt.hashSync(password, 12)
  const perms = normalizePermissions({ ...defaultPermissions(), ...permissions })
  const name = cleanDisplayName(displayName)
  await db.run(
    'INSERT INTO users (id, email, password_hash, role, email_verified, permissions, display_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    normalized,
    hash,
    'admin',
    1,
    JSON.stringify(perms),
    name,
    now,
  )

  return {
    id,
    email: normalized,
    displayName: name,
    emailVerified: true,
    createdAt: now,
    isMainAdmin: false,
    permissions: perms,
  }
}

export async function updateAdminPermissions(
  targetId: string,
  permissions: Partial<AdminPermissions>,
): Promise<AdminUserRecord | null> {
  const db = await getDb()
  const target = await db.get<{ id: string; email: string; permissions: string | null }>(
    `SELECT id, email, permissions FROM users WHERE id = ? AND role = 'admin'`,
    targetId,
  )
  if (!target) return null
  if (isMainAdminEmail(target.email)) return null

  const next = normalizePermissions({
    ...permissionsForUser(target.email, parseStoredPermissions(target.permissions)),
    ...permissions,
  })
  await db.run('UPDATE users SET permissions = ? WHERE id = ?', JSON.stringify(next), targetId)

  const row = await db.get<{
    id: string
    email: string
    display_name?: string | null
    email_verified: number
    created_at: string
    permissions: string | null
  }>(`SELECT id, email, display_name, email_verified, created_at, permissions FROM users WHERE id = ?`, targetId)
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    displayName: cleanDisplayName(row.display_name),
    emailVerified: Boolean(row.email_verified),
    createdAt: row.created_at,
    isMainAdmin: false,
    permissions: permissionsForUser(row.email, parseStoredPermissions(row.permissions)),
  }
}

export async function deleteAdminUser(
  actorId: string,
  targetId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (actorId === targetId) {
    return { ok: false, error: 'You cannot delete your own account.' }
  }

  const db = await getDb()
  const actor = await db.get<{ email: string }>(
    `SELECT email FROM users WHERE id = ? AND role = 'admin'`,
    actorId,
  )
  if (!actor || !isMainAdminEmail(actor.email)) {
    return { ok: false, error: 'Only the main admin can delete accounts.' }
  }

  const target = await db.get<{ email: string }>(
    `SELECT email FROM users WHERE id = ? AND role = 'admin'`,
    targetId,
  )
  if (!target) {
    return { ok: false, error: 'Admin account not found.' }
  }
  if (isMainAdminEmail(target.email)) {
    return { ok: false, error: 'The main admin account cannot be deleted.' }
  }

  await db.run('DELETE FROM sessions WHERE user_id = ?', targetId)
  await db.run('DELETE FROM users WHERE id = ? AND role = ?', targetId, 'admin')

  const stillThere = await db.get('SELECT id FROM users WHERE id = ?', targetId)
  if (stillThere) {
    return { ok: false, error: 'Could not delete this admin account.' }
  }
  return { ok: true }
}

export function adminCan(user: SessionAdmin, key: PermissionKey): boolean {
  return Boolean(user.permissions[key])
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
