import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Connect, Plugin } from 'vite'
import { handleApi } from './router.ts'

const apiMiddleware: Connect.NextHandleFunction = async (req, res, next) => {
  const url = req.url?.split('?')[0] ?? ''
  const method = req.method ?? 'GET'
  if (!url.startsWith('/api/')) return next()

  try {
    const handled = await handleApi(req as IncomingMessage, res as ServerResponse, url, method)
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
}

export function printxApiPlugin(): Plugin {
  return {
    name: 'printx-api',
    configureServer(server) {
      server.middlewares.use(apiMiddleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use(apiMiddleware)
    },
  }
}
