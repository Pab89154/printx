import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

export default defineConfig(async ({ mode, command }) => {
  // Load full .env into process.env for the API plugin (Stripe, Resend, etc.).
  // A fixed allow-list previously omitted STRIPE_* and broke portal refunds locally.
  const env = loadEnv(mode, process.cwd(), '')
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value !== '' && process.env[key] === undefined) {
      process.env[key] = value
    }
  }

  const plugins: Plugin[] = [react(), tailwindcss()]

  // API plugin only needed for local dev — avoids loading native SQLite during production build
  if (command === 'serve') {
    const { printxApiPlugin } = await import('./server/plugin.ts')
    plugins.push(printxApiPlugin())
  }

  return {
    plugins,
    build: {
      // Shop STL viewer pulls in three.js; keep warning threshold above that chunk.
      chunkSizeWarningLimit: 1200,
    },
    server: {
      port: 5221,
      strictPort: true,
      host: '127.0.0.1',
      open: true,
    },
  }
})
