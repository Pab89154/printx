/**
 * Adapt Cloudflare Workers fetch Request/Response to Node IncomingMessage/ServerResponse
 * so existing handleApi routers keep working under nodejs_compat.
 */
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleApi } from './router.ts'
import { ensureDbReady } from './db.ts'
import { usingPostgres, runWithDbScope } from './dbClient.ts'
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
  MAGIC_HOUR_API_KEY?: string
  MAGIC_HOUR_IMAGE_MODEL?: string
  MAGIC_HOUR_IMAGE_RESOLUTION?: string
  MANUS_API_KEY?: string
  MANUS_AGENT_PROFILE?: string
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
    ['MAGIC_HOUR_API_KEY', 'MAGIC_HOUR_API_KEY'],
    ['MAGIC_HOUR_IMAGE_MODEL', 'MAGIC_HOUR_IMAGE_MODEL'],
    ['MAGIC_HOUR_IMAGE_RESOLUTION', 'MAGIC_HOUR_IMAGE_RESOLUTION'],
    ['MANUS_API_KEY', 'MANUS_API_KEY'],
    ['MANUS_AGENT_PROFILE', 'MANUS_AGENT_PROFILE'],
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
      await withTimeout(ensureDbReady(), 25_000, 'Database bootstrap')
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

  // Stream (never buffer) from GitHub — a 90 MB model must not be held in
  // Worker memory. STLs live in BOTH repo folders after the migration
  // (legacy shop models in `models/`, everything uploaded since in
  // `uploads/`, oversized ones on the big-files release), and the
  // hard-coded GITHUB_MODEL_FILES set can drift out of sync with the DB,
  // so try every folder for every file instead of gating on the set —
  // the set only picks which folder is tried first. Within a folder,
  // raw.githubusercontent.com goes first: it is GitHub's own CDN, sends
  // Content-Length, and honours Range. rawcdn.githack.com (the old first
  // choice for `models/`) ignores Range, answers chunked with no
  // Content-Length, and stalls/throttles often enough that the shop's
  // 3D preview sat on “Loading 3D…” forever on a cold edge cache while
  // photos (which already used raw.githubusercontent.com first) loaded.
  let upstream: Response | null = null
  {
    const repoName = (process.env.PRINTX_GITHUB_REPO || 'Pab89154/printx').trim()
    const refName = (process.env.PRINTX_GITHUB_REF || 'main').trim() || 'main'
    const { bigFilesReleaseDownloadUrl } = await import('./githubStorage.ts')
    const encoded = encodeURIComponent(file)
    const folders = GITHUB_MODEL_FILES.has(file) ? ['models', 'uploads'] : ['uploads', 'models']
    const sources: string[] = []
    for (const folder of folders) {
      sources.push(`https://raw.githubusercontent.com/${repoName}/${refName}/${folder}/${encoded}`)
      sources.push(`https://rawcdn.githack.com/${repoName}/${refName}/${folder}/${encoded}`)
    }
    sources.push(bigFilesReleaseDownloadUrl(file))
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
    if (!upstream) {
      const { signedStoredFileUrl } = await import('./objectStorage.ts')
      const signed = await signedStoredFileUrl(file)
      if (signed) {
        const res = await fetch(signed, range ? { headers: { Range: range } } : undefined)
        if (res.ok || res.status === 206) upstream = res
      }
    }
  }
  if (!upstream) {
    // Chunked big files (uploaded as `<file>.chunk-000`, `-001`, … assets):
    // stream the pieces back-to-back so the browser gets one whole model.
    try {
      const { listBigFilesAssets, bigFilesChunksFor, bigFilesReleaseDownloadUrl } =
        await import('./githubStorage.ts')
      const chunks = bigFilesChunksFor(file, await listBigFilesAssets())
      if (chunks.length) {
        const total = chunks.reduce((sum, c) => sum + c.size, 0)
        let index = 0
        // Fetch each piece whole (8 MB) and hand it over in one go. A
        // long-lived reader over GitHub's redirect kept ending pieces
        // early inside the Worker; whole-piece fetches can also be
        // size-checked and retried, so a short read never corrupts
        // the glued model.
        const stream = new ReadableStream<Uint8Array>({
          async pull(controller) {
            if (index >= chunks.length) {
              controller.close()
              return
            }
            const chunk = chunks[index]!
            index++
            let bytes: Uint8Array | null = null
            for (let attempt = 0; attempt < 3 && !bytes; attempt++) {
              try {
                const res = await fetch(bigFilesReleaseDownloadUrl(chunk.name))
                if (!res.ok) throw new Error('piece failed')
                const buf = new Uint8Array(await res.arrayBuffer())
                if (chunk.size && buf.length !== chunk.size) throw new Error('short piece')
                bytes = buf
              } catch {
                if (attempt === 2) throw new Error('Model piece failed to load.')
              }
            }
            controller.enqueue(bytes!)
          },
        })
        const chunkHeaders = new Headers()
        chunkHeaders.set('Content-Type', 'model/stl')
        chunkHeaders.set('Access-Control-Allow-Origin', '*')
        chunkHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin')
        chunkHeaders.set('Cache-Control', 'public, max-age=31536000, immutable')
        if (total) chunkHeaders.set('Content-Length', String(total))
        return new Response(stream, { status: 200, headers: chunkHeaders })
      }
    } catch {
      /* fall through to the 404 */
    }
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
  const acceptRanges = upstream.headers.get('accept-ranges')
  if (acceptRanges) headers.set('Accept-Ranges', acceptRanges)
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

const FILE_CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  stl: 'model/stl',
  gcode: 'text/plain; charset=utf-8',
  '3mf': 'model/3mf',
}

