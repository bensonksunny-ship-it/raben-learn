/**
 * The only way out of locked landscape-fullscreen mode (see
 * `useLandscapeFullscreen`'s `exitLandscape`) — a floating button, always on
 * screen while `isLandscapeFullscreen` is true.
 */
export function LandscapeExitButton({ onExit }: { onExit: () => void }) {
  return (
    <button type="button" className="landscape-exit-btn" onClick={onExit}>
      <span aria-hidden>↩</span> Exit Landscape
    </button>
  )
}
