/**
 * Centered "turn your phone" modal for the Schedule/Timetable grid, shown by
 * `useLandscapeFullscreen()` on mobile while still in portrait. Purely
 * presentational — the hook owns when it's visible and what each button does.
 */
export function LandscapePrompt({ onSwitch, onStay }: { onSwitch: () => void; onStay: () => void }) {
  return (
    <div className="landscape-prompt-backdrop" role="dialog" aria-modal="true" aria-label="Switch to landscape">
      <div className="landscape-prompt">
        <span className="landscape-prompt-icon" aria-hidden>🔄</span>
        <p className="landscape-prompt-text">Switch to Fullscreen Landscape for Optimal Timetable View?</p>
        <div className="landscape-prompt-actions">
          <button type="button" className="btn primary" onClick={onSwitch}>Yes, Switch to Landscape</button>
          <button type="button" className="btn ghost" onClick={onStay}>Stay in Portrait</button>
        </div>
      </div>
    </div>
  )
}
