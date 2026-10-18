import { useCallback, useEffect, useState } from 'react'

// Same breakpoint AppShell's own sidebar/bottom-nav switch on (index.css) — "mobile"
// means the same thing everywhere in this app.
const MOBILE_QUERY = '(max-width: 600px)'
const LANDSCAPE_QUERY = '(orientation: landscape)'

function matches(query: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches
}

export interface UseLandscapeFullscreenResult {
  /** Show the "switch to landscape?" nudge — mobile, still portrait, not dismissed yet. */
  promptVisible: boolean
  /** True once the device — by our own Fullscreen+lock call below, or just a plain
   *  physical rotation — is mobile and landscape. The page's own `landscape-fullscreen`
   *  body class (index.css) is kept in sync with this, expanding the grid and hiding
   *  the sidebar/bottom-nav either way, so it still works on browsers (iOS Safari)
   *  that support neither Fullscreen nor orientation lock. */
  isLandscapeFullscreen: boolean
  /** "Switch to Landscape" — best-effort; silently does nothing beyond dismissing
   *  the prompt if the browser supports neither API. */
  enterLandscape: () => void
  /** "Stay in Portrait" — just dismiss, no API calls. */
  dismissPrompt: () => void
  /** The floating "Exit Landscape" button's handler — the only way out while
   *  locked: unlocks orientation and exits fullscreen (best-effort, same as
   *  `enterLandscape`'s own feature checks). */
  exitLandscape: () => void
}

/**
 * Nudges a mobile visitor toward landscape on the Schedule/Timetable grid (a
 * portrait phone screen crops a Mon–Sat grid badly), and tracks real orientation
 * so the full-viewport layout applies whether landscape was reached via this
 * prompt or by just turning the phone. One hook, used by both `SchedulePage` and
 * `StudentTimetableView` — whichever entry point (the /schedule route, or any of
 * the Timetable popups) ends up rendering one of those owns the same behavior.
 */
export function useLandscapeFullscreen(): UseLandscapeFullscreenResult {
  const [isMobile, setIsMobile] = useState(() => matches(MOBILE_QUERY))
  const [isLandscape, setIsLandscape] = useState(() => matches(LANDSCAPE_QUERY))
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const mobileMq = window.matchMedia(MOBILE_QUERY)
    const landscapeMq = window.matchMedia(LANDSCAPE_QUERY)
    const onMobileChange = () => setIsMobile(mobileMq.matches)
    const onLandscapeChange = () => setIsLandscape(landscapeMq.matches)
    mobileMq.addEventListener('change', onMobileChange)
    landscapeMq.addEventListener('change', onLandscapeChange)
    return () => {
      mobileMq.removeEventListener('change', onMobileChange)
      landscapeMq.removeEventListener('change', onLandscapeChange)
    }
  }, [])

  const isLandscapeFullscreen = isMobile && isLandscape

  // One class on <body> (not a wrapper div) so it reaches the sidebar/bottom-nav
  // and .main regardless of how deep the actual grid is nested (a plain /schedule
  // page vs. any of the Timetable popups).
  useEffect(() => {
    document.body.classList.toggle('landscape-fullscreen', isLandscapeFullscreen)
    return () => { document.body.classList.remove('landscape-fullscreen') }
  }, [isLandscapeFullscreen])

  // `!isLandscape` alone already hides the prompt once landscape is reached by any
  // means (our own lock call, or a plain physical rotation) — `dismissed` only
  // needs to track an explicit "Stay in Portrait".
  const promptVisible = isMobile && !isLandscape && !dismissed

  const enterLandscape = useCallback(() => {
    setDismissed(true)
    void (async () => {
      try {
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen()
        }
      } catch {
        // Denied or unsupported — orientation lock below still gets a try, and the
        // CSS layout adapts on a plain physical rotation regardless.
      }
      try {
        // `.lock()` isn't in TS's lib.dom.d.ts (still experimental/Chromium-only —
        // notably absent on iOS Safari), hence the cast.
        const orientation = screen.orientation as ScreenOrientation & { lock?: (orientation: string) => Promise<void> }
        if (typeof orientation.lock === 'function') await orientation.lock('landscape')
      } catch {
        // Not supported, or rejected (most browsers require fullscreen to have
        // actually taken first) — nothing more to do here.
      }
    })()
  }, [])

  const dismissPrompt = useCallback(() => setDismissed(true), [])

  const exitLandscape = useCallback(() => {
    void (async () => {
      try {
        // Unlock before exiting fullscreen — some browsers refuse an unlock call
        // once fullscreen is already gone.
        const orientation = screen.orientation as ScreenOrientation & { unlock?: () => void }
        if (typeof orientation.unlock === 'function') orientation.unlock()
      } catch {
        // Not supported — nothing to undo.
      }
      try {
        if (document.fullscreenElement && document.exitFullscreen) {
          await document.exitFullscreen()
        }
      } catch {
        // Already out of fullscreen, or the browser refused — the CSS layout
        // still falls back to portrait correctly on the next real rotation.
      }
    })()
  }, [])

  return { promptVisible, isLandscapeFullscreen, enterLandscape, dismissPrompt, exitLandscape }
}
