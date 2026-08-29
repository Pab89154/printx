import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

export default defineConfig(async ({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  process.env.PRINTX_ADMIN_PASSWORD = env.PRINTX_ADMIN_PASSWORD
  process.env.PRINTX_SESSION_SECRET = env.PRINTX_SESSION_SECRET

  const plugins: Plugin[] = [react(), tailwindcss()]

  // API plugin only needed for local dev — avoids loading native SQLite during production build
  if (command === 'serve') {
    const { printxApiPlugin } = await import('./server/plugin.ts')
    plugins.push(printxApiPlugin())
  }

  return {
    plugins,
    server: {
      port: 5675,
      strictPort: true,
      host: '127.0.0.1',
      open: true,
    },
  }
})
