/**
 * Social / link-preview metadata for the two PrintX hosts.
 *
 * `index.html` ships with the public shop's Open Graph tags. The portal
 * (admin sign-in on portal.printx.pw) serves the same SPA, so without a
 * rewrite a shared portal link would preview as the shop — with
 * og:url / canonical even pointing at printx.pw. Messaging crawlers
 * (WhatsApp, iMessage, …) don't run JavaScript, so the swap has to
 * happen server-side while the HTML is being served.
 */

export function isPortalHostname(hostname: string | undefined | null): boolean {
  const host = (hostname ?? '').split(':')[0]?.toLowerCase() ?? ''
  return host === 'portal.printx.pw' || host.startsWith('portal.')
}

export const PORTAL_TITLE = 'PrintX Portal — Sign in'
export const PORTAL_DESCRIPTION =
  'Sign in to the PrintX portal to manage orders, messages, designs, stands, and money.'

function replaceMetaContent(
  html: string,
  attr: 'property' | 'name',
  key: string,
  value: string,
): string {
  const re = new RegExp(
    `(<meta\\s[^>]*?${attr}="${key}"[^>]*?content=")[^"]*(")`,
    'i',
  )
  return html.replace(re, `$1${value}$2`)
}

/** Rewrite the shop's preview tags in `index.html` for the portal host. */
export function portalizeSocialHtml(html: string, origin: string): string {
  if (!html.includes('og:title')) return html
  const portalOrigin = origin.replace(/\/+$/, '')
  const image = `${portalOrigin}/portal-og-image.jpg`

  let out = html
  out = out.replace(
    /(<link\s[^>]*?rel="canonical"[^>]*?href=")[^"]*(")/i,
    `$1${portalOrigin}/$2`,
  )
  // The portal is an admin sign-in — keep it out of search indexes.
  // (Link previews don't consult robots meta, so sharing still works.)
  if (!/name="robots"/i.test(out)) {
    out = out.replace(
      /(<link\s[^>]*?rel="canonical"[^>]*?>)/i,
      '$1\n    <meta name="robots" content="noindex, nofollow" />',
    )
  }

  out = replaceMetaContent(out, 'name', 'description', PORTAL_DESCRIPTION)

  out = replaceMetaContent(out, 'property', 'og:url', `${portalOrigin}/`)
  out = replaceMetaContent(out, 'property', 'og:title', PORTAL_TITLE)
  out = replaceMetaContent(out, 'property', 'og:description', PORTAL_DESCRIPTION)
  out = replaceMetaContent(out, 'property', 'og:image', image)
  out = replaceMetaContent(out, 'property', 'og:image:secure_url', image)
  out = replaceMetaContent(out, 'property', 'og:image:alt', PORTAL_TITLE)

  out = replaceMetaContent(out, 'name', 'twitter:title', PORTAL_TITLE)
  out = replaceMetaContent(out, 'name', 'twitter:description', PORTAL_DESCRIPTION)
  out = replaceMetaContent(out, 'name', 'twitter:image', image)
  out = replaceMetaContent(out, 'name', 'twitter:image:alt', PORTAL_TITLE)

  out = out.replace(/<title>[\s\S]*?<\/title>/i, `<title>${PORTAL_TITLE}</title>`)
  return out
}
