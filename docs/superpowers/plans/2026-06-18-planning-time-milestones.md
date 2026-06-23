# Planning Page — Time & Milestones Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add session duration tracking and level goal text to the Planning page's Levels tab, plus a duration input to the Syllabus page.

**Architecture:** `durationMinutes` is written in SyllabusPage and read as read-only time totals in PlanningPage. `milestones` is a free-form string on each `planning_levels` doc, read and written directly from LevelCard on expand/blur. All changes are in three existing files.

**Tech Stack:** React 19, TypeScript, Firebase Firestore v12, Vite

---

## File Map

| File | Change |
|------|--------|
| `platform/src/types.ts` | Add `durationMinutes?: number` to `Session` |
| `platform/src/pages/admin/SyllabusPage.tsx` | Add "Duration (min)" input to session editor, save on blur |
| `platform/src/pages/admin/PlanningPage.tsx` | `formatDuration` helper; duration labels on session rows, subject headers, level headers; Goals textarea in LevelCard |

No new files. No new collections. No test framework — verification is `tsc --noEmit`.

---

## Task 1: Add `durationMinutes` to Session type

**Files:**
- Modify: `platform/src/types.ts`

- [ ] **Step 1: Add the field**

In `platform/src/types.ts`, find the `Session` interface (line 62) and add `durationMinutes` after `order`:

```typescript
export interface Session {
  id: string
  title: string
  subtitle?: string
  courseName?: string
  courseId: string | null
  order?: number
  durationMinutes?: number
  /** Ordered list of Topics. Stored in Firestore under the same field name for back-compat. */
  activities: Topic[]
}
```

- [ ] **Step 2: Verify tsc is clean**

```bash
cd platform && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git -C platform add src/types.ts
git -C platform commit -m "feat: add durationMinutes to Session type"
```

---

## Task 2: Duration input in SyllabusPage

**Files:**
- Modify: `platform/src/pages/admin/SyllabusPage.tsx`

The session editor (the form rendered when `sessionFormOpen` is true, around line 408) needs a "Duration (min)" number input. The input saves to Firestore on blur via `updateDoc`. For new sessions not yet saved, the value is held in component state and included in the `saveSession` payload.

- [ ] **Step 1: Add `sessionDuration` state**

Near the top of `SyllabusPage` (around line 34, alongside `sessionTitle` / `sessionOrder`), add:

```typescript
const [sessionDuration, setSessionDuration] = useState(0)
```

- [ ] **Step 2: Reset duration when opening forms**

In `openNewSessionForm` (line 112), add:
```typescript
setSessionDuration(0)
```

In `openEditSessionForm` (line 120), add:
```typescript
setSessionDuration(session.durationMinutes ?? 0)
```

- [ ] **Step 3: Include duration in `saveSession` payload**

In the `saveSession` function (line 128), update the `data` object to include `durationMinutes`:

```typescript
const data = {
  courseId: selectedCourseId,
  courseName: selectedCourse?.title ?? '',
  title: sessionTitle.trim(),
  order: sessionOrder,
  durationMinutes: sessionDuration,
  activities: cleaned,
  updatedAt: serverTimestamp(),
}
```

- [ ] **Step 4: Add duration field to session editor form**

In the session form JSX (around line 412), inside the `<form>` after the title/order row, add the duration input alongside the existing order input in that flex row:

```tsx
<div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
  <label style={{ flex: 1 }}>
    Session title
    <input value={sessionTitle} onChange={(e) => setSessionTitle(e.target.value)} placeholder="e.g. Session-1" required />
  </label>
  <label style={{ width: 90, flexShrink: 0 }}>
    Order
    <input type="number" value={sessionOrder} onChange={(e) => setSessionOrder(Number(e.target.value))} min={1} />
  </label>
  <label style={{ width: 100, flexShrink: 0 }}>
    Duration (min)
    <input
      type="number"
      value={sessionDuration}
      min={0}
      step={5}
      onChange={(e) => setSessionDuration(Number(e.target.value))}
    />
  </label>
</div>
```

- [ ] **Step 5: Read `durationMinutes` when loading sessions**

In `loadSessions` (line 72), update the `list.push(...)` call to include `durationMinutes`:

```typescript
list.push({
  id: d.id,
  title: (x.title as string) ?? '',
  subtitle: (x.subtitle as string) ?? '',
  courseName: (x.courseName as string) ?? '',
  courseId: (x.courseId as string) ?? null,
  order: Number(x.order ?? 0),
  durationMinutes: Number(x.durationMinutes ?? 0),
  activities: topics,
})
```

