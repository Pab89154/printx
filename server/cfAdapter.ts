/**
 * Adapt Cloudflare Workers fetch Request/Response to Node IncomingMessage/ServerResponse
 * so existing handleApi routers keep working under nodejs_compat.
 */
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleApi } from './router.ts'
import { ensureDbReady } from './db.ts'
import { usingPostgres } from './dbClient.ts'
import { isPortalHostname, portalizeSocialHtml } from './socialMeta.ts'
import { GITHUB_MODEL_FILES } from '../shared/githubModels.ts'

export type WorkerEnv = {
  DATABASE_URL?: string
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  SUPABASE_SERVICE_ROLE_KEY?: string
  PRINTX_SESSION_SECRET?: string
  PRINTX_ADMIN_EMAIL?: string
  PRINTX_ADMIN_PASSWORD?: string
  PRINTX_COOKIE_DOMAIN?: string
  PRINTX_GITHUB_TOKEN?: string
  PRINTX_GITHUB_REPO?: string
  PRINTX_GITHUB_REF?: string
  STRIPE_SECRET_KEY?: string
  STRIPE_WEBHOOK_SECRET?: string
  RESEND_API_KEY?: string
  PRINTX_NOTIFY_EMAIL?: string
  PRINTX_MAIL_FROM?: string
  PRINTX_PUBLIC_ORIGIN?: string
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT?: string
  /** Pages asset binding when deployed as Pages `_worker`. */
  ASSETS?: { fetch: (req: Request) => Promise<Response> }
  HYPERDRIVE?: { connectionString: string }
}

let bootstrapped = false
let bootstrapPromise: Promise<void> | null = null
let storageWarmPromise: Promise<void> | null = null

export function applyWorkerEnv(env: WorkerEnv) {
  const map: [keyof WorkerEnv, string][] = [
    ['DATABASE_URL', 'DATABASE_URL'],
    ['SUPABASE_URL', 'SUPABASE_URL'],
    ['SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY'],
    ['SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
    ['PRINTX_SESSION_SECRET', 'PRINTX_SESSION_SECRET'],
    ['PRINTX_ADMIN_EMAIL', 'PRINTX_ADMIN_EMAIL'],
    ['PRINTX_ADMIN_PASSWORD', 'PRINTX_ADMIN_PASSWORD'],
    ['PRINTX_COOKIE_DOMAIN', 'PRINTX_COOKIE_DOMAIN'],
    ['PRINTX_GITHUB_TOKEN', 'PRINTX_GITHUB_TOKEN'],
    ['PRINTX_GITHUB_REPO', 'PRINTX_GITHUB_REPO'],
    ['PRINTX_GITHUB_REF', 'PRINTX_GITHUB_REF'],
    ['STRIPE_SECRET_KEY', 'STRIPE_SECRET_KEY'],
    ['STRIPE_WEBHOOK_SECRET', 'STRIPE_WEBHOOK_SECRET'],
    ['RESEND_API_KEY', 'RESEND_API_KEY'],
    ['PRINTX_NOTIFY_EMAIL', 'PRINTX_NOTIFY_EMAIL'],
    ['PRINTX_MAIL_FROM', 'PRINTX_MAIL_FROM'],
    ['PRINTX_PUBLIC_ORIGIN', 'PRINTX_PUBLIC_ORIGIN'],
    ['VAPID_PUBLIC_KEY', 'VAPID_PUBLIC_KEY'],
    ['VAPID_PRIVATE_KEY', 'VAPID_PRIVATE_KEY'],
    ['VAPID_SUBJECT', 'VAPID_SUBJECT'],
  ]
  for (const [from, to] of map) {
    const v = env[from]
    // Prefer Worker bindings/secrets over any empty/stale process.env values.
    if (typeof v === 'string' && v.trim()) {
      process.env[to] = v
    }
  }
  if (env.HYPERDRIVE?.connectionString) {
    process.env.DATABASE_URL = env.HYPERDRIVE.connectionString
  }
  process.env.PRINTX_COOKIE_DOMAIN = process.env.PRINTX_COOKIE_DOMAIN || '.printx.pw'
  // Object storage required on Workers (no durable local disk).
  process.env.PRINTX_REQUIRE_OBJECT_STORAGE = '1'
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

/** DB ready is required; storage bucket check runs in the background so auth never stalls. */
async function ensureBootstrapped() {
  if (bootstrapped) return
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      if (!usingPostgres()) {
        throw new Error('DATABASE_URL (or Hyperdrive) is required on Cloudflare Workers.')
      }
      await withTimeout(ensureDbReady(), 12_000, 'Database bootstrap')
      bootstrapped = true
      if (!storageWarmPromise) {
        storageWarmPromise = (async () => {
          const { ensureModelBucket, logObjectStorageStatus } = await import('./objectStorage.ts')
          logObjectStorageStatus()
          await ensureModelBucket()
        })().catch((err) => {
          console.warn('[cf-worker] storage warm failed', err)
          storageWarmPromise = null
        })
      }
    })().catch((err) => {
      bootstrapPromise = null
      throw err
    })
  }
  await bootstrapPromise
}

