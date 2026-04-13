import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
})
