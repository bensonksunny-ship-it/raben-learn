/**
 * Minimalist "turn your phone" nudge for the Schedule/Timetable grid, shown by
 * `useLandscapeFullscreen()` on mobile while still in portrait. Purely
 * presentational — the hook owns when it's visible and what each button does.
 */
export function LandscapePrompt({ onSwitch, onStay }: { onSwitch: () => void; onStay: () => void }) {
  return (
    <div className="landscape-prompt" role="status">
      <span className="landscape-prompt-text">Switch to landscape for the best timetable view?</span>
      <div className="landscape-prompt-actions">
        <button type="button" className="btn small primary" onClick={onSwitch}>Switch to Landscape</button>
        <button type="button" className="btn small ghost" onClick={onStay}>Stay in Portrait</button>
      </div>
    </div>
  )
}
