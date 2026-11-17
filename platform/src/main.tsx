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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
