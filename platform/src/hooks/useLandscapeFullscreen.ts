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
  /** True once the view should present as landscape-fullscreen — by a real device
   *  rotation, our own Fullscreen+lock call actually taking, or (see `useCssRotate`
   *  below) the pure-CSS fallback. The page's own `landscape-fullscreen` body class
   *  (index.css) is kept in sync with this. */
  isLandscapeFullscreen: boolean
  /** True when we're faking it: `enterLandscape` was clicked but the device is
   *  still physically portrait (screen.orientation.lock isn't implemented on iOS
   *  Safari at all, and plenty of browsers otherwise ignore or reject the call) —
   *  so the page should render its own rotated, viewport-filling wrapper instead
   *  of relying on the OS to have actually turned the display. Goes false again
   *  the moment a real rotation (ours or physical) is detected, so we never
   *  double-rotate on top of a genuine landscape viewport. */
  useCssRotate: boolean
  /** "Switch to Landscape" — tries Fullscreen + orientation lock; whatever doesn't
   *  stick, the CSS rotate fallback (`useCssRotate`) picks up the rest, so the view
   *  always ends up landscape without the user needing to physically turn the
   *  phone, even on browsers that support neither native API. */
  enterLandscape: () => void
  /** "Stay in Portrait" — just dismiss, no API calls. */
  dismissPrompt: () => void
  /** The floating "Exit Landscape" button's handler — the only way out while
   *  locked: unwinds whichever of the lock/fullscreen/CSS-rotate combination is
   *  actually active. */
  exitLandscape: () => void
}

/** Native rotation needs a moment to actually land (it's async, and on some
 *  browsers the `orientationchange`/matchMedia update arrives a tick after the
 *  lock promise resolves) — long enough to not false-trigger the CSS fallback
 *  while a real rotation is still in flight, short enough nobody notices it. */
const NATIVE_ROTATE_GRACE_MS = 400

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
  // Only ever set true by `enterLandscape`'s own grace-period check below, and
  // cleared the moment a *real* rotation shows up (effect further down) or on exit.
  const [cssRotateRequested, setCssRotateRequested] = useState(false)

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

  // A real rotation (native lock actually taking, or the user just physically
  // turning the phone) always wins over the fake one — never stack both. Adjusted
  // during render (React's own pattern for this, not an effect) so there's no
  // extra render-then-effect round trip before the real rotation takes over.
  if (isLandscape && cssRotateRequested) setCssRotateRequested(false)

  const useCssRotate = isMobile && cssRotateRequested && !isLandscape
  const isLandscapeFullscreen = isMobile && (isLandscape || useCssRotate)

  // One class on <body> (not a wrapper div) so it reaches the sidebar/bottom-nav
  // and .main regardless of how deep the actual grid is nested (a plain /schedule
  // page vs. any of the Timetable popups).
  useEffect(() => {
    document.body.classList.toggle('landscape-fullscreen', isLandscapeFullscreen)
    return () => { document.body.classList.remove('landscape-fullscreen') }
  }, [isLandscapeFullscreen])

  // `!isLandscape` alone already hides the prompt once landscape is reached by any
  // means (our own lock call, or a plain physical rotation) — `dismissed` only
  // needs to track an explicit "Stay in Portrait". The CSS-rotate fallback counts
  // as "landscape" too (isLandscapeFullscreen), so the prompt also disappears
  // once that's kicked in, even though the device itself is still portrait.
  const promptVisible = isMobile && !isLandscape && !dismissed && !useCssRotate

  const enterLandscape = useCallback(() => {
    setDismissed(true)
    void (async () => {
      try {
        if (document.documentElement.requestFullscreen) {
          await document.documentElement.requestFullscreen()
        }
      } catch {
        // Denied or unsupported — orientation lock below still gets a try, and the
        // CSS rotate fallback below picks up whatever neither managed.
      }
      try {
        // `.lock()` isn't in TS's lib.dom.d.ts (still experimental/Chromium-only —
        // notably absent on iOS Safari), hence the cast.
        const orientation = screen.orientation as ScreenOrientation & { lock?: (orientation: string) => Promise<void> }
        if (typeof orientation.lock === 'function') await orientation.lock('landscape')
      } catch {
        // Not supported, or rejected (most browsers require fullscreen to have
        // actually taken first) — the CSS fallback below covers it regardless.
      }
      // Give the native rotation a beat to actually land (see NATIVE_ROTATE_GRACE_MS)
      // before deciding it didn't — on iOS Safari (no lock() at all) this is
      // immediate; on browsers that silently ignore/reject the lock, it's the same
      // outcome a moment later either way.
      window.setTimeout(() => {
        if (!matches(LANDSCAPE_QUERY)) setCssRotateRequested(true)
      }, NATIVE_ROTATE_GRACE_MS)
    })()
  }, [])

  const dismissPrompt = useCallback(() => setDismissed(true), [])

  const exitLandscape = useCallback(() => {
    setCssRotateRequested(false)
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

  return { promptVisible, isLandscapeFullscreen, useCssRotate, enterLandscape, dismissPrompt, exitLandscape }
}
