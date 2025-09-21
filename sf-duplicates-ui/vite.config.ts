import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load .env files and allow using AUTH_DOMAIN, SF_INSTANCE or VITE_SF_INSTANCE
  const env = loadEnv(mode, process.cwd(), '')
  const sf = env.SF_INSTANCE || env.AUTH_DOMAIN || env.VITE_SF_INSTANCE || ''
  const proxyTarget = sf.replace(/\/+$/, '')

  const cfg: any = {
    plugins: [react()],
  }

  if (proxyTarget) {
    // Proxy only the Apex REST path to the Salesforce instance to avoid CORS in dev
    cfg.server = {
      proxy: {
        '/services/apexrest': {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
          // keep path as-is; http-proxy will append the original path
        },
        // Also proxy the token endpoint so the browser can perform the OAuth
        // authorization code exchange in dev without CORS problems.
        '/services/oauth2/token': {
          target: proxyTarget,
          changeOrigin: true,
          secure: false,
          // keep path as-is
        },
      },
    }
  }

  return cfg
})
