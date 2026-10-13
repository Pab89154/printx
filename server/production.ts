import http from 'node:http'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { usingPostgres } from './dbClient.ts'
import { ensureDbReady } from './db.ts'
import { handleApi, startArrivedOrderFlusher, startMailScheduleFlusher } from './router.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Load local .env without overriding Render/dashboard env vars. */
function loadLocalEnv() {
  const envPath = path.join(__dirname, '..', '.env')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq <= 0) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadLocalEnv()

const DIST = path.join(__dirname, '..', 'dist')
const PORT = Number(process.env.PORT) || 5221
const HOST = '0.0.0.0'

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
}

function streamFile(filePath: string, res: ServerResponse, contentType: string) {
  const stream = fs.createReadStream(filePath)
  res.statusCode = 200
  res.setHeader('Content-Type', contentType)
  stream.on('error', () => {
    if (!res.headersSent) {
      res.statusCode = 500
      res.end('Error')
    } else {
      res.destroy()
    }
  })
  stream.pipe(res)
}

async function serveStatic(urlPath: string, res: ServerResponse) {
  const safePath = urlPath.split('?')[0] ?? '/'
  let filePath = path.join(DIST, safePath === '/' ? 'index.html' : safePath)

  if (!filePath.startsWith(DIST)) {
    res.statusCode = 403
    res.end('Forbidden')
    return
  }

  try {
    let stat = await fsPromises.stat(filePath)
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html')
      stat = await fsPromises.stat(filePath)
    }
    const ext = path.extname(filePath)
    res.setHeader('Content-Length', String(stat.size))
    // Avoid buffering whole JS/CSS bundles in RAM on the free Render instance.
    streamFile(filePath, res, MIME[ext] ?? 'application/octet-stream')
  } catch {
    try {
      const indexPath = path.join(DIST, 'index.html')
      const stat = await fsPromises.stat(indexPath)
      res.setHeader('Content-Length', String(stat.size))
      streamFile(indexPath, res, 'text/html; charset=utf-8')
    } catch {
      res.statusCode = 404
      res.end('Not found')
    }
  }
}

const server = http.createServer(async (req, res) => {
  const url = req.url?.split('?')[0] ?? '/'
  const method = req.method ?? 'GET'

  // Lightweight wake probe — no DB. Used by the static-site cold-start shell.
  if (url === '/api/health' && method === 'GET') {
    const { objectStorageHealth } = await import('./objectStorage.ts')
    const objectStorage = objectStorageHealth()
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Cache-Control', 'no-store')
    res.end(
      JSON.stringify({
        ok: true,
        objectStorage,
        // Hint when Storage is required but the service role key is missing on Render.
        warning: !objectStorage.configured && objectStorage.required
          ? 'Storage needs SUPABASE_SERVICE_ROLE_KEY plus SUPABASE_URL (or a Supabase DATABASE_URL to derive the project URL). Check objectStorage.envPresent.'
          : undefined,
      }),
    )
    return
  }

  if (url.startsWith('/api/')) {
    try {
      const handled = await handleApi(req as IncomingMessage, res, url, method)
      if (!handled) {
        res.statusCode = 404
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify({ error: 'Not found' }))
      }
    } catch (err) {
      console.error('[printx-api]', err)
      res.statusCode = 500
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify({ error: 'Internal server error' }))
    }
    return
  }

  await serveStatic(url, res)
})

if (!fs.existsSync(DIST)) {
  console.error(`Missing build output at ${DIST}. Run "npm run build" first.`)
  process.exit(1)
}

async function main() {
  if (!usingPostgres()) {
    console.warn(
      '[printx] DATABASE_URL is not set — using SQLite (ephemeral on Render). ' +
        'Add the Supabase Session pooler URI for persistent admin data.',
    )
  }

  await ensureDbReady()
  const { ensureModelBucket, logObjectStorageStatus } = await import('./objectStorage.ts')
  logObjectStorageStatus()
  await ensureModelBucket()
  startMailScheduleFlusher()
  startArrivedOrderFlusher()
  // In-memory quote queue dies on deploy — pick up designs left mid-quote.
  void import('./catalogApi.ts').then(({ resumeInterruptedDesignQuotes }) =>
    resumeInterruptedDesignQuotes(),
  )

  const shutdown = () => {
    void import('./db.ts').then(({ closeDb }) => closeDb()).finally(() => process.exit(0))
  }
  process.once('SIGTERM', shutdown)
  process.once('SIGINT', shutdown)

  server.listen(PORT, HOST, () => {
    console.log(`PrintX running at http://${HOST}:${PORT}`)
  })
}

main().catch((err) => {
  console.error('[printx] Failed to start:', err)
  process.exit(1)
})
