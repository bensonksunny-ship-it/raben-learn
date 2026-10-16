/**
 * Flat, rounded vector icons for the Manager Dashboard's stat tiles — stand-ins
 * for emoji so the tiles read as illustrated rather than relying on the OS's
 * own emoji font. Each takes `color` so it can match its tile's accent.
 */

export function StudentsIcon({ size = 28, color = '#ff8a3d' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <circle cx="24" cy="16" r="9" fill={color} />
      <path d="M6 42c0-10 8-16 18-16s18 6 18 16" fill={color} opacity="0.35" />
      <rect x="10" y="10" width="28" height="7" rx="3.5" fill={color} transform="rotate(-8 24 13)" />
    </svg>
  )
}

export function MentorsIcon({ size = 28, color = '#d97706' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="8" y="8" width="32" height="24" rx="6" fill={color} opacity="0.3" />
      <rect x="14" y="14" width="20" height="12" rx="3" fill={color} />
      <circle cx="24" cy="38" r="4" fill={color} />
      <path d="M24 32v4" stroke={color} strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function ScheduleIcon({ size = 28, color = '#7c3aed' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="7" y="10" width="34" height="30" rx="7" fill={color} opacity="0.3" />
      <rect x="7" y="10" width="34" height="10" rx="5" fill={color} />
      <circle cx="17" cy="28" r="3" fill={color} />
      <circle cx="24" cy="28" r="3" fill={color} />
      <circle cx="31" cy="28" r="3" fill={color} />
      <rect x="14" y="5" width="4" height="9" rx="2" fill={color} />
      <rect x="30" y="5" width="4" height="9" rx="2" fill={color} />
    </svg>
  )
}

export function CoursesIcon({ size = 28, color = '#7c3aed' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="8" y="9" width="32" height="30" rx="5" fill={color} opacity="0.3" />
      <path d="M8 13a5 5 0 0 1 5-5h11v30H13a5 5 0 0 1-5-5Z" fill={color} />
      <rect x="27" y="16" width="9" height="2.4" rx="1.2" fill={color} />
      <rect x="27" y="22" width="9" height="2.4" rx="1.2" fill={color} />
    </svg>
  )
}

export function SessionsIcon({ size = 28, color = '#059669' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="9" y="7" width="30" height="34" rx="5" fill={color} opacity="0.3" />
      <rect x="14" y="13" width="20" height="4" rx="2" fill={color} />
      <circle cx="17" cy="25" r="2.2" fill={color} />
      <rect x="22" y="23" width="12" height="3.6" rx="1.8" fill={color} />
      <circle cx="17" cy="33" r="2.2" fill={color} />
      <rect x="22" y="31" width="12" height="3.6" rx="1.8" fill={color} />
    </svg>
  )
}

/** Small lock badge for Priority-1 (manager-locked) schedule periods. */
export function LockIcon({ size = 12, color = '#087f5b' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="3" fill={color} />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" stroke={color} strokeWidth="2.4" fill="none" strokeLinecap="round" />
    </svg>
  )
}

/** Small starburst badge for Priority-2 (flexible/elective) schedule sessions —
 *  pairs with LockIcon so the two priorities read apart on sight, not just by color. */
export function FlexIcon({ size = 12, color = '#1971c2' }: { size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <path d="M12 2 L14.6 9.4 L22 12 L14.6 14.6 L12 22 L9.4 14.6 L2 12 L9.4 9.4 Z" fill={color} />
    </svg>
  )
}
