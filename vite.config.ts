import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { printxApiPlugin } from './server/plugin.ts'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  process.env.PRINTX_ADMIN_PASSWORD = env.PRINTX_ADMIN_PASSWORD
  process.env.PRINTX_SESSION_SECRET = env.PRINTX_SESSION_SECRET

  return {
    plugins: [react(), tailwindcss(), printxApiPlugin()],
    server: {
      port: 5675,
      open: true,
    },
  }
})
