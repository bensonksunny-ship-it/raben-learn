import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from './context/AuthContext'

// A lazy-loaded chunk (LessonNotesEditor, ExamRunner, …) is fetched by the
// exact content-hashed filename baked into whatever bundle this tab already
// has in memory. Once a newer deploy replaces `dist/assets/*` with fresh
// hashes, that old filename no longer exists on the server — the SPA
// catch-all rewrite then serves back `index.html` for it, which fails as
// "not a JS module". Vite fires `vite:preloadError` for exactly this case;
// the page is already broken at that point (the feature the user clicked
// into never loads), so reloading is a strict improvement, even mid-exam.
window.addEventListener('vite:preloadError', () => {
  window.location.reload()
})

// The PWA service worker (`skipWaiting`/`clientsClaim`, see vite.config.ts)
// activates a new build in the background as soon as it's installed, but an
// already-open tab keeps running whatever JS it already loaded into memory —
// a reload is the only way that tab actually picks up the new code. Without
// this, a tab left open across a deploy can run stale JS indefinitely (e.g.
// a removed screen that still looks "live" to whoever has it open), long
// after the fix has shipped. Reloading on every takeover, even mid-task, is
// the same tradeoff `vite:preloadError` above already makes.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload()
  })
  // `registerSW.js` (vite-plugin-pwa's auto-injected script) only registers
  // the worker on page load — it never re-checks for a new one afterward. In
  // this SPA, going from Login to a dashboard is client-side routing, not a
  // real navigation, so a tab can sit on day-old JS indefinitely with nothing
  // ever prompting the browser to look again. Re-check whenever the tab
  // regains focus (covers a phone/tablet left open across a school day) plus
  // an hourly fallback for a tab that's never backgrounded.
  navigator.serviceWorker.ready.then((registration) => {
    const checkForUpdate = () => { void registration.update() }
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkForUpdate()
    })
    window.setInterval(checkForUpdate, 60 * 60 * 1000)
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
