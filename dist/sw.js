/* PrintX portal service worker — Web Push → Notification Center (iOS PWA + Android). */

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
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

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: '/apple-touch-icon.png',
      badge: '/favicon-32.png',
      data: { url: data.url },
      tag: `printx-${data.url}`,
      renotify: true,
    }),
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
