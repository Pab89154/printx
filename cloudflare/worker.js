/**
 * PrintX wake Worker — stays in front of the Render web service.
 * If the API is asleep, visitors see the PrintX loading screen (not Render’s spinner).
 * Once /api/health returns real JSON { ok: true }, we proxy to the real site.
 */

const HEALTH_MS = 2500

function wantsHtml(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') return false
  const accept = request.headers.get('Accept') || ''
  return accept.includes('text/html')
}

function isAssetPath(pathname) {
  return (
    pathname.startsWith('/assets/') ||
    pathname.startsWith('/icons/') ||
    /\.(svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff2?|ttf|txt|json)$/i.test(pathname)
  )
}

function looksLikeRenderLoadingPage(text) {
  if (!text) return false
  return (
    text.includes('APPLICATION LOADING') ||
    text.includes('WELCOME TO RENDER') ||
    text.includes('SERVICE WAKING UP') ||
    text.includes('STARTING THE INSTANCE')
  )
}

/** True only when the real PrintX app answers JSON { ok: true }. */
async function originHealth(origin) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), HEALTH_MS)
  try {
    const res = await fetch(`${origin}/api/health`, {
      method: 'GET',
      redirect: 'manual',
      signal: ctrl.signal,
      headers: { Accept: 'application/json', 'Cache-Control': 'no-store' },
    })
    if (!res.ok) return false
    const ct = (res.headers.get('content-type') || '').toLowerCase()
    if (!ct.includes('application/json')) return false
    const data = await res.json().catch(() => null)
    return !!(data && data.ok === true)
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

function originUrl(request, origin) {
  const incoming = new URL(request.url)
  const target = new URL(origin)
  target.pathname = incoming.pathname
  target.search = incoming.search
  return target
}

function withEdge(res, mode) {
  const headers = new Headers(res.headers)
  headers.set('x-printx-edge', mode)
  headers.set('cache-control', headers.get('cache-control') || 'no-store')
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  })
}

async function proxyToOrigin(request, origin, { htmlFallbackPath } = {}) {
  const target = originUrl(request, origin)
  const headers = new Headers(request.headers)
  headers.set('Host', target.host)
  headers.set('X-Forwarded-Host', new URL(request.url).host)
  headers.set('X-Forwarded-Proto', 'https')
  headers.delete('cf-connecting-ip')

  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'
  const res = await fetch(target.toString(), {
    method: request.method,
    headers,
    redirect: 'manual',
    body: hasBody ? request.body : undefined,
    duplex: hasBody ? 'half' : undefined,
  })

  // If Render is still spinning up, it may return its own HTML loading page.
  // Never show that — swap in the PrintX wake screen.
  if (htmlFallbackPath != null) {
    const ct = (res.headers.get('content-type') || '').toLowerCase()
    if (ct.includes('text/html')) {
      const text = await res.text()
      if (looksLikeRenderLoadingPage(text)) {
        return withEdge(
          new Response(wakeHtml(htmlFallbackPath), {
            status: 200,
            headers: {
              'content-type': 'text/html; charset=utf-8',
              'cache-control': 'no-store',
            },
          }),
          'wake',
        )
      }
      return withEdge(
        new Response(text, {
          status: res.status,
          statusText: res.statusText,
          headers: res.headers,
        }),
        'proxy',
      )
    }
  }

  return withEdge(res, 'proxy')
}