function buildIncomingMessage(request: Request, body: Buffer): IncomingMessage {
  const url = new URL(request.url)
  const pathWithQuery = `${url.pathname}${url.search}`
  const headers: Record<string, string | string[] | undefined> = {}
  request.headers.forEach((value, key) => {
    const existing = headers[key]
    if (existing === undefined) headers[key] = value
    else if (Array.isArray(existing)) existing.push(value)
    else headers[key] = [existing, value]
  })

  const readable = Readable.from(body) as IncomingMessage
  readable.method = request.method
  readable.url = pathWithQuery
  readable.headers = headers as IncomingMessage['headers']
  readable.httpVersion = '1.1'
  readable.httpVersionMajor = 1
  readable.httpVersionMinor = 1
  readable.socket = { remoteAddress: '0.0.0.0' } as IncomingMessage['socket']
  return readable
}

function pushChunk(chunks: Buffer[], chunk: unknown) {
  if (chunk == null || typeof chunk === 'function') return
  if (Buffer.isBuffer(chunk)) {
    chunks.push(chunk)
    return
  }
  if (chunk instanceof Uint8Array) {
    chunks.push(Buffer.from(chunk))
    return
  }
  chunks.push(Buffer.from(String(chunk)))
}

/**
 * Plain ServerResponse mock — do NOT use node:stream Writable.
 * Patching Writable.end previously double-wrote bodies ({...}{...}) and could hang
 * the Worker on origEnd() before the fetch handler returned.
 */
function buildServerResponse(): {
  res: ServerResponse
  done: Promise<Response>
} {
  let statusCode = 200
  const headerMap = new Map<string, string | string[]>()
  const chunks: Buffer[] = []
  let ended = false
  let resolveDone!: (r: Response) => void
  const done = new Promise<Response>((resolve) => {
    resolveDone = resolve
  })

  const finish = () => {
    if (ended) return
    ended = true
    const body = Buffer.concat(chunks)
    const headers = new Headers()
    for (const [k, v] of headerMap) {
      if (Array.isArray(v)) v.forEach((item) => headers.append(k, item))
      else headers.set(k, v)
    }
    resolveDone(new Response(body.byteLength ? body : null, { status: statusCode, headers }))
  }

  const res = {
    get statusCode() {
      return statusCode
    },
    set statusCode(v: number) {
      statusCode = v
    },
    get writableEnded() {
      return ended
    },
    get headersSent() {
      return ended
    },
    setHeader(name: string, value: number | string | readonly string[]) {
      headerMap.set(String(name).toLowerCase(), value as string | string[])
      return res
    },
    getHeader(name: string) {
      return headerMap.get(String(name).toLowerCase())
    },
    removeHeader(name: string) {
      headerMap.delete(String(name).toLowerCase())
    },
    writeHead(code: number, maybeHeaders?: Record<string, string | string[]>) {
      statusCode = code
      if (maybeHeaders) {
        for (const [k, v] of Object.entries(maybeHeaders)) {
          headerMap.set(k.toLowerCase(), v)
        }
      }
      return res
    },
    write(chunk: unknown, encodingOrCb?: unknown, maybeCb?: unknown) {
      pushChunk(chunks, chunk)
      const cb = typeof encodingOrCb === 'function' ? encodingOrCb : maybeCb
      if (typeof cb === 'function') queueMicrotask(() => (cb as () => void)())
      return true
    },
    end(chunk?: unknown, encodingOrCb?: unknown, maybeCb?: unknown) {
      pushChunk(chunks, chunk)
      const cb = typeof encodingOrCb === 'function' ? encodingOrCb : maybeCb
      finish()
      if (typeof cb === 'function') queueMicrotask(() => (cb as () => void)())
      return res
    },
  } as unknown as ServerResponse

  return { res, done }
}

