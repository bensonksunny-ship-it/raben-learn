import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

export interface LauncherItem {
  to: string
  label: string
  icon: string
}

/** Cycled across the grid by index — deliberately not role/meaning-coded (unlike
 *  PERIOD_COLOR/ELECTIVE_COLOR elsewhere), since the brief wants a varied, playful
 *  launcher rather than a legend. */
const TILE_COLORS = [
  { from: '#60a5fa', to: '#2563eb' }, // blue
  { from: '#4ade80', to: '#16a34a' }, // green
  { from: '#fbbf24', to: '#d97706' }, // amber
  { from: '#fb7185', to: '#e11d48' }, // rose
  { from: '#c084fc', to: '#9333ea' }, // purple
  { from: '#22d3ee', to: '#0891b2' }, // cyan
  { from: '#818cf8', to: '#4f46e5' }, // indigo
  { from: '#2dd4bf', to: '#0d9488' }, // teal
]

export interface ModuleLauncherProps {
  items: LauncherItem[]
  open: boolean
  onClose: () => void
}

/**
 * A frosted-glass "app launcher" modal — a grid of colorful squircle shortcuts to
 * every module the signed-in role can reach, mirroring `AppShell`'s own nav/bottom-nav
 * item lists one-for-one. Stays mounted a beat past `open` going false so the close
 * transition can actually play, instead of just vanishing.
 */
export function ModuleLauncher({ items, open, onClose }: ModuleLauncherProps) {
  const [mounted, setMounted] = useState(open)
  const [visible, setVisible] = useState(false)

  // Adjust state during render in response to `open` changing (React's own
  // pattern for this — not an effect): mount immediately, and drop `.visible`
  // immediately on close — no delay needed for that direction, the element is
  // already on screen. Only the mount→visible hop below needs the rAF delay,
  // since a class added in the same paint as the mount never transitions.
  if (open && !mounted) setMounted(true)
  if (!open && visible) setVisible(false)

  useEffect(() => {
    if (!open) return
    const id = requestAnimationFrame(() => setVisible(true))
    return () => cancelAnimationFrame(id)
  }, [open])

  useEffect(() => {
    if (!mounted) return
    function onKeyDown(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [mounted, onClose])

  if (!mounted) return null

  return (
    <div
      className={`launcher-backdrop${visible ? ' visible' : ''}`}
      onClick={onClose}
      onTransitionEnd={(e) => { if (e.target === e.currentTarget && !open) setMounted(false) }}
    >
      <div className="launcher-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="App launcher">
        <button type="button" className="launcher-close" aria-label="Close" onClick={onClose}>✕</button>
        <h2 className="launcher-title">Everything</h2>
        <div className="launcher-grid">
          {items.map((item, i) => {
            const color = TILE_COLORS[i % TILE_COLORS.length]!
            return (
              <Link key={`${item.to}_${item.label}`} to={item.to} className="launcher-tile" onClick={onClose}>
                <span
                  className="launcher-tile-icon"
                  style={{ background: `linear-gradient(145deg, ${color.from}, ${color.to})` }}
                  aria-hidden
                >
                  {item.icon}
                </span>
                <span className="launcher-tile-label">{item.label}</span>
              </Link>
            )
          })}
        </div>
      </div>
    </div>
  )
}