function wakeHtml(returnTo) {
  const returnPath = JSON.stringify(String(returnTo || '/'))
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
  <meta name="theme-color" content="#0b1220" />
  <title>PrintX</title>
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700;800&display=swap" rel="stylesheet" />
  <style>
    html, body { margin: 0; min-height: 100%; background: #0b1220; }
    .wrap {
      min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center;
      gap: 1.25rem; padding: 2rem 1.5rem; box-sizing: border-box; text-align: center;
      font-family: "DM Sans", system-ui, sans-serif; color: #fff;
    }
    .mark {
      width: 88px; height: 88px; border-radius: 22%;
      border: 1.5px solid rgba(255,255,255,0.55); overflow: hidden; background: #0b1220;
    }
    .mark svg { display: block; width: 100%; height: 100%; }
    h1 { margin: 0; font-size: clamp(2rem, 5vw, 2.75rem); font-weight: 800; letter-spacing: -0.03em; }
    .tag { margin: 0; font-size: 1.05rem; font-weight: 500; color: rgba(255,255,255,0.88); max-width: 22rem; }
    .dots { display: flex; gap: 0.55rem; margin-top: 0.35rem; }
    .dots span {
      width: 0.55rem; height: 0.55rem; border-radius: 999px;
      animation: dot 1.1s ease-in-out infinite;
    }
    .dots span:nth-child(1) { background: #2563eb; }
    .dots span:nth-child(2) { background: #12b5d4; animation-delay: 160ms; }
    .dots span:nth-child(3) { background: #2563eb; animation-delay: 320ms; }
    .status { margin: 0.15rem 0 0; font-size: 0.95rem; font-weight: 500; color: rgba(148,163,184,0.95); }
    .actions { display: none; margin-top: 0.25rem; }
    .is-error .dots { display: none; }
    .is-error .actions { display: block; }
    button {
      appearance: none; border: 1px solid rgba(18,181,212,0.55); background: rgba(18,181,212,0.12);
      color: #e2f8fc; font: inherit; font-size: 0.9rem; font-weight: 600;
      padding: 0.65rem 1.15rem; border-radius: 0.75rem; cursor: pointer;
    }
    @keyframes dot {
      0%, 80%, 100% { transform: translateY(0); opacity: 0.45; }
      40% { transform: translateY(-5px); opacity: 1; }
    }
    @media (prefers-reduced-motion: reduce) {
      .dots span { animation: none; opacity: 0.85; }
    }
  </style>
</head>
<body>
  <div class="wrap" id="wrap" role="status" aria-live="polite" aria-busy="true">
    <div class="mark" aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="PrintX">
        <rect width="512" height="512" fill="#0B1220"/>
        <g fill="#FFFFFF">
          <rect x="118" y="236" width="276" height="40" rx="20" transform="rotate(45 256 256)"/>
          <rect x="118" y="236" width="276" height="40" rx="20" transform="rotate(-45 256 256)"/>
        </g>
        <rect x="210" y="230" width="92" height="20" rx="5" fill="#2563EB"/>
        <rect x="210" y="262" width="92" height="20" rx="5" fill="#12B5D4"/>
      </svg>
    </div>
    <h1>PrintX</h1>
    <p class="tag">Your next creation starts here.</p>
    <div class="dots" aria-hidden="true"><span></span><span></span><span></span></div>
    <p class="status" id="status">Getting everything ready…</p>
    <div class="actions"><button type="button" id="retry">Try again</button></div>
  </div>
  <script>
    (function () {
      var RETURN_TO = ${returnPath}
      var wrap = document.getElementById('wrap')
      var statusEl = document.getElementById('status')
      var attempts = 0
      var timer = null
      var done = false

      function setStatus(text, isError) {
        statusEl.textContent = text
        wrap.classList.toggle('is-error', !!isError)
        wrap.setAttribute('aria-busy', isError ? 'false' : 'true')
      }

      function go() {
        if (done) return
        done = true
        if (timer) clearTimeout(timer)
        location.replace(RETURN_TO)
      }

      function schedule(ms) {
        if (timer) clearTimeout(timer)
        timer = setTimeout(ping, ms)
      }

      function ping() {
        if (done) return
        attempts += 1
        var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
        var t = ctrl ? setTimeout(function () { ctrl.abort() }, 12000) : null
        fetch('/api/health', { cache: 'no-store', credentials: 'same-origin', signal: ctrl && ctrl.signal })
          .then(function (res) {
            if (!res.ok) throw new Error('not ready')
            var ct = (res.headers.get('content-type') || '').toLowerCase()
            if (ct.indexOf('application/json') === -1) throw new Error('not json')
            return res.json()
          })
          .then(function (data) {
            if (data && data.ok === true) { go(); return }
            throw new Error('not ready')
          })
          .catch(function () {
            if (done) return
            if (attempts < 3) setStatus('Getting everything ready…', false)
            else if (attempts < 12) setStatus('Still waking the server… this can take about a minute.', false)
            else setStatus('Taking longer than usual. Check your connection, then try again.', true)
            schedule(attempts >= 12 ? 5000 : Math.min(1500 + attempts * 250, 4000))
          })
          .finally(function () { if (t) clearTimeout(t) })
      }

      document.getElementById('retry').addEventListener('click', function () {
        attempts = 0
        setStatus('Getting everything ready…', false)
        ping()
      })
      ping()
    })()
  </script>
</body>
</html>`
}

function misconfiguredHtml(detail) {
  return `<!doctype html>
<html lang="en"><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>PrintX setup</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
  background:#0b1220;color:#fff;font-family:"DM Sans",system-ui,sans-serif;padding:1.5rem;text-align:center}
  h1{font-size:1.5rem;margin:0 0 .75rem} p{color:#94a3b8;max-width:28rem;line-height:1.5}
  code{color:#12b5d4}
</style></head>
<body><div>
  <h1>PrintX Worker needs ORIGIN</h1>
  <p>${detail}</p>
  <p>In Cloudflare → Worker → Settings → Variables, set <code>ORIGIN</code> to
  <code>https://printx-28ww.onrender.com</code> (not printx.pw).</p>
</div></body></html>`
}

function normalizeOrigin(rawOrigin) {
  const withScheme = /^https?:\/\//i.test(rawOrigin) ? rawOrigin : `https://${rawOrigin}`
  return withScheme.replace(/\/$/, '')
}

export default {
  async fetch(request, env) {
    const rawOrigin = (env.ORIGIN || '').trim()
    const url = new URL(request.url)

    if (!rawOrigin) {
      return withEdge(
        new Response(misconfiguredHtml('The <code>ORIGIN</code> variable is missing.'), {
          status: 500,
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
        }),
        'error',
      )
    }

    const origin = normalizeOrigin(rawOrigin)
    if (origin.includes('printx.pw')) {
      return withEdge(
        new Response(
          misconfiguredHtml('ORIGIN must be the Render <code>*.onrender.com</code> URL, not printx.pw.'),
          {
            status: 500,
            headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
          },
        ),
        'error',
      )
    }

    // Health is answered by the Worker so browsers never get Render's HTML spinner as "ok".
    if (url.pathname === '/api/health' && (request.method === 'GET' || request.method === 'HEAD')) {
      const awake = await originHealth(origin)
      return withEdge(
        new Response(JSON.stringify({ ok: awake }), {
          status: awake ? 200 : 503,
          headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
          },
        }),
        awake ? 'health-ok' : 'health-wait',
      )
    }

    // Other API + assets: proxy (also helps wake Render).
    if (url.pathname.startsWith('/api/') || isAssetPath(url.pathname)) {
      return proxyToOrigin(request, origin)
    }

    // HTML page visits
    if (wantsHtml(request)) {
      const path = url.pathname + url.search
      const awake = await originHealth(origin)
      if (!awake) {
        return withEdge(
          new Response(wakeHtml(path), {
            status: 200,
            headers: {
              'content-type': 'text/html; charset=utf-8',
              'cache-control': 'no-store',
            },
          }),
          'wake',
        )
      }
      return proxyToOrigin(request, origin, { htmlFallbackPath: path })
    }

    return proxyToOrigin(request, origin)
  },
}
