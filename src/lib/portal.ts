/** Host helpers for printx.pw (public) vs portal.printx.pw (admin). */

const PUBLIC_ORIGIN = 'https://printx.pw'
const PORTAL_ORIGIN = 'https://portal.printx.pw'

export function isPortalHost(hostname = typeof window !== 'undefined' ? window.location.hostname : ''): boolean {
  if (!hostname) return false
  if (hostname === 'portal.printx.pw') return true
  // Local testing: http://portal.localhost:5675 or portal.127.0.0.1
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

export { PUBLIC_ORIGIN, PORTAL_ORIGIN }
