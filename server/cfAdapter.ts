/**
 * Adapt Cloudflare Workers fetch Request/Response to Node IncomingMessage/ServerResponse
 * so existing handleApi routers keep working under nodejs_compat.
 */
import { Readable, Writable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleApi } from './router.ts'
import { ensureDbReady } from './db.ts'
import { usingPostgres } from './dbClient.ts'

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
  VAPID_PUBLIC_KEY?: string
  VAPID_PRIVATE_KEY?: string
  VAPID_SUBJECT?: string
  /** Pages asset binding when deployed as Pages `_worker`. */
  ASSETS?: { fetch: (req: Request) => Promise<Response> }
  HYPERDRIVE?: { connectionString: string }
}

let bootstrapped = false

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
    ['VAPID_PUBLIC_KEY', 'VAPID_PUBLIC_KEY'],
    ['VAPID_PRIVATE_KEY', 'VAPID_PRIVATE_KEY'],
    ['VAPID_SUBJECT', 'VAPID_SUBJECT'],
  ]
  for (const [from, to] of map) {
    const v = env[from]
    if (typeof v === 'string' && v && process.env[to] === undefined) {
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

async function ensureBootstrapped() {
  if (bootstrapped) return
  if (!usingPostgres()) {
    throw new Error('DATABASE_URL (or Hyperdrive) is required on Cloudflare Workers.')
  }
  await ensureDbReady()
  const { ensureModelBucket, logObjectStorageStatus } = await import('./objectStorage.ts')
  logObjectStorageStatus()
  await ensureModelBucket()
  bootstrapped = true
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

function buildServerResponse(): {
  res: ServerResponse
  done: Promise<Response>
} {
  let statusCode = 200
  const headerMap = new Map<string, string | string[]>()
  const chunks: Buffer[] = []
  let resolveDone!: (r: Response) => void
  const done = new Promise<Response>((resolve) => {
    resolveDone = resolve
  })

  const writable = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
      cb()
    },
    final(cb) {
      const body = Buffer.concat(chunks)
      const headers = new Headers()
      for (const [k, v] of headerMap) {
        if (Array.isArray(v)) v.forEach((item) => headers.append(k, item))
        else headers.set(k, v)
      }
      resolveDone(new Response(body, { status: statusCode, headers }))
      cb()
    },
  }) as ServerResponse

  Object.defineProperty(writable, 'statusCode', {
    get: () => statusCode,
    set: (v: number) => {
      statusCode = v
    },
    configurable: true,
  })
  writable.setHeader = (name: string, value: number | string | readonly string[]) => {
    headerMap.set(String(name).toLowerCase(), value as string | string[])
    return writable
  }
  writable.getHeader = (name: string) => headerMap.get(String(name).toLowerCase())
  writable.removeHeader = (name: string) => {
    headerMap.delete(String(name).toLowerCase())
  }
  writable.writeHead = (code: number, headers?: Record<string, string | string[]>) => {
    statusCode = code
    if (headers) {
      for (const [k, v] of Object.entries(headers)) {
        headerMap.set(k.toLowerCase(), v)
      }
    }
    return writable
  }
  // Node often calls end() without going through Writable final if empty — patch end.
  const origEnd = writable.end.bind(writable)
  writable.end = ((...args: unknown[]) => {
    if (args.length && args[0] != null && typeof args[0] !== 'function') {
      const chunk = args[0] as string | Buffer
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    }
    queueMicrotask(() => {
      const body = Buffer.concat(chunks)
      const headers = new Headers()
      for (const [k, v] of headerMap) {
        if (Array.isArray(v)) v.forEach((item) => headers.append(k, item))
        else headers.set(k, v)
      }
      resolveDone(new Response(body.byteLength ? body : null, { status: statusCode, headers }))
    })
    return origEnd(...(args as []))
  }) as ServerResponse['end']

  return { res: writable, done }
}

export async function handleWorkerFetch(request: Request, env: WorkerEnv): Promise<Response> {
  applyWorkerEnv(env)
  const url = new URL(request.url)
  const pathname = url.pathname

  if (pathname === '/api/health' && request.method === 'GET') {
    return Response.json({ ok: true, runtime: 'cloudflare-worker' })
  }

  if (pathname.startsWith('/api/')) {
    try {
      await ensureBootstrapped()
      const ab = await request.arrayBuffer()
      const body = Buffer.from(ab)
      const req = buildIncomingMessage(request, body)
      const { res, done } = buildServerResponse()
      const handled = await handleApi(req, res, pathname, request.method)
      if (!handled) {
        return Response.json({ error: 'Not found' }, { status: 404 })
      }
      // If handler already ended the response, done resolves; otherwise wait briefly.
      return await Promise.race([
        done,
        new Promise<Response>((resolve) =>
          setTimeout(() => {
            if (!res.writableEnded) {
              resolve(Response.json({ error: 'No response' }, { status: 500 }))
            }
          }, 55_000),
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
    return env.ASSETS.fetch(request)
  }
  return new Response('Not found', { status: 404 })
}
