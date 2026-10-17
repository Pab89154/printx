/* PrintX portal service worker — Web Push + keep iOS PWA off stale shells.
 * Cache version bump forces activate() to drop old Cache Storage entries.
 */
const CACHE_VERSION = 'printx-sw-v6'

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

// Network-first for navigations / HTML so home-screen apps don't stick on old index.html.
self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)
  if (url.origin !== self.location.origin) return

  const accept = req.headers.get('accept') || ''
  const isNavigate = req.mode === 'navigate' || accept.includes('text/html')
  const isShell =
    url.pathname === '/' ||
    url.pathname === '/index.html' ||
    url.pathname === '/sw.js' ||
    url.pathname === '/manifest.webmanifest'

  if (!isNavigate && !isShell) return

  event.respondWith(
    fetch(req)
      .then((res) => res)
      .catch(async () => {
        const cached = await caches.match(req)
        if (cached) return cached
        return new Response('Offline', { status: 503, statusText: 'Offline' })
      }),
  )
})

self.addEventListener('push', (event) => {
  let data = { title: 'PrintX', body: 'Something new in the portal', url: '/' }
  try {
    if (event.data) {
      const parsed = event.data.json()
      data = {
        title: typeof parsed.title === 'string' ? parsed.title : data.title,
        body: typeof parsed.body === 'string' ? parsed.body : data.body,
        url: typeof parsed.url === 'string' ? parsed.url : data.url,
      }
    }
  } catch {
    try {
      const text = event.data && event.data.text()
      if (text) data.body = text
    } catch {
      /* ignore */
    }
  }

  const options = {
    body: data.body,
    icon: '/apple-touch-icon.png',
    badge: '/favicon-32.png',
    data: { url: data.url },
    tag: `printx-${data.url || 'alert'}`,
  }
  // Brave rejects some newer options (renotify). Fall back so the alert still shows.
  event.waitUntil(
    self.registration.showNotification(data.title, { ...options, renotify: true }).catch(() =>
      self.registration.showNotification(data.title, options),
    ),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const raw = (event.notification.data && event.notification.data.url) || '/'
  const targetUrl = new URL(raw, self.location.origin).href

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          const c = client
          if ('navigate' in c) {
            return c.navigate(targetUrl).then((nav) => (nav ? nav.focus() : c.focus()))
          }
          return c.focus()
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl)
    }),
  )
})
