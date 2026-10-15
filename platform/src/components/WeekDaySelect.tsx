import { useEffect, useId, useRef, useState } from 'react'
import { ChevronIcon } from './icons'

export interface WeekDayOption {
  /** The underlying value — an ISO date string (yyyy-mm-dd). */
  date: string
  /** Full weekday name, e.g. "Monday" — shown large, set in this day's identity color. */
  dayName: string
  /** Short calendar date, e.g. "Oct 13" — shown small and muted. */
  dateLabel: string
  /** This weekday's identity color, shared with the schedule grid's column headers below. */
  color: { bg: string; text: string }
  isToday?: boolean
}

interface WeekDaySelectProps {
  options: WeekDayOption[]
  value: string
  onChange: (date: string) => void
}

/**
 * Compact "jump to a day" picker for the diary toolbar — lists the 7 days of the
 * selected week, each badged in the same color as its column header in the
 * schedule grid, so the two stay visually linked. A native <select> can't size or
 * color <option> text, so this is a listbox (see StudentSelect for the same reasoning).
 */
export function WeekDaySelect({ options, value, onChange }: WeekDaySelectProps) {
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const baseId = useId()
  const listId = `${baseId}-list`
  const optionId = (i: number) => `${baseId}-opt-${i}`

  const selectedIndex = options.findIndex((o) => o.date === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null

  // Close on outside pointer-down, so a click that lands on the page also dismisses.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent | TouchEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('touchstart', onPointerDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('touchstart', onPointerDown)
    }
  }, [open])

  // Land focus in the menu once it's mounted. Pure DOM work — the state it reacts
  // to is set by the handlers that open it.
  useEffect(() => {
    if (!open) return
    listRef.current?.focus()
  }, [open])

  useEffect(() => {
    if (!open || activeIndex < 0) return
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  function openMenu() {
    setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0)
    setOpen(true)
  }

  function close(refocus = true) {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }

  function pick(date: string) {
    onChange(date)
    close()
  }

  function move(delta: number) {
    if (options.length === 0) return
    setActiveIndex((i) => {
      const next = i < 0 ? (delta > 0 ? 0 : options.length - 1) : i + delta
      return Math.min(options.length - 1, Math.max(0, next))
    })
  }

  function onKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(1); break
      case 'ArrowUp': e.preventDefault(); move(-1); break
      case 'Home': e.preventDefault(); setActiveIndex(0); break
      case 'End': e.preventDefault(); setActiveIndex(options.length - 1); break
      case 'Enter':
      case ' ': {
        e.preventDefault()
        const opt = options[activeIndex]
        if (opt) pick(opt.date)
        break
      }
      case 'Escape': e.preventDefault(); close(); break
      case 'Tab': close(false); break
    }
  }

  function onTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      openMenu()
    }
  }

  const activeDescendant = activeIndex >= 0 && options[activeIndex] ? optionId(activeIndex) : undefined

  return (
    <div className="daysel" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className="daysel-trigger"
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
        disabled={options.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={selected ? `Day: ${selected.dayName}, ${selected.dateLabel}. Jump to a different day` : 'Jump to a day'}
      >
        <span
          className={`daysel-badge${selected ? '' : ' is-empty'}`}
          style={selected ? { background: selected.color.bg, color: selected.color.text } : undefined}
          aria-hidden
        >
          {selected ? selected.dayName.slice(0, 2) : '—'}
        </span>
        <span className="daysel-trigger-text">
          <span className="daysel-day" style={selected ? { color: selected.color.text } : undefined}>
            {selected?.dayName ?? 'Jump to day'}
          </span>
          {selected && <span className="daysel-date">{selected.dateLabel}</span>}
        </span>
        <span className="daysel-chevron" aria-hidden><ChevronIcon /></span>
      </button>

      {open && (
        <ul
          ref={listRef}
          id={listId}
          className="daysel-list"
          role="listbox"
          tabIndex={-1}
          aria-label="Days this week"
          aria-activedescendant={activeDescendant}
          onKeyDown={onKeyDown}
        >
          {options.map((o, i) => {
            const isSelected = o.date === value
            return (
              <li
                key={o.date}
                id={optionId(i)}
                role="option"
                aria-selected={isSelected}
                className={`daysel-option${isSelected ? ' is-selected' : ''}${i === activeIndex ? ' is-active' : ''}`}
                style={isSelected ? { background: o.color.bg, boxShadow: `inset 3px 0 0 ${o.color.text}` } : undefined}
                onClick={() => pick(o.date)}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <span className="daysel-badge" style={{ background: o.color.bg, color: o.color.text }} aria-hidden>
                  {o.dayName.slice(0, 2)}
                </span>
                <span className="daysel-option-text">
                  <span className="daysel-day" style={{ color: o.color.text }}>{o.dayName}</span>
                  <span className="daysel-date">{o.dateLabel}</span>
                </span>
                {o.isToday && <span className="tag daysel-today-tag">Today</span>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
