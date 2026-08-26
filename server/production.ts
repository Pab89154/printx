import http from 'node:http'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { handleApi } from './router.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, '..', 'dist')
const PORT = Number(process.env.PORT) || 5675
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
    const body = await fsPromises.readFile(filePath)
    res.statusCode = 200
    res.setHeader('Content-Type', MIME[ext] ?? 'application/octet-stream')
    res.end(body)
  } catch {
    try {
      const fallback = await fsPromises.readFile(path.join(DIST, 'index.html'))
      res.statusCode = 200
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(fallback)
    } catch {
      res.statusCode = 404
      res.end('Not found')
    }
  }
}

const server = http.createServer(async (req, res) => {
  const url = req.url?.split('?')[0] ?? '/'
  const method = req.method ?? 'GET'

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

server.listen(PORT, HOST, () => {
  console.log(`PrintX running at http://${HOST}:${PORT}`)
})
