/**
 * Constants and pure helpers shared between `<PriorityScheduler />` and the pages
 * that load its data (`SchedulePage`). Kept out of `PriorityScheduler.tsx` itself —
 * a component file may only export components, or Fast Refresh stops working for it.
 */
import type { Weekday } from '../../types'

export const WEEKDAYS: Weekday[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** Rainbow-bright, one hue per weekday — reads as a kid-friendly weekly chart. */
export const DAY_COLORS: Record<Weekday, { bg: string; text: string }> = {
  Mon: { bg: '#ffe3e3', text: '#e03131' },
  Tue: { bg: '#ffe8cc', text: '#e8590c' },
  Wed: { bg: '#fff3bf', text: '#f08c00' },
  Thu: { bg: '#d3f9d8', text: '#2b8a3e' },
  Fri: { bg: '#d0ebff', text: '#1971c2' },
  Sat: { bg: '#e5dbff', text: '#7048e8' },
}

export function timeStrToMinutes(s: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const hh = Number(m[1]); const mm = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return hh * 60 + mm
}

export function formatTime(ms: number) {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${String(sec).padStart(2, '0')}s`
}
