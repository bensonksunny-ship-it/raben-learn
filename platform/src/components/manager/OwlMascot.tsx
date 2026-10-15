/**
 * Simple vector owl mascot — used in place of a realistic stock photo on the
 * Manager Dashboard's welcome banner. Pure inline SVG (no external asset), so
 * it recolors cleanly via `tint`/`accent` and never needs a network request.
 */
export function OwlMascot({ size = 96, tint = '#ff8a3d', accent = '#3a2e5c' }: { size?: number; tint?: string; accent?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      {/* body */}
      <ellipse cx="50" cy="58" rx="34" ry="30" fill={tint} />
      {/* ear tufts */}
      <path d="M24 30 L34 14 L40 34 Z" fill={tint} />
      <path d="M76 30 L66 14 L60 34 Z" fill={tint} />
      {/* belly */}
      <ellipse cx="50" cy="64" rx="20" ry="18" fill="#fffdf7" />
      {/* eyes */}
      <circle cx="37" cy="52" r="13" fill="#fffdf7" />
      <circle cx="63" cy="52" r="13" fill="#fffdf7" />
      <circle cx="37" cy="52" r="6.5" fill={accent} />
      <circle cx="63" cy="52" r="6.5" fill={accent} />
      <circle cx="35" cy="50" r="2" fill="#fff" />
      <circle cx="61" cy="50" r="2" fill="#fff" />
      {/* beak */}
      <path d="M50 58 L45 66 L55 66 Z" fill="#f5a524" />
      {/* feet */}
      <path d="M40 86 L36 94 M40 86 L40 94 M40 86 L44 94" stroke="#f5a524" strokeWidth="3" strokeLinecap="round" />
      <path d="M60 86 L56 94 M60 86 L60 94 M60 86 L64 94" stroke="#f5a524" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
