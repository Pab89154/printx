import { api } from './api'
import { isValidVapidPublicKey, normalizeVapidKey, vapidPublicKeyToBytes } from '../../shared/vapid'

export type PushSetupState =
  | 'loading'
  | 'unsupported'
  | 'needs_https'
  | 'needs_homescreen'
  | 'no_vapid'
  | 'denied'
  | 'enabled'
  | 'ready'

/** Brave hides "Brave" in the UA. `navigator.brave` is the supported check. */
export function isBraveBrowser(): boolean {
  if (typeof navigator === 'undefined') return false
  return Boolean((navigator as Navigator & { brave?: unknown }).brave)
}

export const BRAVE_PUSH_HELP =
  'Brave blocks browser notifications until Google push is on. Open brave://settings/privacy, turn on Use Google services for push messaging, allow notifications for this site (lion icon → notifications), then tap Enable again.'

export function isIosDevice(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent || ''
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false
  const mq = window.matchMedia?.('(display-mode: standalone)')?.matches
  const iosStandalone = Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
  return Boolean(mq || iosStandalone)
}

export async function getPushSetupState(): Promise<PushSetupState> {
  if (typeof window === 'undefined') return 'unsupported'
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') {
    if (isIosDevice() && !isStandaloneDisplay()) return 'needs_homescreen'
    return 'unsupported'
  }
  if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    return 'needs_https'
  }
  if (isIosDevice() && !isStandaloneDisplay()) return 'needs_homescreen'
  if (Notification.permission === 'denied') return 'denied'

  try {
    const reg = await navigator.serviceWorker.getRegistration()
    const sub = await reg?.pushManager.getSubscription()
    if (sub && Notification.permission === 'granted') return 'enabled'
  } catch {
    /* ignore */
  }
  return 'ready'
}

/** Exact-sized ArrayBuffer — WebKit rejects views over a larger backing store. */
function applicationServerKeyBuffer(publicKey: string): ArrayBuffer {
  const bytes = vapidPublicKeyToBytes(publicKey)
  if (!bytes) throw new Error('Invalid VAPID public key from server.')
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer
}

function keysMatch(a: ArrayBuffer | null | undefined, b: ArrayBuffer): boolean {
  if (!a) return false
  const left = new Uint8Array(a)
  const right = new Uint8Array(b)
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i++) {
    if (left[i] !== right[i]) return false
  }
  return true
}

function pushServiceUnavailable(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
  return (
    msg.includes('push service') ||
    msg.includes('not available') ||
    msg.includes('registration failed') ||
    msg.includes('abort')
  )
}

function pushSubscribeErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (isBraveBrowser() && pushServiceUnavailable(err)) return BRAVE_PUSH_HELP
  const lower = msg.toLowerCase()
  if (
    lower.includes('push service error') ||
    lower.includes('registration failed') ||
    lower.includes('applicationserverkey') ||
    lower.includes('abort') ||
    lower.includes('invalid')
  ) {
    return (
      'Could not register this phone for push. Force-quit the PrintX app, open it again from the Home Screen icon, then tap Enable again. ' +
      'If it still fails: Settings → Notifications → PrintX → turn off and on, then retry.'
    )
  }
  return msg || 'Could not enable notifications.'
}

async function dropLocalSubscription(reg: ServiceWorkerRegistration): Promise<void> {
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  try {
    await api.admin.push.unsubscribe(sub.endpoint)
  } catch {
    /* local drop still needed */
  }
  try {
    await sub.unsubscribe()
  } catch {
    /* continue */
  }
}

async function hardResetServiceWorker(): Promise<ServiceWorkerRegistration> {
  const regs = await navigator.serviceWorker.getRegistrations()
  for (const reg of regs) {
    await dropLocalSubscription(reg)
    try {
      await reg.unregister()
    } catch {
      /* continue */
    }
  }
  if ('caches' in window) {
    try {
      const keys = await caches.keys()
      await Promise.all(keys.map((k) => caches.delete(k)))
    } catch {
      /* ignore */
    }
  }
  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  try {
    await reg.update()
  } catch {
    /* ignore */
  }
  await navigator.serviceWorker.ready
  return reg
}

async function subscribeWithKey(
  reg: ServiceWorkerRegistration,
  appKey: ArrayBuffer,
): Promise<PushSubscription> {
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: appKey,
  })
}

async function persistSubscription(sub: PushSubscription): Promise<void> {
  const json = sub.toJSON()
  await api.admin.push.subscribe({
    endpoint: json.endpoint || sub.endpoint,
    keys: {
      p256dh: json.keys?.p256dh || '',
      auth: json.keys?.auth || '',
    },
    userAgent: navigator.userAgent,
  })
}

export async function enableAdminPush(): Promise<PushSetupState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return isIosDevice() && !isStandaloneDisplay() ? 'needs_homescreen' : 'unsupported'
  }
  if (isIosDevice() && !isStandaloneDisplay()) return 'needs_homescreen'

  let publicKey = ''
  try {
    const vapid = await api.admin.push.vapidPublicKey()
    publicKey = normalizeVapidKey(vapid.publicKey)
  } catch {
    return 'no_vapid'
  }
  if (!publicKey || !isValidVapidPublicKey(publicKey)) return 'no_vapid'

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'ready'

  const appKey = applicationServerKeyBuffer(publicKey)

  let reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  try {
    await reg.update()
  } catch {
    /* ignore */
  }
  await navigator.serviceWorker.ready

  let existing = await reg.pushManager.getSubscription()
  // Already on the current VAPID key — just refresh the server record.
  if (existing && keysMatch(existing.options.applicationServerKey ?? null, appKey)) {
    await persistSubscription(existing)
    return 'enabled'
  }

  // Stale sub from a previous VAPID key (Render → Cloudflare, or key rotation).
  if (existing) {
    await dropLocalSubscription(reg)
    existing = null
  }

  try {
    const sub = await subscribeWithKey(reg, appKey)
    await persistSubscription(sub)
    return 'enabled'
  } catch (firstErr) {
    if (isBraveBrowser() && pushServiceUnavailable(firstErr)) {
      throw new Error(BRAVE_PUSH_HELP)
    }
    // iOS / Safari often keep a ghost registration until the SW is fully torn down.
    try {
      reg = await hardResetServiceWorker()
      const sub = await subscribeWithKey(reg, appKey)
      await persistSubscription(sub)
      return 'enabled'
    } catch {
      throw new Error(pushSubscribeErrorMessage(firstErr))
    }
  }
}

export async function disableAdminPush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg) return
  await dropLocalSubscription(reg)
}

/** Full local reset used by Settings when Enable keeps failing after a VAPID change. */
export async function resetAdminPushDevice(): Promise<void> {
  if (!('serviceWorker' in navigator)) return
  await hardResetServiceWorker()
}
