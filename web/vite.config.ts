import type { IncomingMessage, ServerResponse } from 'node:http'
import react from '@vitejs/plugin-react'
import type { ProxyOptions } from 'vite'
import { defineConfig } from 'vite'

const authProxyTarget = process.env.AUTH_PROXY_TARGET ?? 'http://localhost:8080'

/**
 * When the auth BFF is still booting, Vite's default proxy error is an empty
 * response — full navigations to `/auth/login` look like a white page after
 * "Sign in". Reply with a recoverable HTML page instead.
 */
function authProxyErrorPage(
  _err: Error,
  _req: IncomingMessage,
  res: ServerResponse,
) {
  if (res.headersSent) return
  res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' })
  res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mice — auth unavailable</title>
  <style>
    body { font: 16px/1.45 system-ui, sans-serif; margin: 2.5rem auto; max-width: 36rem;
      padding: 0 1rem; color: #1b1f24; background: #f6f8fa; }
    a { color: #0969da; }
    code { font-size: 0.92em; }
  </style>
</head>
<body>
  <h1>Auth service is starting</h1>
  <p>Mice could not reach the auth BFF (<code>${authProxyTarget}</code>). This is common right after <code>make reset</code> or compose restart.</p>
  <p><a href="/login">Back to sign in</a> · <a href="/">Home</a></p>
  <p><button type="button" onclick="location.reload()">Retry</button></p>
</body>
</html>`)
}

function authProxy(): ProxyOptions {
  return {
    target: authProxyTarget,
    changeOrigin: true,
    // Do not follow upstream redirects (OIDC 302 to Keycloak must reach the browser).
    followRedirects: false,
    configure(proxy) {
      proxy.on('error', authProxyErrorPage)
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    // Compose publishes 5173 on the host; without clientPort the browser may
    // try the container-internal websocket and leave the tab spinner running.
    hmr: {
      clientPort: Number(process.env.WEB_PORT ?? 5173),
    },
    watch: {
      // Reliable file watching with Docker Desktop volume mounts
      usePolling: true,
      interval: 300,
    },
    proxy: {
      // Browser → Vite → auth BFF → oxen-server
      '/api': authProxy(),
      '/auth': {
        ...authProxy(),
        // guacamole-lite WebSocket for Sessions desktop
        ws: true,
      },
    },
  },
})