- [ ] **Step 6: Show duration in session list cards**

In the session list JSX (around line 470, inside `sessions.map`), add the duration badge to each session card header. Find the `<div className="row syllabus-session-head">` and update the first `<div>` child:

```tsx
<div>
  <strong className="syllabus-session-title">{s.order}. {s.title}</strong>
  <span className="muted small syllabus-session-meta">
    {s.activities.length} topic{s.activities.length === 1 ? '' : 's'}
    {s.activities.length > 0
      ? ` · ${conceptCount} concept${conceptCount === 1 ? '' : 's'}, ${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'}`
      : ''}
    {(s.durationMinutes ?? 0) > 0 ? ` · ${s.durationMinutes} min` : ''}
  </span>
</div>
```

- [ ] **Step 7: Verify tsc is clean**

```bash
cd platform && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git -C platform add src/pages/admin/SyllabusPage.tsx
git -C platform commit -m "feat: add duration input to Syllabus session editor"
```

---

## Task 3: Read-only time totals in PlanningPage Levels tab

**Files:**
- Modify: `platform/src/pages/admin/PlanningPage.tsx`

Three additions:
1. `formatDuration` helper at the top of the file
2. Duration label on each session row inside `DraggableSessionList`
3. Subject subtotal in `SubjectRow` header
4. Level total chip in `LevelCard` header (requires passing subject totals up)

The `durationMinutes` field must also be read when loading sessions in `SubjectRow.loadSessions`.

- [ ] **Step 1: Add `formatDuration` helper**

Add this function near the top of `PlanningPage.tsx`, after the imports:

```typescript
function formatDuration(minutes: number): string {
  if (minutes <= 0) return ''
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}
```

- [ ] **Step 2: Read `durationMinutes` in SubjectRow's `loadSessions`**

In `SubjectRow` (line 362), update the `list.push(...)` call inside `loadSessions` to include `durationMinutes`:

```typescript
list.push({
  id: d.id,
  title: (x.title as string) ?? '',
  subtitle: (x.subtitle as string) ?? '',
  courseId: (x.courseId as string) ?? null,
  courseName: (x.courseName as string) ?? '',
  order: Number(x.order ?? 0),
  durationMinutes: Number(x.durationMinutes ?? 0),
  activities: readTopicsFromSessionDoc(x.activities),
})
```

- [ ] **Step 3: Show duration on each session row in `DraggableSessionList`**

In `DraggableSessionList` (line 139), inside the `sessions.map(...)`, update the session card JSX to show the duration label. The card currently ends with `{session.subtitle && ...}`. Add the duration label after:

```tsx
<div
  key={session.id} draggable
  onDragStart={() => setDragIndex(index)}
  onDragOver={(e) => handleDragOver(e, index)}
  onDragEnd={handleDragEnd}
  className="panel"
  style={{
    display: 'flex', alignItems: 'center', gap: '0.6rem',
    padding: '0.6rem 0.85rem', cursor: 'grab',
    opacity: dragIndex === index ? 0.4 : 1,
    outline: overIndex === index && dragIndex !== index ? '2px solid var(--primary, #6366f1)' : 'none',
    userSelect: 'none',
  }}
>
  <span style={{ color: 'var(--muted, #9ca3af)', fontSize: '1rem' }}>⠿</span>
  <span className="muted small" style={{ minWidth: '1.4rem', textAlign: 'right' }}>{index + 1}</span>
  <div style={{ flex: 1 }}>
    <strong style={{ fontSize: '0.9rem' }}>{session.title}</strong>
    {session.subtitle && <p className="muted small" style={{ margin: '0.1rem 0 0' }}>{session.subtitle}</p>}
  </div>
  {(session.durationMinutes ?? 0) > 0 && (
    <span className="muted small" style={{ whiteSpace: 'nowrap' }}>
      {formatDuration(session.durationMinutes ?? 0)}
    </span>
  )}
</div>
```

- [ ] **Step 4: Compute subject total and show in SubjectRow header**

In `SubjectRow` (line 362), inside the subject row header JSX (the `<div>` with `onClick={toggle}`), compute and display the subject total. Add the total display after the course title span:

```tsx
{/* Subject row header */}
<div
  style={{ display: 'flex', alignItems: 'center', gap: '0.65rem', padding: '0.75rem 1.25rem', cursor: 'pointer' }}
  onClick={toggle}
