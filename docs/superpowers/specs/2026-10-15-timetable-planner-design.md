# Timetable Planner / Class Schedule — Design

Status: approved, implementing directly (user opted to skip the separate spec-review pause).

**Revision (2026-10-15, later same day):** the UI changed from a per-day tab +
table editor to an actual clickable weekly grid, and the data model changed
from "one start time per day, periods cascade with no gaps" to "each period
stores its own start time, gaps allowed." See **Revision 2** below — it
supersedes the original UI and data-model sections, which are kept struck
through for history.

## Goal

Give the `manager` role a page to author one shared, platform-wide weekly class
timetable: mandatory periods per weekday (Priority 1, "locked"), with the
remaining open time visually obvious as empty grid slots. This pass is
**display-only** beyond authoring the timetable itself — it does not modify
`StudentDailyPlanner`'s add/edit flow to block overlapping activities. That
enforcement is an explicit follow-up, not built here.

## Data model (Revision 2 — current)

Single shared document: `class_timetable/master`

```ts
type Weekday = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun'

interface TimetablePeriod {
  id: string
  title: string          // free-text, e.g. "Math", "Assembly", "Lunch"
  startTime: string      // "HH:MM" — this period's own start; gaps between periods are fine
  durationMinutes: number
}

interface TimetableDay {
  periods: TimetablePeriod[]
}

interface ClassTimetable {
  windowStart: string  // "HH:MM", default "10:00" — grid's visible hour range
  windowEnd: string    // default "18:00"
  days: Record<Weekday, TimetableDay>
}
```

Each period is independent — clicking a grid slot fixes that period's exact
start time regardless of what else is scheduled that day. New periods are
validated against every other period on the same day and rejected (inline
modal error) if they'd overlap. The grid expands beyond `windowStart`/
`windowEnd` to fit any period that falls outside the configured range, the
same defensive technique `StudentDiaryPage`'s grid already uses.

<details><summary>Original data model (superseded)</summary>

`TimetableDay.startTime: string | null` anchored period 1; periods only
stored `durationMinutes` and cascaded with zero gaps. Dropped because a true
grid requires clicking any empty slot to fix an independent start time.

</details>

## Access control

- `Capability`: `'manageTimetable'`, granted only to `manager` in
  `src/lib/rbac.ts` (not admin, not mentor — matches the explicit ask).
- Route `/timetable`, guarded by `<RequireCapability cap="manageTimetable">`.
- Nav links in `AppShell`'s `isManager` blocks (desktop sidebar + mobile
  bottom nav), next to Users/Students.
- Firestore: `allow read: if isSignedIn()` (so a later pass can surface this to
  students/mentors without a rules change), `allow write: if hasRole('manager')`.

## UI (Revision 2 — current)

One page, `src/pages/admin/TimetablePlannerPage.tsx` (kept in the existing
`pages/admin/` folder — same precedent as `UserManagement`/`StudentsPage`,
which are manager-reachable pages that still live there):

- Small form at the top: grid time-range start/end (defaults 10:00–18:00).
- A weekly grid — 7 day columns × hourly rows, pastel day-header colors reused
  from the Diary weekly grid. Hour rows are a fixed height so period cards can
  be positioned with a height proportional to their duration (an absolutely
  positioned overlay per day-column, layered over plain clickable per-hour
  cells beneath).
- Click an empty cell → modal: title, start time (pre-filled from the clicked
  slot, editable), duration (30/45/60-minute quick picks + a custom-minutes
  number field), a live-computed end time, Save/Cancel.
- Click an existing period's card → same modal pre-filled, plus Delete.

<details><summary>Original UI (superseded)</summary>

Day tabs Mon–Sun; selected day showed a start-time input, a period table
(computed start–end read-only, inline edit/delete), an "+ Period" mini-form,
and a read-only "leftover windows" text list below. The tabs, table, and
leftover-list are gone — the grid itself now makes open time visually
obvious, so a separate leftover list is redundant.

</details>

## Explicit non-goals (this pass)

- No changes to `StudentDailyPlanner`.
- No per-student or per-course timetables — one shared schedule for everyone.
- No "copy periods to other days" convenience.
- No drag-to-resize/drag-to-move on the grid — editing a period re-opens the modal.
