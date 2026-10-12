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
      // Browser → Vite → oxen-server (avoids CORS in local/Compose setups)
      '/api': {
        target: process.env.OXEN_PROXY_TARGET ?? 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})

