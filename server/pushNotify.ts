import { randomUUID } from 'node:crypto'
import webpush from 'web-push'
import type { DbApi } from './dbClient.ts'
import {
  hasPermission,
  isPrimaryAdminUser,
  permissionsForUser,
  type PermissionKey,
} from '../shared/permissions.ts'
import {
  isValidVapidPrivateKey,
  isValidVapidPublicKey,
  normalizeVapidKey,
} from '../shared/vapid.ts'

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

function vapidEnvKeys(): { publicKey: string; privateKey: string; subject: string } {
  return {
    publicKey: normalizeVapidKey(process.env.VAPID_PUBLIC_KEY),
    privateKey: normalizeVapidKey(process.env.VAPID_PRIVATE_KEY),
    subject: process.env.VAPID_SUBJECT?.trim() || 'mailto:hello@printx.pw',
  }
}

function configureVapid(): boolean {
  if (vapidReady) return true
  const { publicKey, privateKey, subject } = vapidEnvKeys()
  if (!isValidVapidPublicKey(publicKey) || !isValidVapidPrivateKey(privateKey)) return false
  try {
    webpush.setVapidDetails(subject, publicKey, privateKey)
  } catch (err) {
    console.warn('[push] VAPID configure failed:', err instanceof Error ? err.message : err)
    return false
  }
  vapidReady = true
  return true
}

export function pushConfigured(): boolean {
  const { publicKey, privateKey } = vapidEnvKeys()
  return isValidVapidPublicKey(publicKey) && isValidVapidPrivateKey(privateKey)
}

export function vapidPublicKey(): string | null {
  const { publicKey } = vapidEnvKeys()
  return isValidVapidPublicKey(publicKey) ? publicKey : null
}

/** Why push is unavailable — for admin UI / logs (never includes private key). */
export function vapidConfigError(): string | null {
  const { publicKey, privateKey } = vapidEnvKeys()
  if (!publicKey && !privateKey) return 'Missing VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY on the server.'
  if (!publicKey) return 'Missing VAPID_PUBLIC_KEY on the server.'
  if (!privateKey) return 'Missing VAPID_PRIVATE_KEY on the server.'
  if (!isValidVapidPublicKey(publicKey)) {
    return 'VAPID_PUBLIC_KEY is invalid (need the ~87-char key from: npx web-push generate-vapid-keys). Remove quotes/spaces.'
  }
  if (!isValidVapidPrivateKey(privateKey)) {
    return 'VAPID_PRIVATE_KEY is invalid (need the matching private key from the same generate-vapid-keys run). Remove quotes/spaces.'
  }
  return null
}

/**
 * Send via fetch — web-push's sendNotification uses Node https.request, which
 * fails or never completes on Cloudflare Workers even with nodejs_compat.
 */
async function sendToSubscription(row: SubRow, payload: PushPayload): Promise<'ok' | 'gone' | 'error'> {
  try {
    if (!configureVapid()) return 'error'
    const details = webpush.generateRequestDetails(
      {
        endpoint: row.endpoint,
        keys: { p256dh: row.p256dh, auth: row.auth },
      },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 12 },
    )
    let body: BodyInit | undefined
    if (details.body != null) {
      if (typeof details.body === 'string') body = details.body
      else if (Buffer.isBuffer(details.body)) body = new Uint8Array(details.body)
      else body = details.body as BodyInit
    }
    const res = await fetch(details.endpoint, {
      method: details.method,
      headers: details.headers as Record<string, string>,
      body,
    })
    if (res.status === 201 || res.status === 200) return 'ok'
    if (res.status === 404 || res.status === 410) return 'gone'
    const text = await res.text().catch(() => '')
    // Old Render-era subs after VAPID rotation — drop so the phone can re-enable cleanly.
    if (
      res.status === 403 ||
      res.status === 400 ||
      /vapid|do not correspond|VapidPkHashMismatch/i.test(text)
    ) {
      console.warn('[push] dropping stale subscription', row.endpoint.slice(0, 48), res.status)
      return 'gone'
    }
    console.warn('[push]', row.endpoint.slice(0, 48), res.status, text.slice(0, 200))
    return 'error'
  } catch (err) {
    const status = (err as { statusCode?: number })?.statusCode
    if (status === 404 || status === 410) return 'gone'
    console.warn('[push]', row.endpoint.slice(0, 48), err instanceof Error ? err.message : err)
    return 'error'
  }
}

/** Send a test notification to every device registered for this admin. */
export async function sendTestPushToUser(
  db: DbApi,
  userId: string,
): Promise<{ sent: number; failed: number; removed: number }> {
  if (!pushConfigured()) {
    throw new Error(vapidConfigError() || 'Push is not configured.')
  }
  const rows = await db.all<SubRow>(
    `SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?`,
    userId,
  )
  let sent = 0
  let failed = 0
  let removed = 0
  for (const row of rows) {
    const result = await sendToSubscription(row, {
      title: 'PrintX',
      body: 'Test notification — your Pixel (or phone) is connected.',
      url: '/settings',
    })
    if (result === 'ok') sent += 1
    else if (result === 'gone') {
      await db.run('DELETE FROM push_subscriptions WHERE id = ?', row.id)
      removed += 1
    } else failed += 1
  }
  return { sent, failed, removed }
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

/** Notify the primary/main admin only (Approvals & Pricing is main-admin gated). */
export async function notifyMainAdmins(db: DbApi, payload: PushPayload): Promise<void> {
  if (!pushConfigured()) return
  const admins = await db.all<{ id: string; email: string | null }>(
    `SELECT id, email FROM users WHERE role = 'admin'`,
  )
  const mainIds = admins
    .filter((a) => isPrimaryAdminUser(a.id, a.email))
    .map((a) => a.id)
  await notifyAdminUsers(db, mainIds, payload)
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
