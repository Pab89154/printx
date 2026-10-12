import { randomUUID } from 'node:crypto'
import webpush from 'web-push'
import type { DbApi } from './dbClient.ts'
import {
  hasPermission,
  permissionsForUser,
  type PermissionKey,
} from '../shared/permissions.ts'

export type PushPayload = {
  title: string
  body: string
  /** Portal path, e.g. /messages */
  url: string
}

type SubRow = {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
}

let vapidReady = false

function configureVapid(): boolean {
  if (vapidReady) return true
  const publicKey = process.env.VAPID_PUBLIC_KEY?.trim()
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim()
  const subject = process.env.VAPID_SUBJECT?.trim() || 'mailto:hello@printx.pw'
  if (!publicKey || !privateKey) return false
  webpush.setVapidDetails(subject, publicKey, privateKey)
  vapidReady = true
  return true
}

export function pushConfigured(): boolean {
  return Boolean(process.env.VAPID_PUBLIC_KEY?.trim() && process.env.VAPID_PRIVATE_KEY?.trim())
}

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null
}

async function sendToSubscription(row: SubRow, payload: PushPayload): Promise<'ok' | 'gone' | 'error'> {
  try {
    await webpush.sendNotification(
      {
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 12 },
    )
    return 'ok'
  } catch (err) {
    const status = (err as { statusCode?: number })?.statusCode
    if (status === 404 || status === 410) return 'gone'
    console.warn('[push]', row.endpoint.slice(0, 48), err instanceof Error ? err.message : err)
    return 'error'
  }
}

async function deliver(db: DbApi, rows: SubRow[], payload: PushPayload): Promise<void> {
  if (!configureVapid() || rows.length === 0) return
  for (const row of rows) {
    const result = await sendToSubscription(row, payload)
    if (result === 'gone') {
      await db.run('DELETE FROM push_subscriptions WHERE id = ?', row.id)
    }
  }
}

/** Notify all admins who have a given portal permission (and have subscribed a device). */
export async function notifyAdminsWithPermission(
  db: DbApi,
  permission: PermissionKey,
  payload: PushPayload,
): Promise<void> {
  if (!pushConfigured()) return
  const admins = await db.all<{ id: string; email: string | null; permissions: string | null }>(
    `SELECT id, email, permissions FROM users WHERE role = 'admin'`,
  )
  const allowed = new Set<string>()
  for (const a of admins) {
    const perms = permissionsForUser(String(a.email || ''), safeParseJson(a.permissions), a.id)
    if (hasPermission(perms, permission)) allowed.add(a.id)
  }
  if (allowed.size === 0) return
  const rows = await db.all<SubRow>(
    `SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions
     WHERE user_id IN (${[...allowed].map(() => '?').join(',')})`,
    ...allowed,
  )
  await deliver(db, rows, payload)
}

/** Notify specific admin user ids (e.g. mail recipients). */
export async function notifyAdminUsers(
  db: DbApi,
  userIds: string[],
  payload: PushPayload,
): Promise<void> {
  if (!pushConfigured() || userIds.length === 0) return
  const unique = [...new Set(userIds.filter(Boolean))]
  if (unique.length === 0) return
  const rows = await db.all<SubRow>(
    `SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions
     WHERE user_id IN (${unique.map(() => '?').join(',')})`,
    ...unique,
  )
  await deliver(db, rows, payload)
}

function safeParseJson(raw: string | null): unknown {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return null
  }
}

export async function upsertPushSubscription(
  db: DbApi,
  userId: string,
  input: { endpoint: string; p256dh: string; auth: string; userAgent?: string },
): Promise<void> {
  const now = new Date().toISOString()
  const existing = await db.get<{ id: string }>(
    'SELECT id FROM push_subscriptions WHERE endpoint = ?',
    input.endpoint,
  )
  if (existing) {
    await db.run(
      `UPDATE push_subscriptions SET user_id = ?, p256dh = ?, auth = ?, user_agent = ?, created_at = ?
       WHERE id = ?`,
      userId,
      input.p256dh,
      input.auth,
      input.userAgent || '',
      now,
      existing.id,
    )
    return
  }
  await db.run(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    randomUUID(),
    userId,
    input.endpoint,
    input.p256dh,
    input.auth,
    input.userAgent || '',
    now,
  )
}

export async function deletePushSubscription(
  db: DbApi,
  userId: string,
  endpoint: string,
): Promise<void> {
  await db.run(
    'DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?',
    userId,
    endpoint,
  )
}
