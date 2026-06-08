# Admin Planning Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an admin page at `/admin/planning` where admins can drag-and-drop sessions within a course to reorder them, persisting the new order to Firestore.

**Architecture:** A single page component reads courses on mount, loads sessions for the selected course, and renders them as a drag-and-drop list using the HTML5 Drag and Drop API. On drag-end, the component updates local state optimistically and writes each session's new `order` value (0-based index) to Firestore via `updateDoc`.

**Tech Stack:** React 19, TypeScript, Firebase Firestore v12, React Router v7, Vite (no test framework — verification via `tsc --noEmit` and manual browser checks)

---

## Files

| Action | Path | Purpose |
|--------|------|---------|
| Create | `platform/src/pages/admin/PlanningPage.tsx` | New page component |
| Modify | `platform/src/App.tsx` | Add `/admin/planning` route |
| Modify | `platform/src/components/AppShell.tsx` | Add "Planning" nav link (sidebar + bottom nav) |

---

## Task 1: Add the route in App.tsx

**Files:**
- Modify: `platform/src/App.tsx`

- [ ] **Step 1: Import PlanningPage (lazy) and add the route**

In `platform/src/App.tsx`, add a lazy import alongside the other admin imports at the top of the file:

```tsx
const PlanningPage = lazy(() =>
  import('./pages/admin/PlanningPage').then((m) => ({ default: m.PlanningPage })),
)
```

Then inside the `<Route path="admin">` block (after the `reports` route), add:

```tsx
<Route
  path="planning"
  element={
    <Suspense fallback={<AdminRouteFallback />}>
      <PlanningPage />
    </Suspense>
  }
/>
```

- [ ] **Step 2: Type-check**

```bash
cd platform && npx tsc --noEmit
```

