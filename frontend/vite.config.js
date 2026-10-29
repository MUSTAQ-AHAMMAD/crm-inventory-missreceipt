import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load .env (all vars, not just VITE_*) so the dev server port/host and the
  // backend it proxies /api to can be configured per machine without edits here.
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    server: {
      port: Number(env.FRONTEND_PORT) || 3000,
      host: env.FRONTEND_HOST || '0.0.0.0',
      proxy: {
        '/api': {
          target: env.VITE_PROXY_TARGET || 'http://192.168.30.58:4000',
          changeOrigin: true,
        },
      },
    },
  }
})
