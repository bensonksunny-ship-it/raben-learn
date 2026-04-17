import { defineConfig, loadEnv } from 'vite'
import type { Plugin, ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'

/** Ensures Firebase ID tokens reach Cloud Functions (some http-proxy setups drop `Authorization`). */
function gcfProxyOptions(gcfTarget: string): ProxyOptions {
  return {
    target: gcfTarget,
    changeOrigin: true,
    secure: true,
    rewrite: (path) => path.replace(/^\/__gcf__/, '') || '/',
    configure: (proxy) => {
      proxy.on('proxyReq', (proxyReq, req) => {
        const raw = req.headers.authorization
        if (typeof raw === 'string' && raw.length > 0) {
          proxyReq.setHeader('Authorization', raw)
        } else if (Array.isArray(raw) && raw[0]) {
          proxyReq.setHeader('Authorization', raw[0])
        }
      })
    },
  }
}

/** Dev-only: embedded / aggressive caches (e.g. some IDE browsers) may keep stale JS; discourage caching HTML. */
function devNoCacheHtmlPlugin(): Plugin {
  return {
    name: 'dev-no-cache-html',
    apply: 'serve',
    transformIndexHtml(html) {
      if (html.includes('http-equiv="Cache-Control"')) return html
      return html.replace(
        '<head>',
        '<head>\n    <meta http-equiv="Cache-Control" content="no-cache, no-store, must-revalidate" />',
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const projectId = env.VITE_FIREBASE_PROJECT_ID || 'raben-learn'
  const region = env.VITE_FIREBASE_FUNCTIONS_REGION || 'us-central1'
  const gcfTarget = `https://${region}-${projectId}.cloudfunctions.net`

  return {
    plugins: [react(), devNoCacheHtmlPlugin()],
    /**
     * Dev-only: proxy callable HTTPS to Cloud Functions so the browser talks same-origin
     * (e.g. http://localhost:5174/__gcf__/...) and avoids CORS preflight failures to *.cloudfunctions.net.
     * Production builds call https://REGION-PROJECT.cloudfunctions.net directly (see adminGcfCallables.ts).
     */
    server: {
      /** Embedded browsers (e.g. Cursor preview) may cache dev chunks; discourage caching HTML/JS. */
      headers: {
        'Cache-Control': 'no-store',
      },
      proxy: {
        '/__gcf__': gcfProxyOptions(gcfTarget),
      },
    },
    /** Same proxy for `vite preview` (e.g. port 4173). */
    preview: {
      proxy: {
        '/__gcf__': gcfProxyOptions(gcfTarget),
      },
    },
    /**
     * When dependency optimization is invalidated (lockfile change, `npm install`, server restart),
     * old `?v=` URLs can 504 with "Outdated Optimize Dep" until the cache matches. Pinning core
     * entry points reduces churn; if you still see 504 loops: `npm run dev:clean` or `vite --force`.
     */
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-dom/client',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'react-router-dom',
      ],
    },
  }
})