>
  <span style={{ fontSize: '0.8rem', transition: 'transform 0.15s', display: 'inline-block', transform: open ? 'rotate(90deg)' : 'rotate(0deg)', color: 'var(--muted, #9ca3af)' }}>▶</span>
  <span style={{ flex: 1, fontWeight: 500 }}>{course.title}</span>
  {(() => {
    const total = sessions.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0)
    return total > 0 ? (
      <span className="muted small" style={{ whiteSpace: 'nowrap' }}>⏱ {formatDuration(total)}</span>
    ) : null
  })()}
  {saveStatus === 'saving' && <span className="muted small">Saving…</span>}
  {saveStatus === 'saved' && <span className="muted small" style={{ color: 'var(--success, green)' }}>Saved</span>}
  {saveStatus === 'error' && <span className="muted small" style={{ color: 'var(--error, red)' }}>Error</span>}
  <button
    type="button"
    onClick={(e) => { e.stopPropagation(); onRemove() }}
    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 0.25rem', opacity: 0.45, lineHeight: 1, fontSize: '1rem' }}
    aria-label="Remove subject"
  >
    ×
  </button>
</div>
```

- [ ] **Step 5: Pass subject totals up from SubjectRow to LevelCard**

`LevelCard` needs the total minutes per level to show the level chip. The cleanest approach: add an `onTotalChange` callback to `SubjectRow` that fires whenever `sessions` changes.

Update `SubjectRowProps`:
```typescript
interface SubjectRowProps {
  course: Course
  isLast: boolean
  onRemove: () => void
  onTotalChange: (courseId: string, totalMinutes: number) => void
}
```

Inside `SubjectRow`, add a `useEffect` that calls `onTotalChange` whenever sessions change:
```typescript
useEffect(() => {
  const total = sessions.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0)
  onTotalChange(course.id, total)
}, [sessions])
```

- [ ] **Step 6: Show level total chip in LevelCard header**

In `LevelCard` (line 306), add state to track subject totals and display a chip:

```typescript
function LevelCard({ level, assignedCourses, available, loadingCourses, onAdd, onRemove }: LevelCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [subjectTotals, setSubjectTotals] = useState<Record<string, number>>({})

  function handleSubjectTotal(courseId: string, total: number) {
    setSubjectTotals((prev) => ({ ...prev, [courseId]: total }))
  }

  const levelTotal = Object.values(subjectTotals).reduce((sum, t) => sum + t, 0)
  // ...
```

In the level header JSX, add the chip after the subject count span:
```tsx
<strong style={{ minWidth: '4.5rem' }}>Level {level}</strong>
<span className="muted small">
  {assignedCourses.length === 0 ? 'No subjects' : `${assignedCourses.length} subject${assignedCourses.length !== 1 ? 's' : ''}`}
</span>
{levelTotal > 0 && (
  <span style={{ background: '#e0f2fe', color: '#0369a1', fontSize: '0.78rem', padding: '2px 8px', borderRadius: '20px', fontWeight: 600, whiteSpace: 'nowrap' }}>
    ⏱ {formatDuration(levelTotal)}
  </span>
)}
```

And pass `onTotalChange` to each `SubjectRow`:
```tsx
<SubjectRow
  key={course.id}
  course={course}
  isLast={idx === assignedCourses.length - 1}
  onRemove={() => onRemove(course.id)}
  onTotalChange={handleSubjectTotal}
/>
```

- [ ] **Step 7: Verify tsc is clean**

```bash
cd platform && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git -C platform add src/pages/admin/PlanningPage.tsx
git -C platform commit -m "feat: show read-only duration totals in Planning Levels tab"
```

---

## Task 4: Level Goals (milestones) textarea

**Files:**
- Modify: `platform/src/pages/admin/PlanningPage.tsx`

Inside each expanded `LevelCard`, above the subjects list, add a Goals textarea. Load `milestones` from `planning_levels` when the card expands. Save with `setDoc(..., { merge: true })` on blur. Show a brief error on save failure (auto-clear after 4 seconds).

The `planning_levels` doc id is `level_${level}` — consistent with how `addCourse`/`removeCourse` already write to it.

- [ ] **Step 1: Add milestones state and load logic to LevelCard**

Update `LevelCard` to manage `milestones` and `milestonesError`:

```typescript
function LevelCard({ level, assignedCourses, available, loadingCourses, onAdd, onRemove }: LevelCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [subjectTotals, setSubjectTotals] = useState<Record<string, number>>({})
  const [milestones, setMilestones] = useState('')
  const [milestonesError, setMilestonesError] = useState('')
  const milestonesLoadedRef = useRef(false)

  function handleSubjectTotal(courseId: string, total: number) {
    setSubjectTotals((prev) => ({ ...prev, [courseId]: total }))
  }

  const levelTotal = Object.values(subjectTotals).reduce((sum, t) => sum + t, 0)

  async function handleExpand() {
    setExpanded((v) => !v)
    if (!milestonesLoadedRef.current) {
      milestonesLoadedRef.current = true
      try {
        const snap = await getDocs(query(collection(db, 'planning_levels'), where('level', '==', level)))
        snap.forEach((d) => {
          const x = d.data()
          setMilestones((x.milestones as string) ?? '')
        })
      } catch {
        // non-critical read — silently ignore
      }
    }
  }

  async function saveMilestones(value: string) {
    try {
      await setDoc(doc(db, 'planning_levels', `level_${level}`), { milestones: value }, { merge: true })
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to save goals'
      setMilestonesError(msg)
      setTimeout(() => setMilestonesError(''), 4000)
    }
  }
  // ...
```

- [ ] **Step 2: Update `onClick` on the level header to use `handleExpand`**

Replace `onClick={() => setExpanded((v) => !v)}` in the level header `<div>` with:
```tsx
onClick={() => void handleExpand()}
```

- [ ] **Step 3: Add the Goals textarea in the expanded body, above subjects**

Inside the `{expanded && (...)}` block in `LevelCard`, before the subjects list, add:

```tsx
{expanded && (
  <div>
    {/* Goals / Milestones */}
    <div style={{ padding: '0.75rem 1.25rem', background: '#fafafa', borderBottom: '1px solid var(--border, #e5e7eb)' }}>
      <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#6366f1', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        🏁 Level Goals
      </div>
      <textarea
        value={milestones}
        onChange={(e) => setMilestones(e.target.value)}
        onBlur={(e) => void saveMilestones(e.target.value)}
        placeholder={`What should a student achieve by the end of Level ${level}?`}
        style={{
          width: '100%',
          border: '1px solid var(--border, #d1d5db)',
          borderRadius: '6px',
          padding: '0.5rem 0.65rem',
          fontSize: '0.88rem',
          resize: 'vertical',
          minHeight: '64px',
          fontFamily: 'inherit',
          color: '#374151',
          boxSizing: 'border-box',
        }}
      />
      {milestonesError && (
        <p style={{ color: 'var(--error, red)', fontSize: '0.8rem', margin: '0.25rem 0 0' }}>{milestonesError}</p>
      )}
    </div>

    {/* Subjects */}
    {assignedCourses.length === 0 ? (
      <p className="muted small" style={{ padding: '1rem 1.25rem', margin: 0 }}>No subjects assigned to this level yet.</p>
    ) : (
      assignedCourses.map((course, idx) => (
        <SubjectRow
          key={course.id}
          course={course}
          isLast={idx === assignedCourses.length - 1}
          onRemove={() => onRemove(course.id)}
          onTotalChange={handleSubjectTotal}
        />
      ))
    )}
  </div>
)}
```

- [ ] **Step 4: Verify tsc is clean**

```bash
cd platform && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git -C platform add src/pages/admin/PlanningPage.tsx
git -C platform commit -m "feat: add Level Goals textarea with milestones auto-save"
```

---

## Final verification

- [ ] Run dev server and open `/admin/planning` → Levels tab
- [ ] Expand a level card — Goals textarea appears, placeholder shows "Level N"
- [ ] Type in Goals textarea, click away — no error, value persists on page reload
- [ ] Go to `/admin/syllabus`, open a session editor — "Duration (min)" input is present
- [ ] Set a duration (e.g. 45), save the session
- [ ] Back in Planning → Levels, expand the level containing that subject and open the subject — session row shows `45m`
- [ ] Subject header shows `⏱ 45m`, level header chip shows the same
- [ ] Set durations summing to ≥ 60 min — confirm `1h 30m` format (no trailing `0m` for even hours)
- [ ] Final `tsc --noEmit` clean
