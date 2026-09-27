import path from 'node:path'
import { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

/**
 * Serves api/plan-trip.js on `vite dev` and `vite preview`, so the app runs on
 * Node and Vite alone with no Vercel CLI. The handler is written against the
 * Web Request/Response API, which is what Vercel passes it in production, so
 * this only has to translate that to and from Node's req/res.
 */
function localApi() {
  const mount = async (server) => {
    const entry = pathToFileURL(path.join(server.config.root, 'api', 'plan-trip.js')).href
    const { default: handler } = await import(entry)

    server.middlewares.use(async (req, res, next) => {
      if (!req.url?.startsWith('/api/')) return next()

      // A closed connection is the browser hitting Cancel, which the handler
      // needs to see as an aborted request or generation keeps running.
      const abort = new AbortController()
      res.on('close', () => {
        if (!res.writableFinished) abort.abort()
      })

      try {
        const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req)
        const response = await handler(
          new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, {
            method: req.method,
            headers: req.headers,
            body,
            signal: abort.signal,
          }),
        )

        res.writeHead(response.status, Object.fromEntries(response.headers))
        if (!response.body) return res.end()
        Readable.fromWeb(response.body).pipe(res)
      } catch (err) {
        console.error('[api]', err)
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'The API could not handle that request.' }))
      }
    })
  }

  return { name: 'local-api', configureServer: mount, configurePreviewServer: mount }
}

export default defineConfig({
  plugins: [react(), localApi()],
})