/**
 * Same-origin CDN for uploaded files (photos, images). Origin is the
 * GitHub repo `uploads/` folder; Supabase Storage is only a fallback for
 * stragglers that never moved. Edge-cached for a year so repeat views
 * cost nothing — this replaces per-view signed Supabase URLs whose
 * egress billing blew past quota.
 */
async function serveFileCdn(
  request: Request,
  url: URL,
  waitUntil?: (p: Promise<unknown>) => void,
): Promise<Response> {
  const file = decodeURIComponent(url.pathname.slice('/cdn/files/'.length))
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(file) || file.includes('..')) {
    return Response.json({ error: 'File not found' }, { status: 404 })
  }
  const ext = file.split('.').pop()?.toLowerCase() || ''
  if (!FILE_CONTENT_TYPES[ext]) {
    return Response.json({ error: 'File not found' }, { status: 404 })
  }

  type CacheStorageWithDefault = CacheStorage & { default?: Cache }
  const cache = (globalThis as { caches?: CacheStorageWithDefault }).caches?.default
  const cacheKey = new Request(`${url.origin}/cdn/files/${encodeURIComponent(file)}`)
  const range = request.headers.get('range')
  if (cache && !range) {
    const hit = await cache.match(cacheKey)
    if (hit) return hit
  }

  const repo = (process.env.PRINTX_GITHUB_REPO || 'Pab89154/printx').trim()
  const ref = (process.env.PRINTX_GITHUB_REF || 'main').trim() || 'main'
  const encoded = encodeURIComponent(file)
  let upstream: Response | null = null
  for (const source of [
    `https://raw.githubusercontent.com/${repo}/${ref}/uploads/${encoded}`,
    `https://rawcdn.githack.com/${repo}/${ref}/uploads/${encoded}`,
  ]) {
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
  if (!upstream) {
    // Oversized models live on the "printx-files" release, not in the repo.
    const { bigFilesReleaseDownloadUrl } = await import('./githubStorage.ts')
    try {
      const res = await fetch(
        bigFilesReleaseDownloadUrl(file),
        range ? { headers: { Range: range } } : undefined,
      )
      if (res.ok || res.status === 206) upstream = res
    } catch {
      /* not a big-file asset */
    }
  }
  if (!upstream) {
    const { signedStoredFileUrl } = await import('./objectStorage.ts')
    const signed = await signedStoredFileUrl(file)
    if (signed) {
      const res = await fetch(signed, range ? { headers: { Range: range } } : undefined)
      if (res.ok || res.status === 206) upstream = res
    }
  }
  if (!upstream) {
    return Response.json({ error: 'File not found' }, { status: 404 })
  }

  const headers = new Headers()
  headers.set('Content-Type', FILE_CONTENT_TYPES[ext])
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

/**
 * Streaming upload for oversized models (40–100 MB). The browser PUTs the
 * raw file here and the Worker pipes it straight into a GitHub release
 * asset — the bytes are never buffered, so Worker memory stays flat no
 * matter the size (buffering a 90 MB body is what used to kill uploads).
 * Auth mirrors the admin API (session cookie + Designs permission).
 */
/** Shared auth for the big-model upload endpoints (admin + Designs permission). */
async function authorizeBigUpload(request: Request): Promise<Response | null> {
  await ensureBootstrapped()
  const { getSessionUser, parseCookies, adminCan } = await import('./auth.ts')
  const cookies = parseCookies(request.headers.get('cookie') || undefined)
  const admin = await getSessionUser(cookies['printx_session'] ?? null)
  if (!admin || admin.role !== 'admin') {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (!adminCan(admin, 'products')) {
    return Response.json({ error: 'Forbidden' }, { status: 403 })
  }
  return null
}

const BIG_UPLOAD_NAME_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.stl$/i
const CHUNK_MAX_BYTES = 12 * 1024 * 1024

/**
 * One slice of a chunked big-model upload. A single streamed 90 MB request
 * kept dying in browsers (connection resets mid-upload read as a crashed
 * page), so the client sends 8 MB pieces instead — each is a small, quick,
 * retryable request that this handler stores as a release asset named
 * `<file>.chunk-NNN`. `/cdn/models` glues the pieces back together.
 */
async function handleChunkUpload(request: Request, pathname: string): Promise<Response> {
  const rest = decodeURIComponent(pathname.slice('/upload/chunk/'.length))
  const slash = rest.lastIndexOf('/')
  const fileName = slash > 0 ? rest.slice(0, slash) : ''
  const index = Number(slash > 0 ? rest.slice(slash + 1) : '')
  if (!BIG_UPLOAD_NAME_RE.test(fileName) || !Number.isInteger(index) || index < 0 || index > 999) {
    return Response.json({ error: 'Invalid upload piece.' }, { status: 400 })
  }
  const denied = await authorizeBigUpload(request)
  if (denied) return denied
  const body = Buffer.from(await request.arrayBuffer())
  if (!body.length) return Response.json({ error: 'That upload piece was empty.' }, { status: 400 })
  if (body.length > CHUNK_MAX_BYTES) {
    return Response.json({ error: 'That upload piece is too big.' }, { status: 413 })
  }
  const { uploadBigFilesAsset } = await import('./githubStorage.ts')
  const chunkName = `${fileName}.chunk-${String(index).padStart(3, '0')}`
  await uploadBigFilesAsset(chunkName, body)
  return Response.json({ ok: true, chunk: chunkName })
}

/** Verify every chunk arrived, then hand back the usual upload result. */
async function handleChunkComplete(request: Request, pathname: string): Promise<Response> {
  const fileName = decodeURIComponent(
    pathname.slice('/upload/direct/'.length).replace(/\/complete$/, ''),
  )
  if (!BIG_UPLOAD_NAME_RE.test(fileName)) {
    return Response.json({ error: 'Invalid file name.' }, { status: 400 })
  }
  const denied = await authorizeBigUpload(request)
  if (denied) return denied
  const body = (await request.json().catch(() => ({}))) as { chunks?: number }
  const expected = Number(body.chunks) || 0
  if (expected < 1 || expected > 1000) {
    return Response.json({ error: 'Missing upload piece count.' }, { status: 400 })
  }
  const { listBigFilesAssets, bigFilesChunksFor } = await import('./githubStorage.ts')
  const present = bigFilesChunksFor(fileName, await listBigFilesAssets())
  if (present.length < expected) {
    return Response.json(
      { error: `Only ${present.length} of ${expected} pieces arrived — please try the upload again.` },
      { status: 400 },
    )
  }
  return Response.json({ ok: true, stlPath: fileName, hasStl: true, modelExt: '.stl' })
}

async function handleDirectUpload(request: Request, pathname: string): Promise<Response> {
  const fileName = decodeURIComponent(pathname.slice('/upload/direct/'.length))
  if (!BIG_UPLOAD_NAME_RE.test(fileName)) {
    return Response.json({ error: 'Invalid file name.' }, { status: 400 })
  }
  if (!request.body) {
    return Response.json({ error: 'File is required.' }, { status: 400 })
  }
  const denied = await authorizeBigUpload(request)
  if (denied) return denied

  const repo = (process.env.PRINTX_GITHUB_REPO || 'Pab89154/printx').trim() || 'Pab89154/printx'
  const token = (process.env.PRINTX_GITHUB_TOKEN || '').trim()
  if (!token) {
    return Response.json({ error: 'Big-file storage is not configured.' }, { status: 500 })
  }
  const ghHeaders: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'printx-worker',
    'Content-Type': 'application/json',
  }
  const { BIG_FILES_RELEASE_TAG } = await import('./githubStorage.ts')

  // Find (or create) the big-files release.
  let releaseId: number | null = null
  const relRes = await fetch(
    `https://api.github.com/repos/${repo}/releases/tags/${BIG_FILES_RELEASE_TAG}`,
    { headers: ghHeaders },
  )
  if (relRes.ok) {
    releaseId = Number(((await relRes.json()) as { id?: number }).id) || null
  } else if (relRes.status === 404) {
    const createRes = await fetch(`https://api.github.com/repos/${repo}/releases`, {
      method: 'POST',
      headers: ghHeaders,
      body: JSON.stringify({
        tag_name: BIG_FILES_RELEASE_TAG,
        name: 'PrintX big files',
        body: 'Oversized model files uploaded from the PrintX admin portal.',
      }),
    })
    if (createRes.ok) {
      releaseId = Number(((await createRes.json()) as { id?: number }).id) || null
    }
  }
  if (!releaseId) {
    return Response.json({ error: 'Could not prepare big-file storage.' }, { status: 502 })
  }

  // Stream the browser's bytes straight to GitHub — never buffered here.
  const uploadRes = await fetch(
    `https://uploads.github.com/repos/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(fileName)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'printx-worker',
        'Content-Type': 'application/octet-stream',
        ...(request.headers.get('content-length')
          ? { 'Content-Length': request.headers.get('content-length')! }
          : {}),
      },
      body: request.body,
      // Workers require this to send a streamed request body.
      ...({ duplex: 'half' } as Record<string, string>),
    },
  )
  if (!uploadRes.ok) {
    let detail = `${uploadRes.status}`
    try {
      const data = (await uploadRes.json()) as { message?: string }
      if (data.message) detail = data.message
    } catch {
      /* keep status */
    }
    return Response.json({ error: `Big-file upload failed: ${detail}` }, { status: 502 })
  }
  return Response.json({ ok: true, stlPath: fileName, hasStl: true, modelExt: '.stl' })
}

export async function handleWorkerFetch(
  request: Request,
  env: WorkerEnv,
  ctx?: { waitUntil: (p: Promise<unknown>) => void },
): Promise<Response> {
  applyWorkerEnv(env)
  const url = new URL(request.url)
  const pathname = url.pathname

  if (pathname.startsWith('/upload/chunk/') && request.method === 'PUT') {
    try {
      return await handleChunkUpload(request, pathname)
    } catch (err) {
      console.error('[chunk-upload]', err)
      return Response.json(
        { error: err instanceof Error ? err.message : 'Upload piece failed' },
        { status: 500 },
      )
    }
  }

  if (
    pathname.startsWith('/upload/direct/') &&
    pathname.endsWith('/complete') &&
    request.method === 'POST'
  ) {
    try {
      return await handleChunkComplete(request, pathname)
    } catch (err) {
      console.error('[chunk-complete]', err)
      return Response.json(
        { error: err instanceof Error ? err.message : 'Could not finish the upload' },
        { status: 500 },
      )
    }
  }

  if (pathname.startsWith('/upload/direct/') && request.method === 'PUT') {
    try {
      return await handleDirectUpload(request, pathname)
    } catch (err) {
      console.error('[direct-upload]', err)
      return Response.json(
        { error: err instanceof Error ? err.message : 'Big-file upload failed' },
        { status: 500 },
      )
    }
  }

  if (pathname.startsWith('/cdn/files/') && request.method === 'GET') {
    try {
      return await serveFileCdn(request, url, ctx?.waitUntil?.bind(ctx))
    } catch (err) {
      console.error('[cdn-files]', err)
      return Response.json({ error: 'File failed to load' }, { status: 502 })
    }
  }

  if (pathname.startsWith('/cdn/models/') && request.method === 'GET') {
    try {
      return await serveModelCdn(request, url, ctx?.waitUntil?.bind(ctx))
    } catch (err) {
      console.error('[cdn-models]', err)
      return Response.json({ error: 'Model failed to load' }, { status: 502 })
    }
  }

  if (pathname === '/api/health' && request.method === 'GET') {
    return Response.json({
      ok: true,
      runtime: 'cloudflare-worker',
      magicHourConfigured: Boolean(env.MAGIC_HOUR_API_KEY?.trim()),
      manusConfigured: Boolean(env.MANUS_API_KEY?.trim()),
      imageProvider: env.MANUS_API_KEY?.trim()
        ? 'manus'
        : env.MAGIC_HOUR_API_KEY?.trim()
          ? 'magic-hour'
          : 'none',
      githubStorageConfigured: Boolean(env.PRINTX_GITHUB_TOKEN?.trim()),
    })
  }

  // Unauthenticated session probe — skip DB bootstrap so the portal never sits on
  // "Checking authentication…" waiting for cold migrations.
  if (pathname === '/api/admin/me' && request.method === 'GET') {
    const cookie = request.headers.get('cookie') || ''
    if (!/(?:^|;\s*)printx_session=/.test(cookie)) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  // Public photos never need the database — bounce straight to the file
  // CDN before the bootstrap gate. A page with 40 thumbnails used to mean
  // 40 DB bootstraps; that storm starved auth/orders/uploads.
  if (pathname.startsWith('/api/public/uploads/') && request.method === 'GET') {
    const file = decodeURIComponent(pathname.slice('/api/public/uploads/'.length))
    if (/^[\w-]+\.(jpe?g|png|webp|gif)$/i.test(file)) {
      return new Response(null, {
        status: 302,
        headers: {
          Location: `/cdn/files/${encodeURIComponent(file)}`,
          'Cache-Control': 'public, max-age=300',
        },
      })
    }
    return Response.json({ error: 'Invalid file name' }, { status: 400 })
  }

  if (pathname.startsWith('/api/')) {
    // Oversized uploads used to flood Worker memory (the whole body is
    // buffered before parsing) and kill the connection mid-upload — the
    // browser saw a dead/crashed page instead of an error. Refuse them
    // up front from the Content-Length header, before reading a byte.
    const contentLength = Number(request.headers.get('content-length') || 0)
    if (request.method === 'POST' && contentLength > 56 * 1024 * 1024) {
      return Response.json(
        {
          error: `That file is too big (about ${Math.round(contentLength / 1048576)} MB). The biggest model we can take is 50 MB — in your design app, look for “decimate” or “reduce mesh” to shrink it, then try again.`,
        },
        { status: 413 },
      )
    }
    // Edge-cache the two hot public GETs for 30s: a shop-page burst then
    // costs ONE database visit instead of one per visitor per instance.
    type CacheStorageWithDefault = CacheStorage & { default?: Cache }
    const edgeCache = (globalThis as { caches?: CacheStorageWithDefault }).caches?.default
    const edgeCacheable =
      request.method === 'GET' &&
      (pathname === '/api/public/catalog' || pathname === '/api/public/bootstrap')
    const edgeKey = new Request(`${url.origin}${pathname}`)
    if (edgeCacheable && edgeCache) {
      const hit = await edgeCache.match(edgeKey).catch(() => undefined)
      if (hit) {
        // Never let browsers pin the catalog for hours: photos/prices must
        // show up within seconds of an upload, not at some 4h expiry.
        const headers = new Headers(hit.headers)
        headers.set('Cache-Control', 'public, max-age=30')
        return new Response(hit.body, { status: hit.status, headers })
      }
    }

    try {
      await ensureBootstrapped()
      const ab = await request.arrayBuffer()
      const body = Buffer.from(ab)
      const req = buildIncomingMessage(request, body)
      const { res, done } = buildServerResponse()

      // One DB connection for this whole request (see runWithDbScope) —
      // ended when the handler settles, never shared across requests.
      const handlerPromise = runWithDbScope(() =>
        handleApi(req, res, pathname, request.method),
      ).then((handled) => {
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
      const timeoutMs = isUpload ? 35_000 : 30_000
      // Always settle — never leave the portal fetch hanging on a stuck stream.
      const response = await Promise.race([
        done,
        handlerPromise.then(() => done),
        new Promise<Response>((resolve) =>
          setTimeout(
            () => resolve(Response.json({ error: 'Request timed out' }, { status: 504 })),
            timeoutMs,
          ),
        ),
      ])
      if (edgeCacheable && edgeCache && response.status === 200) {
        const headers = new Headers(response.headers)
        headers.set('Cache-Control', 'public, max-age=30')
        const stored = new Response(response.clone().body, {
          status: response.status,
          headers,
        })
        const put = edgeCache.put(edgeKey, stored).catch(() => undefined)
        if (ctx?.waitUntil) ctx.waitUntil(put)
        else void put
        // The browser gets the same short freshness as the edge copy.
        return new Response(response.body, { status: response.status, headers })
      }
      return response
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