Expected: errors only about the missing `PlanningPage` module (acceptable at this step — the file doesn't exist yet).

- [ ] **Step 3: Commit**

```bash
git add platform/src/App.tsx
git commit -m "feat: add /admin/planning route"
```

---

## Task 2: Add nav links in AppShell.tsx

**Files:**
- Modify: `platform/src/components/AppShell.tsx`

- [ ] **Step 1: Add sidebar nav link for admin**

In `platform/src/components/AppShell.tsx`, inside the `{isAdmin && <> ... </>}` sidebar block, add after the Syllabus link (line 33):

```tsx
<NavLink to="/admin/planning" className={nl}>🗂️ Planning</NavLink>
```

- [ ] **Step 2: Add bottom nav link for admin (mobile)**

Inside the bottom-nav `{isAdmin && <> ... </>}` block, add after the Syllabus link (line 65):

```tsx
<NavLink to="/admin/planning" className={bnl}><span className="bn-icon">🗂️</span><span className="bn-label">Planning</span></NavLink>
```

- [ ] **Step 3: Type-check**

```bash
cd platform && npx tsc --noEmit
```

Expected: same module-not-found error for PlanningPage (still fine — file not created yet). No new errors.

- [ ] **Step 4: Commit**

```bash
git add platform/src/components/AppShell.tsx
git commit -m "feat: add Planning nav link for admin"
```

---

## Task 3: Create PlanningPage — course selector and session list (static)

**Files:**
- Create: `platform/src/pages/admin/PlanningPage.tsx`

- [ ] **Step 1: Create the file with course loading and session fetching**

Create `platform/src/pages/admin/PlanningPage.tsx` with this full content:

```tsx
import { useEffect, useState } from 'react'
import { collection, doc, getDocs, query, updateDoc, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import type { Course, Session } from '../../types'
import { readTopicsFromSessionDoc } from '../../lib/topics'

export function PlanningPage() {
  const [courses, setCourses] = useState<Course[]>([])
  const [selectedCourseId, setSelectedCourseId] = useState('')
  const [sessions, setSessions] = useState<Session[]>([])
  const [loadingCourses, setLoadingCourses] = useState(true)
  const [loadingSessions, setLoadingSessions] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      try {
        const snap = await getDocs(collection(db, 'courses'))
        const list: Course[] = []
        snap.forEach((d) => {
          const x = d.data()
          list.push({ id: d.id, title: (x.title as string) ?? '' })
        })
        list.sort((a, b) => a.title.localeCompare(b.title))
        setCourses(list)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load courses')
      } finally {
        setLoadingCourses(false)
      }
    })()
  }, [])

  async function loadSessions(courseId: string) {
    setLoadingSessions(true)
    setError('')
    setSessions([])
    try {
      const snap = await getDocs(query(collection(db, 'sessions'), where('courseId', '==', courseId)))
      const list: Session[] = []
      snap.forEach((d) => {
        const x = d.data()
        list.push({
          id: d.id,
          title: (x.title as string) ?? '',
          subtitle: (x.subtitle as string) ?? '',
          courseId: (x.courseId as string) ?? null,
          courseName: (x.courseName as string) ?? '',
          order: Number(x.order ?? 0),
          activities: readTopicsFromSessionDoc(x.activities),
        })
      })
      list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      setSessions(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load sessions')
    } finally {
      setLoadingSessions(false)
    }
  }

  function handleCourseChange(courseId: string) {
    setSelectedCourseId(courseId)
    if (courseId) void loadSessions(courseId)
    else setSessions([])
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <h1 style={{ margin: 0 }}>🗂️ Planning</h1>
          <p className="muted small" style={{ margin: '0.2rem 0 0' }}>Drag sessions to reorder them within a course.</p>
        </div>
        {saveStatus === 'saving' && <span className="muted small">Saving…</span>}
        {saveStatus === 'saved' && <span className="muted small" style={{ color: 'var(--success, green)' }}>Saved</span>}
        {saveStatus === 'error' && <span className="muted small" style={{ color: 'var(--error, red)' }}>Save failed</span>}
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <select
          value={selectedCourseId}
          onChange={(e) => handleCourseChange(e.target.value)}
          disabled={loadingCourses}
          style={{ minWidth: 240 }}
        >
          <option value="">
            {loadingCourses ? 'Loading courses…' : 'Select a course…'}
          </option>
          {courses.map((c) => (
            <option key={c.id} value={c.id}>{c.title}</option>
          ))}
        </select>
      </div>

      {error && <p className="error">{error}</p>}

      {!selectedCourseId && !loadingCourses && (
        <div className="panel" style={{ textAlign: 'center', padding: '2.5rem' }}>
          <p style={{ fontSize: '2.5rem', margin: 0 }}>🗂️</p>
          <h3>Select a course to start planning</h3>
          <p className="muted">Choose a course above to see and reorder its sessions.</p>
        </div>
      )}

      {loadingSessions && <p className="muted">Loading…</p>}

      {selectedCourseId && !loadingSessions && sessions.length === 0 && !error && (
        <p className="muted">No sessions found for this course.</p>
      )}

      <SessionList
        sessions={sessions}
        setSessions={setSessions}
        setSaveStatus={setSaveStatus}
        setError={setError}
      />
    </div>
  )
}

interface SessionListProps {
  sessions: Session[]
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>
  setSaveStatus: React.Dispatch<React.SetStateAction<'idle' | 'saving' | 'saved' | 'error'>>
  setError: React.Dispatch<React.SetStateAction<string>>
}

function SessionList({ sessions, setSessions, setSaveStatus, setError }: SessionListProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)

  if (sessions.length === 0) return null

  function handleDragStart(index: number) {
    setDragIndex(index)
  }

  function handleDragOver(e: React.DragEvent, index: number) {
    e.preventDefault()
    setOverIndex(index)
  }

  function handleDragEnd() {
    if (dragIndex === null || overIndex === null || dragIndex === overIndex) {
      setDragIndex(null)
      setOverIndex(null)
      return
    }

    const reordered = [...sessions]
    const [moved] = reordered.splice(dragIndex, 1)
    reordered.splice(overIndex, 0, moved)
    const withOrder = reordered.map((s, i) => ({ ...s, order: i }))
    const rollback = sessions

    setSessions(withOrder)
    setDragIndex(null)
    setOverIndex(null)

    void saveOrder(withOrder, rollback, setSessions, setSaveStatus, setError)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {sessions.map((session, index) => (
        <div
          key={session.id}
          draggable
          onDragStart={() => handleDragStart(index)}
          onDragOver={(e) => handleDragOver(e, index)}
          onDragEnd={handleDragEnd}
          className="panel"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            padding: '0.75rem 1rem',
            cursor: 'grab',
            opacity: dragIndex === index ? 0.4 : 1,
            outline: overIndex === index && dragIndex !== index ? '2px solid var(--primary, #6366f1)' : 'none',
            userSelect: 'none',
          }}
        >
          <span style={{ color: 'var(--muted, #9ca3af)', fontSize: '1.1rem', cursor: 'grab' }}>⠿</span>
          <span className="muted small" style={{ minWidth: '1.5rem', textAlign: 'right' }}>{index + 1}</span>
          <div style={{ flex: 1 }}>
            <strong>{session.title}</strong>
            {session.subtitle && <p className="muted small" style={{ margin: '0.1rem 0 0' }}>{session.subtitle}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}

async function saveOrder(
  ordered: Session[],
  rollback: Session[],
  setSessions: React.Dispatch<React.SetStateAction<Session[]>>,
  setSaveStatus: React.Dispatch<React.SetStateAction<'idle' | 'saving' | 'saved' | 'error'>>,
  setError: React.Dispatch<React.SetStateAction<string>>,
) {
  setSaveStatus('saving')
  try {
    await Promise.all(
      ordered.map((s) => updateDoc(doc(db, 'sessions', s.id), { order: s.order }))
    )
    setSaveStatus('saved')
    setTimeout(() => setSaveStatus('idle'), 2000)
  } catch (e) {
    setSaveStatus('error')
    setError(e instanceof Error ? e.message : 'Failed to save order')
    setSessions(rollback)
  }
}
```

- [ ] **Step 2: Type-check**

```bash
cd platform && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manual browser check**

```bash
cd platform && npm run dev
```

1. Sign in as an admin.
2. Click "Planning" in the sidebar — you should land on `/admin/planning`.
3. The page shows the "Select a course" empty state.
4. Open the course dropdown — all courses should appear.
5. Select a course — sessions should load and render as cards with drag handles.
6. "No sessions found" should appear for an empty course.

- [ ] **Step 4: Commit**

```bash
git add platform/src/pages/admin/PlanningPage.tsx
git commit -m "feat: admin planning page with course selector and session list"
```

---

## Task 4: Verify drag-and-drop reordering and Firestore save

**Files:**
- No code changes — manual verification only

- [ ] **Step 1: Verify drag reorder in browser**

With the dev server running:

1. Go to `/admin/planning`, select a course with multiple sessions.
2. Drag a session card to a new position — the list should reorder immediately.
3. The dragged card should appear semi-transparent while dragging; the target slot should get a colored outline.
4. After dropping, the header should briefly show "Saving…" then "Saved".

- [ ] **Step 2: Verify Firestore persistence**

1. After reordering, hard-refresh the page.
2. Select the same course — sessions should appear in the new order.
3. Open the Firebase console → Firestore → `sessions` collection → confirm `order` field updated on the moved docs.

- [ ] **Step 3: Verify error rollback (optional)**

Temporarily disable network in DevTools → drag a session → "Save failed" should appear in the header.

- [ ] **Step 4: Type-check one final time**

```bash
cd platform && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Final commit**

```bash
git add platform/src/pages/admin/PlanningPage.tsx platform/src/App.tsx platform/src/components/AppShell.tsx
git commit -m "feat: complete admin planning page with drag-and-drop session reorder"
```
