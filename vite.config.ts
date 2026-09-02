import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

export default defineConfig(async ({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const key of [
    'PRINTX_ADMIN_EMAIL',
    'PRINTX_ADMIN_PASSWORD',
    'PRINTX_SESSION_SECRET',
    'DATABASE_URL',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'PRINTX_DATA_DIR',
    'RESEND_API_KEY',
    'PRINTX_NOTIFY_EMAIL',
    'PRINTX_MAIL_FROM',
  ] as const) {
    if (env[key]) process.env[key] = env[key]
  }

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
