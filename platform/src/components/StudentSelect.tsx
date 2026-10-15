import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ChevronIcon, SearchIcon, PersonIcon, CheckIcon } from './icons'

export interface StudentSelectOption {
  id: string
  name: string
}

interface StudentSelectProps {
  students: StudentSelectOption[]
  value: string | null
  onChange: (id: string | null) => void
  loading?: boolean
  /** Show the filter field once the list is long enough to be worth narrowing. */
  filterThreshold?: number
}

/** First letter of the name, for the row's initial disc. */
function initialOf(name: string): string {
  const ch = [...name].find((c) => /[\p{L}\p{N}]/u.test(c))
  return ch ? ch.toUpperCase() : '?'
}

function matching(students: StudentSelectOption[], query: string): StudentSelectOption[] {
  const q = query.trim().toLowerCase()
  if (!q) return students
  return students.filter((s) => s.name.toLowerCase().includes(q))
}

/**
 * Student picker for the diary toolbar.
 *
 * A native <select> can't carry the styling this control needs — browsers hand the
 * option list to the OS, which drops padding, line-height, font-size and hover states
 * on <option>. So this is a listbox: a button that opens a popup of real elements.
 * The filter field replaces the type-ahead the native control gave for free.
 */
export function StudentSelect({
  students,
  value,
  onChange,
  loading = false,
  filterThreshold = 7,
}: StudentSelectProps) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)

  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const baseId = useId()
  const listId = `${baseId}-list`
  const optionId = (i: number) => `${baseId}-opt-${i}`

  const selected = students.find((s) => s.id === value) ?? null
  const showFilter = students.length > filterThreshold

  const visible = useMemo(() => matching(students, filter), [students, filter])

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
    const target = showFilter ? searchRef.current : listRef.current
    target?.focus()
  }, [open, showFilter])

  // Keep the active row in view. Indexing children beats a selector here — `useId`
  // emits characters that aren't valid in one.
  useEffect(() => {
    if (!open || activeIndex < 0) return
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex, visible.length])

  function openMenu() {
    setFilter('')
    const start = value ? students.findIndex((s) => s.id === value) : -1
    setActiveIndex(start >= 0 ? start : students.length > 0 ? 0 : -1)
    setOpen(true)
  }

  function close(refocus = true) {
    setOpen(false)
    if (refocus) triggerRef.current?.focus()
  }

  /** Filter and active row move together, so the highlight never points at a stale index. */
  function onFilterChange(next: string) {
    setFilter(next)
    setActiveIndex(matching(students, next).length > 0 ? 0 : -1)
  }

  function pick(id: string) {
    onChange(id)
    close()
  }

  function move(delta: number) {
    if (visible.length === 0) return
    setActiveIndex((i) => {
      const next = i < 0 ? (delta > 0 ? 0 : visible.length - 1) : i + delta
      return Math.min(visible.length - 1, Math.max(0, next))
    })
  }

  function onKeyDown(e: React.KeyboardEvent) {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(1); break
      case 'ArrowUp': e.preventDefault(); move(-1); break
      case 'Home': e.preventDefault(); setActiveIndex(visible.length > 0 ? 0 : -1); break
      case 'End': e.preventDefault(); setActiveIndex(visible.length - 1); break
      case 'Enter': {
        e.preventDefault()
        const opt = visible[activeIndex]
        if (opt) pick(opt.id)
        break
      }
      case ' ': {
        // Space selects from the list, but must stay typable in the filter field.
        if (e.target === searchRef.current) break
        e.preventDefault()
        const opt = visible[activeIndex]
        if (opt) pick(opt.id)
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

  const activeDescendant = activeIndex >= 0 && visible[activeIndex] ? optionId(activeIndex) : undefined

  return (
    <div className="sselect" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`sselect-trigger${selected ? ' is-filled' : ''}`}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={onTriggerKeyDown}
        disabled={loading || students.length === 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={selected ? `Student: ${selected.name}. Change student` : 'Select a student'}
      >
        <span className={`sselect-avatar${selected ? '' : ' is-empty'}`} aria-hidden>
          {selected ? initialOf(selected.name) : <PersonIcon />}
        </span>
        <span className="sselect-trigger-text">
          {loading ? 'Loading students…' : students.length === 0 ? 'No students yet' : (selected?.name ?? 'Select a student')}
        </span>
        <span className="sselect-chevron" aria-hidden><ChevronIcon /></span>
      </button>

      {open && (
        <div className="sselect-menu" role="presentation">
          {showFilter && (
            <div className="sselect-search-wrap">
              <span className="sselect-search-icon" aria-hidden><SearchIcon /></span>
              <input
                ref={searchRef}
                type="text"
                className="sselect-search"
                value={filter}
                onChange={(e) => onFilterChange(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Filter by name"
                aria-label="Filter students by name"
                aria-controls={listId}
                aria-activedescendant={activeDescendant}
                autoComplete="off"
              />
            </div>
          )}

          <ul
            ref={listRef}
            id={listId}
            className="sselect-list"
            role="listbox"
            tabIndex={showFilter ? -1 : 0}
            aria-label="Students"
            aria-activedescendant={showFilter ? undefined : activeDescendant}
            onKeyDown={showFilter ? undefined : onKeyDown}
          >
            {visible.map((s, i) => {
              const isSelected = s.id === value
              return (
                <li
                  key={s.id}
                  id={optionId(i)}
                  role="option"
                  aria-selected={isSelected}
                  className={`sselect-option${isSelected ? ' is-selected' : ''}${i === activeIndex ? ' is-active' : ''}`}
                  onClick={() => pick(s.id)}
                  onMouseEnter={() => setActiveIndex(i)}
                >
                  <span className="sselect-option-avatar" aria-hidden>{initialOf(s.name)}</span>
                  <span className="sselect-option-name">{s.name}</span>
                  {isSelected && <span className="sselect-option-check" aria-hidden><CheckIcon /></span>}
                </li>
              )
            })}

            {visible.length === 0 && (
              <li className="sselect-empty" role="presentation">No students match “{filter.trim()}”</li>
            )}
          </ul>
        </div>
      )}
    </div>
  )
}
