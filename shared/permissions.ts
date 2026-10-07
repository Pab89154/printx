/** Main admin email — always has full access; controls other admins' permissions. */
export const MAIN_ADMIN_EMAIL = 'pablo.molina@printx.pw'

export const PERMISSION_KEYS = [
  'dashboard',
  'messages',
  'mail',
  'stands',
  'products',
  'requests',
  'schools',
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
  stands: 'Stands',
  products: 'Products',
  requests: 'Custom Requests',
  schools: 'Schools',
  content: 'Website Content',
  sandbox: 'Site sandbox',
  settings: 'Settings (own password)',
  website_status: 'Pause / unpause public website',
  manage_admins: 'Manage admins & permissions',
}

/** Default access for new regular admins (main admin can change these). */
export function defaultPermissions(): AdminPermissions {
  return {
    dashboard: true,
    messages: true,
    mail: true,
    stands: true,
    products: true,
    requests: true,
    schools: true,
    content: true,
    sandbox: true,
    settings: true,
    website_status: false,
    manage_admins: false,
  }
}

export function allPermissions(): AdminPermissions {
  return Object.fromEntries(PERMISSION_KEYS.map((k) => [k, true])) as AdminPermissions
}

export function isMainAdminEmail(email: string | null | undefined): boolean {
  return (email ?? '').trim().toLowerCase() === MAIN_ADMIN_EMAIL
}

export function normalizePermissions(input: unknown): AdminPermissions {
  const base = defaultPermissions()
  if (!input || typeof input !== 'object') return base
  const raw = input as Record<string, unknown>
  for (const key of PERMISSION_KEYS) {
    if (typeof raw[key] === 'boolean') base[key] = raw[key]
  }
  // Regular admins never get manage_admins through stored JSON alone —
  // only main admin email grants it.
  base.manage_admins = false
  return base
}

export function permissionsForUser(email: string, stored: unknown): AdminPermissions {
  if (isMainAdminEmail(email)) return allPermissions()
  return normalizePermissions(stored)
}

export function hasPermission(perms: AdminPermissions, key: PermissionKey): boolean {
  return Boolean(perms[key])
}