/**
 * Same-origin model CDN. Browsers used to be redirected to raw GitHub or a
 * signed Supabase URL; school networks, Safari, and CDN size limits kept
 * breaking those. The Worker streams the file instead and edge-caches it.
 */
async function serveModelCdn(
  request: Request,
  url: URL,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<Response> {
  const file = decodeURIComponent(url.pathname.slice('/cdn/models/'.length))
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.stl$/.test(file) || file.includes('..')) {
    return Response.json({ error: 'Model not found' }, { status: 404 })
  }

  type CacheStorageWithDefault = CacheStorage & { default?: Cache }
  const cache = (globalThis as { caches?: CacheStorageWithDefault }).caches?.default
  const cacheKey = new Request(`${url.origin}/cdn/models/${encodeURIComponent(file)}`)
  const range = request.headers.get('range')
  if (cache && !range) {
    const hit = await cache.match(cacheKey)
    if (hit) return hit
  }

  let upstream: Response | null = null
  if (GITHUB_MODEL_FILES.has(file)) {
    const repo = (process.env.PRINTX_GITHUB_REPO || 'Pab89154/printx').trim()
    const ref = (process.env.PRINTX_GITHUB_REF || 'main').trim() || 'main'
    const sources = [
      `https://rawcdn.githack.com/${repo}/${ref}/models/${encodeURIComponent(file)}`,
      `https://raw.githubusercontent.com/${repo}/${ref}/models/${encodeURIComponent(file)}`,
    ]
    for (const source of sources) {
      try {
        const res = await fetch(source, range ? { headers: { Range: range } } : undefined)
        if (res.ok || res.status === 206) {
          upstream = res
          break
        }
      } catch {
        /* try the next source */
      }
    }
  } else {
    const { signedStoredFileUrl } = await import('./objectStorage.ts')
    const signed = await signedStoredFileUrl(file)
    if (signed) {
      const res = await fetch(signed, range ? { headers: { Range: range } } : undefined)
      if (res.ok || res.status === 206) upstream = res
    }
  }
  if (!upstream) {
    return Response.json({ error: 'Model not found' }, { status: 404 })
  }

  const headers = new Headers()
  headers.set('Content-Type', 'model/stl')
  headers.set('Access-Control-Allow-Origin', '*')
  headers.set('Cross-Origin-Resource-Policy', 'cross-origin')
  headers.set('Cache-Control', 'public, max-age=31536000, immutable')
  const length = upstream.headers.get('content-length')
  if (length) headers.set('Content-Length', length)
  const contentRange = upstream.headers.get('content-range')
  if (contentRange) headers.set('Content-Range', contentRange)
  const etag = upstream.headers.get('etag')
  if (etag) headers.set('ETag', etag)

  const response = new Response(upstream.body, { status: upstream.status, headers })
  if (cache && !range && upstream.status === 200) {
    const put = cache.put(cacheKey, response.clone()).catch(() => undefined)
    if (waitUntil) waitUntil(put)
    else void put
  }
  return response
}

