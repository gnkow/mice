import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

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
      // Do not follow upstream redirects (OIDC 302 to Keycloak must reach the browser).
      '/api': {
        target: process.env.AUTH_PROXY_TARGET ?? 'http://localhost:8080',
        changeOrigin: true,
        followRedirects: false,
      },
      '/auth': {
        target: process.env.AUTH_PROXY_TARGET ?? 'http://localhost:8080',
        changeOrigin: true,
        followRedirects: false,
        // guacamole-lite WebSocket for Sessions desktop
        ws: true,
      },
    },
  },
})

