/** Host helpers for printx.pw (public) vs portal.printx.pw (admin). */

import type { AdminPermissions, PermissionKey } from '../../shared/permissions'

const PUBLIC_ORIGIN = 'https://printx.pw'
const PORTAL_ORIGIN = 'https://portal.printx.pw'

const SECTION_ORDER: { section: string; perm: PermissionKey }[] = [
  { section: 'dashboard', perm: 'dashboard' },
  { section: 'messages', perm: 'messages' },
  { section: 'mail', perm: 'mail' },
  { section: 'stands', perm: 'stands' },
  { section: 'designs', perm: 'products' },
  { section: 'approvals', perm: 'products' },
  { section: 'orders', perm: 'orders' },
  { section: 'requests', perm: 'requests' },
  { section: 'content', perm: 'content' },
  { section: 'settings', perm: 'settings' },
]

export function isPortalHost(hostname = typeof window !== 'undefined' ? window.location.hostname : ''): boolean {
  if (!hostname) return false
  if (hostname === 'portal.printx.pw') return true
  // Local testing: http://portal.localhost:5221 or portal.127.0.0.1
  if (hostname.startsWith('portal.')) return true
  return false
}

export function publicSiteUrl(path = '/'): string {
  const p = path.startsWith('/') ? path : `/${path}`
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host === 'localhost' || host === '127.0.0.1') {
      return `${window.location.origin}${p === '/' ? '/' : p}`
    }
  }
  return `${PUBLIC_ORIGIN}${p === '/' ? '' : p}`
}

export function portalUrl(path = '/'): string {
  const p = path.startsWith('/') ? path : `/${path}`
  if (typeof window !== 'undefined') {
    const host = window.location.hostname
    if (host === 'localhost' || host === '127.0.0.1') {
      // Local: keep /admin paths on the same origin
      if (p === '/' || p === '') return `${window.location.origin}/admin`
      return `${window.location.origin}/admin${p}`
    }
    if (host.startsWith('portal.')) {
      return `${window.location.origin}${p === '/' ? '/' : p}`
    }
  }
  return `${PORTAL_ORIGIN}${p === '/' ? '/' : p}`
}

/** In-app path for admin login home. */
export function adminHomePath(): string {
  return isPortalHost() ? '/' : '/admin'
}

/** In-app path for an admin section, e.g. adminPath('dashboard') → /dashboard or /admin/dashboard */
export function adminPath(section: string): string {
  const s = section.replace(/^\//, '')
  if (!s) return adminHomePath()
  return isPortalHost() ? `/${s}` : `/admin/${s}`
}

/** First portal page this admin is allowed to open. */
export function firstAllowedAdminPath(permissions: AdminPermissions): string {
  const hit = SECTION_ORDER.find((s) => permissions[s.perm])
  return hit ? adminPath(hit.section) : adminHomePath()
}

export { PUBLIC_ORIGIN, PORTAL_ORIGIN }
