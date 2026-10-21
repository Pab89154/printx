/** Default main admin email — used until primary admin user id is loaded / env overrides. */
export const MAIN_ADMIN_EMAIL = 'pablo.molina@printx.pw'

export const PERMISSION_KEYS = [
  'dashboard',
  'messages',
  'mail',
  'money',
  'stands',
  'products',
  'orders',
  'discounts',
  'requests',
  'content',
  'sandbox',
  'settings',
  'website_status',
  'manage_admins',
] as const

export type PermissionKey = (typeof PERMISSION_KEYS)[number]

export type AdminPermissions = Record<PermissionKey, boolean>

export const PERMISSION_LABELS: Record<PermissionKey, string> = {
  dashboard: 'Dashboard',
  messages: 'Inbox (feedback & contact)',
  mail: 'Mail (admin messages)',
  money: 'Money',
  stands: 'Stands',
  products: 'Designs',
  orders: 'Orders (print queue)',
  discounts: 'Discounts (promo codes)',
  requests: 'Custom Requests',
  content: 'Website Content (removed)',
  sandbox: 'Site sandbox',
  settings: 'Settings (profile)',
  website_status: 'Pause / unpause public website',
  manage_admins: 'Manage admins & permissions',
}

/** Default access for new regular admins (main admin can change these). */
export function defaultPermissions(): AdminPermissions {
  return {
    dashboard: true,
    messages: true,
    mail: true,
    money: true,
    stands: true,
    products: true,
    orders: true,
    discounts: true,
    requests: true,
    content: false,
    sandbox: true,
    settings: true,
    website_status: false,
    manage_admins: false,
  }
}

export function allPermissions(): AdminPermissions {
  const perms = Object.fromEntries(PERMISSION_KEYS.map((k) => [k, true])) as AdminPermissions
  // Website copy/hero/contact editing removed from the portal.
  perms.content = false
  return perms
}

export function isMainAdminEmail(email: string | null | undefined): boolean {
  const normalized = (email ?? '').trim().toLowerCase()
  if (!normalized) return false
  const fromEnv =
    typeof process !== 'undefined' && typeof process.env?.PRINTX_ADMIN_EMAIL === 'string'
      ? process.env.PRINTX_ADMIN_EMAIL.trim().toLowerCase()
      : ''
  return normalized === (fromEnv || MAIN_ADMIN_EMAIL)
}

/** Stable primary admin id (server sets this after DB init). */
let primaryAdminUserId: string | null = null

export function setPrimaryAdminUserId(id: string | null | undefined) {
  primaryAdminUserId = typeof id === 'string' && id.trim() ? id.trim() : null
}

export function getPrimaryAdminUserId(): string | null {
  return primaryAdminUserId
}

/** True if this user is the main admin (by id when known, else by reserved email). */
export function isPrimaryAdminUser(
  userId: string | null | undefined,
  email?: string | null,
): boolean {
  if (primaryAdminUserId && userId) return userId === primaryAdminUserId
  return isMainAdminEmail(email)
}

export function normalizePermissions(input: unknown): AdminPermissions {
  const base = defaultPermissions()
  if (!input || typeof input !== 'object') return base
  const raw = input as Record<string, unknown>
  for (const key of PERMISSION_KEYS) {
    if (typeof raw[key] === 'boolean') base[key] = raw[key]
  }
  // Predates `money` key — grant view access without a manual re-save.
  if (typeof raw.money !== 'boolean') base.money = true
  // Predates `discounts` key — it used to be covered by Orders access,
  // so keep existing admins able to use Discounts until the main admin
  // explicitly turns it off for them.
  if (typeof raw.discounts !== 'boolean') base.discounts = true
  // Regular admins never get manage_admins through stored JSON alone —
  // only the primary admin account grants it.
  base.manage_admins = false
  // Website content editing removed from the portal.
  base.content = false
  return base
}

export function permissionsForUser(
  email: string,
  stored: unknown,
  userId?: string | null,
): AdminPermissions {
  if (isPrimaryAdminUser(userId, email)) return allPermissions()
  return normalizePermissions(stored)
}

export function hasPermission(perms: AdminPermissions, key: PermissionKey): boolean {
  return Boolean(perms[key])
}
