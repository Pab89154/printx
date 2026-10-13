/**
 * Normalize / validate Web Push VAPID keys from env (Render often adds quotes/newlines).
 */

export function normalizeVapidKey(raw: string | null | undefined): string {
  let s = String(raw ?? '').trim()
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    s = s.slice(1, -1).trim()
  }
  // Collapse accidental whitespace / newlines from dashboard paste.
  s = s.replace(/\s+/g, '')
  return s
}

/** Decode URL-safe base64 VAPID public key to raw bytes (browser + Node). */
export function vapidPublicKeyToBytes(base64String: string): Uint8Array | null {
  const normalized = normalizeVapidKey(base64String)
  if (!normalized) return null
  try {
    const padding = '='.repeat((4 - (normalized.length % 4)) % 4)
    const base64 = (normalized + padding).replace(/-/g, '+').replace(/_/g, '/')
    if (typeof atob === 'function') {
      const raw = atob(base64)
      const out = new Uint8Array(raw.length)
      for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
      return out
    }
    // Node
    const buf = Buffer.from(base64, 'base64')
    return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  } catch {
    return null
  }
}

/**
 * Uncompressed P-256 public keys used by Web Push are 65 bytes and start with 0x04.
 * web-push generate-vapid-keys produces ~87-char URL-safe base64 for the public key.
 */
export function isValidVapidPublicKey(raw: string | null | undefined): boolean {
  const bytes = vapidPublicKeyToBytes(raw ?? '')
  if (!bytes || bytes.length !== 65) return false
  return bytes[0] === 0x04
}

export function isValidVapidPrivateKey(raw: string | null | undefined): boolean {
  const s = normalizeVapidKey(raw)
  if (!s || s.length < 40 || s.length > 50) return false
  // URL-safe base64 for 32-byte private key is typically 43 chars.
  return /^[A-Za-z0-9_-]+$/.test(s)
}