export async function handleWorkerFetch(
  request: Request,
  env: WorkerEnv,
  ctx?: { waitUntil: (p: Promise<unknown>) => void },
): Promise<Response> {
  applyWorkerEnv(env)
  const url = new URL(request.url)
  const pathname = url.pathname

  if (pathname.startsWith('/cdn/models/') && request.method === 'GET') {
    try {
      return await serveModelCdn(request, url, ctx?.waitUntil?.bind(ctx))
    } catch (err) {
      console.error('[cdn-models]', err)
      return Response.json({ error: 'Model failed to load' }, { status: 502 })
    }
  }

  if (pathname === '/api/health' && request.method === 'GET') {
    return Response.json({ ok: true, runtime: 'cloudflare-worker' })
  }

  // Unauthenticated session probe — skip DB bootstrap so the portal never sits on
  // "Checking authentication…" waiting for cold migrations.
  if (pathname === '/api/admin/me' && request.method === 'GET') {
    const cookie = request.headers.get('cookie') || ''
    if (!/(?:^|;\s*)printx_session=/.test(cookie)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  if (pathname.startsWith('/api/')) {
    try {
      await ensureBootstrapped()
      const ab = await request.arrayBuffer()
      const body = Buffer.from(ab)
      const req = buildIncomingMessage(request, body)
      const { res, done } = buildServerResponse()

      const handlerPromise = handleApi(req, res, pathname, request.method).then((handled) => {
        if (!handled && !res.writableEnded) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Not found' }))
        } else if (handled && !res.writableEnded) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'No response' }))
        }
      })

      // Model uploads write to disk then Supabase; 20s was cutting them off.
      const isUpload =
        request.method === 'POST' &&
        (pathname.includes('/upload') ||
          pathname.endsWith('/quote-tick') ||
          (request.headers.get('content-type') || '').includes('multipart/form-data'))
      const timeoutMs = isUpload ? 28_000 : 20_000
      // Always settle — never leave the portal fetch hanging on a stuck stream.
      return await Promise.race([
        done,
        handlerPromise.then(() => done),
        new Promise<Response>((resolve) =>
          setTimeout(
            () => resolve(Response.json({ error: 'Request timed out' }, { status: 504 })),
            timeoutMs,
          ),
        ),
      ])
    } catch (err) {
      console.error('[cf-worker]', err)
      return Response.json(
        { error: err instanceof Error ? err.message : 'Internal server error' },
        { status: 500 },
      )
    }
  }

  if (env.ASSETS) {
    const assetRes = await env.ASSETS.fetch(request)
    // Missing hashed bundles must stay 404 (not index.html) — iOS home-screen apps
    // often keep a stale index that points at deleted /assets/index-*.js.
    if (assetRes.status !== 404) {
      return withSocialMeta(url, pathname, assetRes)
    }
    if (request.method === 'GET' && shouldSpaFallback(pathname)) {
      const indexRes = await env.ASSETS.fetch(new URL('/index.html', url.origin))
      return withSocialMeta(url, '/index.html', indexRes)
    }
    return assetRes
  }
  return new Response('Not found', { status: 404 })
}

/** Paths that should soft-route to the React SPA when no static file exists. */
function shouldSpaFallback(pathname: string): boolean {
  if (pathname.startsWith('/api/')) return false
  if (pathname.startsWith('/assets/')) return false
  if (
    pathname === '/sw.js' ||
    pathname === '/manifest.webmanifest' ||
    pathname === '/reset-pwa' ||
    pathname === '/reset-pwa.html'
  ) {
    return false
  }
  // Real files (icons, spell dicts, etc.) — never rewrite to HTML.
  if (/\.[a-zA-Z0-9]{1,12}$/.test(pathname)) return false
  return true
}

/**
 * The portal serves the same SPA as the shop but needs its own link
 * preview (see socialMeta.ts). Crawlers don't run JS, so rewrite the
 * served HTML for portal hosts; the public host is left untouched.
 */
async function withSocialMeta(url: URL, pathname: string, res: Response): Promise<Response> {
  const fresh = withPwaCacheHeaders(pathname, res)
  if (!isPortalHostname(url.hostname)) return fresh
  if (!(fresh.headers.get('Content-Type') ?? '').includes('text/html')) return fresh
  const html = await fresh.text()
  const rewritten = portalizeSocialHtml(html, url.origin)
  if (rewritten === html) return new Response(html, fresh)
  const headers = new Headers(fresh.headers)
  headers.delete('Content-Length')
  headers.delete('ETag')
  return new Response(rewritten, {
    status: fresh.status,
    statusText: fresh.statusText,
    headers,
  })
}

/** Keep HTML + SW fresh so installed iOS PWAs pick up new hashed bundles. */
function withPwaCacheHeaders(pathname: string, res: Response): Response {
  const noStore =
    pathname === '/' ||
    pathname === '/index.html' ||
    pathname.endsWith('.html') ||
    pathname === '/sw.js' ||
    pathname === '/manifest.webmanifest'
  if (!noStore) return res
  const headers = new Headers(res.headers)
  headers.set('Cache-Control', 'no-cache, no-store, must-revalidate')
  headers.set('Pragma', 'no-cache')
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}
