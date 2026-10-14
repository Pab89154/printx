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

function applicationServerKeyFromVapid(publicKey: string): Uint8Array {
  const bytes = vapidPublicKeyToBytes(publicKey)
  if (!bytes) throw new Error('Invalid VAPID public key from server.')
  // Exact-sized copy — WebKit rejects ArrayBuffer views / oversized backing buffers.
  return new Uint8Array(bytes)
}

function pushSubscribeErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  const lower = msg.toLowerCase()
  if (
    lower.includes('push service error') ||
    lower.includes('registration failed') ||
    lower.includes('applicationserverkey') ||
    lower.includes('invalid')
  ) {
    return (
      'Push service rejected this device registration. VAPID keys were refreshed on Cloudflare — ' +
      'close the portal tab, reopen from the Home Screen icon, then tap Enable again.'
    )
  }
  return msg || 'Could not enable notifications.'
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

  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  try {
    await reg.update()
  } catch {
    /* ignore */
  }
  await navigator.serviceWorker.ready

  const appKey = applicationServerKeyFromVapid(publicKey)
  let sub = await reg.pushManager.getSubscription()
  // Stale subs from old VAPID keys (e.g. Render → Cloudflare) must be dropped first.
  if (sub) {
    try {
      await sub.unsubscribe()
    } catch {
      /* continue to subscribe */
    }
    sub = null
  }
  try {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: appKey,
    })
  } catch (err) {
    throw new Error(pushSubscribeErrorMessage(err))
  }

  const json = sub.toJSON()
  await api.admin.push.subscribe({
    endpoint: json.endpoint || sub.endpoint,
    keys: {
      p256dh: json.keys?.p256dh || '',
      auth: json.keys?.auth || '',
    },
    userAgent: navigator.userAgent,
  })
  return 'enabled'
}

export async function disableAdminPush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  try {
    await api.admin.push.unsubscribe(sub.endpoint)
  } catch {
    /* still drop local sub */
  }
  await sub.unsubscribe()
}
