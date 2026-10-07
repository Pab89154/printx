/**
 * Normalize image URLs so they load in the browser.
 *
 * Brave (and similar) search image-proxy links block hotlinking and return an
 * empty body. Unwrap them to the underlying source URL when possible.
 */

function decodeBase64Url(chunk: string): string | null {
  try {
    const padded = chunk + '='.repeat((4 - (chunk.length % 4)) % 4)
    const b64 = padded.replace(/-/g, '+').replace(/_/g, '/')
    if (typeof atob === 'function') return atob(b64)
    return Buffer.from(b64, 'base64').toString('utf8')
  } catch {
    return null
  }
}

/** Brave Image Search CDN: .../g:ce/<base64url path chunks> */
function unwrapBraveImageProxy(url: string): string | null {
  if (!/imgs\.search\.brave\.com/i.test(url)) return null
  const marker = '/g:ce/'
  const idx = url.indexOf(marker)
  if (idx < 0) return null
  const encoded = url
    .slice(idx + marker.length)
    .split('?')[0]
    .replace(/\//g, '')
  const decoded = decodeBase64Url(encoded)
  if (!decoded || !/^https?:\/\//i.test(decoded)) return null
  return decoded
}

export function resolveImageUrl(raw: string | null | undefined): string {
  const url = (raw || '').trim()
  if (!url) return ''
  return unwrapBraveImageProxy(url) || url
}
