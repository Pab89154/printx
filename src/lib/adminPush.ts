import { api } from './api'

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

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

export async function enableAdminPush(): Promise<PushSetupState> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return isIosDevice() && !isStandaloneDisplay() ? 'needs_homescreen' : 'unsupported'
  }
  if (isIosDevice() && !isStandaloneDisplay()) return 'needs_homescreen'

  let publicKey = ''
  try {
    const vapid = await api.admin.push.vapidPublicKey()
    publicKey = vapid.publicKey
  } catch {
    return 'no_vapid'
  }
  if (!publicKey) return 'no_vapid'

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'ready'

  const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' })
  await navigator.serviceWorker.ready

  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
    })
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
