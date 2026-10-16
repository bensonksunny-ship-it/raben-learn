# Grade Levels for Syllabus & Planning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `Level` (0 "Basement" through 10) as the top organizing layer above
Subjects in Syllabus Builder and Planning, each level having its own independent
subjects, and unify Planning's old per-subject skill-levels into this single concept.

**Architecture:** `Course` gains a `levelId: LevelId | null` field and a
`coreOutcome?: string` field. Sessions/Topics/Exam stay keyed by `courseId` and need
no changes — they inherit level-scoping for free. Syllabus Builder and Planning both
grow a Level-picker tab strip above their existing Subjects column and filter by it.
Planning stops being its own `planning_subjects` collection and becomes a lightweight
title+outcome editor over the same `courses` collection Syllabus Builder uses.

**Tech Stack:** React 19 + TypeScript (`platform/`), Firebase (Firestore + Hosting, no
Cloud Functions or rules changes needed for this plan). No test framework exists in
this repo — verification throughout is `npm run build` (`tsc -b && vite build`),
`npm run lint`, and a manual check against the deployed app at
`https://raben-learn.web.app` (there is no local dev/emulator flow established for
this project; every other feature this session was verified this way).

**Spec:** `docs/superpowers/specs/2026-10-16-syllabus-levels-design.md`

## Global Constraints

- 11 fixed levels (0–10), not Firestore-backed, no admin UI to add/remove them —
  same fixed-list pattern as `Weekday`/`WEEKDAYS` elsewhere in this codebase.
- `Session`, `Topic`, `ExamConfig`, `ExamQuestion`, `ExamAttempt` — **do not modify**.
  They stay keyed by `courseId` only.
- Students are **not** assigned a level in this plan — "My Courses" keeps showing
  enrolled courses regardless of level (spec's explicit non-goal).
- `planning_subjects` collection is **never deleted** by this plan — only stops being
  written to. Removing it is a separate, later decision requiring its own sign-off.
- Task 4's data migration requires an explicit human confirmation mid-task before any
  write happens — it is not autonomous like the other tasks. Do not skip that step.

---

### Task 1: `Course` gains a level — type, shared mapper, every call site

**Files:**
- Modify: `platform/src/types.ts` (the `Course` interface, currently at line 68)
- Create: `platform/src/lib/levels.ts`
- Create: `platform/src/lib/courses.ts`
- Modify (one-line call-site fix each): `platform/src/pages/student/StudentDailyPlanner.tsx:176`, `platform/src/pages/admin/UserManagement.tsx:74`, `platform/src/pages/admin/StudentsPage.tsx:61-64`, `platform/src/pages/admin/SyllabusPage.tsx:66-75`, `platform/src/pages/student/StudentDashboard.tsx:37`, `platform/src/pages/student/StudentCoursesPage.tsx:29`, `platform/src/pages/admin/ReportsPage.tsx:39`, `platform/src/pages/admin/AdminDashboard.tsx:52`, `platform/src/pages/mentor/MentorStudentProgress.tsx:54`, `platform/src/pages/mentor/MentorDashboard.tsx:34`

**Interfaces:**
- Produces: `LevelId` type (`types.ts`), `LEVELS: LevelId[]` + `levelName(id: LevelId): string` + `isLevelId(v: unknown): v is LevelId` (`lib/levels.ts`), `mapCourseDoc(docSnap: QueryDocumentSnapshot<DocumentData>): Course` (`lib/courses.ts`). Tasks 2 and 3 both import `LEVELS`, `levelName`, `mapCourseDoc`.

- [ ] **Step 1: Add `LevelId` and extend `Course` in `types.ts`**

In `platform/src/types.ts`, add this new type right before the `Course` interface (currently line 68), and extend `Course` itself:

```ts
/** Grade/class level — 0 ("Basement") through 10. Fixed range, not Firestore-backed
 *  (same pattern as `Weekday`/`WEEKDAYS`) — no admin UI to add/remove levels. */
export type LevelId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10

export interface Course {
  id: string
  title: string
  description?: string
  createdAt?: unknown
  /** null = not yet migrated/assigned to a level — see the migration task. Every
   *  course created through the Syllabus Builder or Planning UI always has one. */
  levelId: LevelId | null
  /** The outcome expected of a student who completes this subject at this level.
   *  Edited from the Planning page. */
  coreOutcome?: string
}
```

- [ ] **Step 2: Create `platform/src/lib/levels.ts`**

```ts
import type { LevelId } from '../types'

export const LEVELS: LevelId[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

export function levelName(id: LevelId): string {
  return id === 0 ? 'Basement' : `Level ${id}`
}

/** Runtime guard for values coming from Firestore or a <select>'s string value. */
export function isLevelId(v: unknown): v is LevelId {
  return typeof v === 'number' && LEVELS.includes(v as LevelId)
}
```

- [ ] **Step 3: Create `platform/src/lib/courses.ts`**

```ts
import type { QueryDocumentSnapshot, DocumentData } from 'firebase/firestore'
import { isLevelId } from './levels'
import type { Course } from '../types'

/** Single source of truth for reading a `courses/{id}` doc — every page that lists
 *  courses uses this, so `levelId`/`coreOutcome` can never be silently dropped. */
export function mapCourseDoc(docSnap: QueryDocumentSnapshot<DocumentData>): Course {
  const x = docSnap.data()
  return {
    id: docSnap.id,
    title: (x.title as string) ?? '',
    description: (x.description as string) ?? '',
    levelId: isLevelId(x.levelId) ? x.levelId : null,
    coreOutcome: (x.coreOutcome as string) ?? '',
  }
}
```

- [ ] **Step 4: Fix each of the 10 call sites**

Every one of these follows the same shape: a `.forEach((d) => { ... push a
hand-built object ... })` that needs to become `.forEach((d) => list.push(mapCourseDoc(d)))`
(using whichever local variable name — `list`, `cl`, `courseList` — that file already
uses). Add `import { mapCourseDoc } from '../../lib/courses'` to each file (adjust the
relative path if a file is one directory shallower/deeper than `pages/admin/`).

`platform/src/pages/student/StudentDailyPlanner.tsx:176` — before:
```ts
snap.forEach((d) => { const x = d.data(); list.push({ id: d.id, title: (x.title as string) ?? '' }) })
```
after:
```ts
snap.forEach((d) => list.push(mapCourseDoc(d)))
```

`platform/src/pages/admin/UserManagement.tsx:74` — before:
```ts
snap.forEach((d) => { const x = d.data(); list.push({ id: d.id, title: (x.title as string) ?? '' }) })
```
after:
```ts
snap.forEach((d) => list.push(mapCourseDoc(d)))
```

`platform/src/pages/admin/StudentsPage.tsx` (around lines 61–64) — before:
```ts
coursesSnap.forEach((d) => {
  const x = d.data()
  cl.push({ id: d.id, title: (x.title as string) ?? '' })
})
```
after:
```ts
coursesSnap.forEach((d) => cl.push(mapCourseDoc(d)))
```

`platform/src/pages/admin/SyllabusPage.tsx` (`loadCourses`, lines 66–75) — before:
```ts
async function loadCourses() {
  const snap = await getDocs(collection(db, 'courses'))
  const list: Course[] = []
  snap.forEach((d) => {
    const x = d.data()
    list.push({ id: d.id, title: (x.title as string) ?? '', description: (x.description as string) ?? '' })
  })
  list.sort((a, b) => a.title.localeCompare(b.title))
  setCourses(list)
}
```
after:
```ts
async function loadCourses() {
  const snap = await getDocs(collection(db, 'courses'))
  const list: Course[] = []
  snap.forEach((d) => list.push(mapCourseDoc(d)))
  list.sort((a, b) => a.title.localeCompare(b.title))
  setCourses(list)
}
```

`platform/src/pages/student/StudentDashboard.tsx:37`,
`platform/src/pages/student/StudentCoursesPage.tsx:29` — both currently:
```ts
courseList.push({ id: d.id, title: (x.title as string) ?? '', description: (x.description as string) ?? '' })
```
become:
```ts
courseList.push(mapCourseDoc(d))
```

`platform/src/pages/admin/ReportsPage.tsx:39`,
`platform/src/pages/admin/AdminDashboard.tsx:52`,
`platform/src/pages/mentor/MentorDashboard.tsx:34` — all currently:
```ts
coursesSnap.forEach((d) => { const x = d.data(); courseList.push({ id: d.id, title: (x.title as string) ?? '' }) })
```
become:
```ts
coursesSnap.forEach((d) => courseList.push(mapCourseDoc(d)))
```

`platform/src/pages/mentor/MentorStudentProgress.tsx:54` — currently:
```ts
coursesSnap.forEach((d) => { const x = d.data(); courseList.push({ id: d.id, title: (x.title as string) ?? '', description: (x.description as string) ?? '' }) })
```
becomes:
```ts
coursesSnap.forEach((d) => courseList.push(mapCourseDoc(d)))
```

In every file above, once `mapCourseDoc` is used, check whether the local `const x =
d.data()` line is now unused in that scope — delete it if so (`noUnusedLocals` is on
in this project's `tsconfig.app.json` and will fail the build otherwise).

- [ ] **Step 5: Verify — this is what proves no call site was missed**

Run: `cd platform && npm run build`
Expected: `tsc -b && vite build` succeeds with no errors. Because `levelId` is a
required (non-optional) field on `Course`, `tsc` will fail on any object literal that
still hand-builds a `Course` without it — so a clean build here is the actual proof
every site was fixed, not just the ones listed above.

Run: `npm run lint`
Expected: same baseline as before this change — 6 pre-existing `react-hooks/exhaustive-deps`
warnings in `StudentsPage.tsx`, `ExamInstructions.tsx`, `ExamRunner.tsx`, 0 errors.

- [ ] **Step 6: Commit**

```bash
cd "/Users/bensonksunny/Desktop/Raben learn"
git add platform/src/types.ts platform/src/lib/levels.ts platform/src/lib/courses.ts \
  platform/src/pages/student/StudentDailyPlanner.tsx platform/src/pages/admin/UserManagement.tsx \
  platform/src/pages/admin/StudentsPage.tsx platform/src/pages/admin/SyllabusPage.tsx \
  platform/src/pages/student/StudentDashboard.tsx platform/src/pages/student/StudentCoursesPage.tsx \
  platform/src/pages/admin/ReportsPage.tsx platform/src/pages/admin/AdminDashboard.tsx \
  platform/src/pages/mentor/MentorStudentProgress.tsx platform/src/pages/mentor/MentorDashboard.tsx
git commit -m "feat: add levelId/coreOutcome to Course, centralize mapCourseDoc

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: Syllabus Builder — Level picker

**Files:**
- Modify: `platform/src/pages/admin/SyllabusPage.tsx`

**Interfaces:**
- Consumes: `LEVELS`, `levelName` from `lib/levels.ts`; `Course.levelId` from Task 1.
- Produces: nothing new consumed by other tasks — this is UI-only.

- [ ] **Step 1: Import the level helpers and the `LevelId` type**

At the top of `SyllabusPage.tsx`, change:
```ts
import { normalizeTopicType, type Course, type Session, type Topic, type TopicType } from '../../types'
```
to:
```ts
import { normalizeTopicType, type Course, type LevelId, type Session, type Topic, type TopicType } from '../../types'
import { LEVELS, levelName } from '../../lib/levels'
```

- [ ] **Step 2: Add level-filter state, right after the existing `courses`/`selectedCourseId` state**

```ts
type LevelFilter = LevelId | 'unassigned'
const [selectedLevel, setSelectedLevel] = useState<LevelFilter>(1)
```

- [ ] **Step 3: Reset the selected course when the level filter changes**

Add this effect near the other `useEffect` calls in the component:
```ts
useEffect(() => { setSelectedCourseId(null) }, [selectedLevel])
```
(A course from a different level shouldn't stay "selected" once it's filtered out of view.)

- [ ] **Step 4: Filter the courses list by the selected level**

Add this derived value right after `const selectedCourse = courses.find(...)`:
```ts
const visibleCourses = courses.filter((c) =>
  selectedLevel === 'unassigned' ? c.levelId === null : c.levelId === selectedLevel,
)
```

- [ ] **Step 5: Tag new courses with the currently selected level**

In `createCourse` (lines 107–116), change the `addDoc` call from:
```ts
await addDoc(collection(db, 'courses'), { title: newCourseTitle.trim(), description: newCourseDesc.trim(), createdAt: serverTimestamp() })
```
to:
```ts
await addDoc(collection(db, 'courses'), {
  title: newCourseTitle.trim(),
  description: newCourseDesc.trim(),
  levelId: selectedLevel === 'unassigned' ? null : selectedLevel,
  createdAt: serverTimestamp(),
})
```

- [ ] **Step 6: Render the level-tab strip above the two-column layout**

Immediately before `<div className="syllabus-columns">` (around line 436), insert:
```jsx
<div className="course-tabs" style={{ marginBottom: '0.85rem' }}>
  {LEVELS.map((lvl) => (
    <button key={lvl} type="button" className={`course-tab${selectedLevel === lvl ? ' active' : ''}`} onClick={() => setSelectedLevel(lvl)}>
      {levelName(lvl)}
    </button>
  ))}
  <button type="button" className={`course-tab${selectedLevel === 'unassigned' ? ' active' : ''}`} onClick={() => setSelectedLevel('unassigned')}>
    Unassigned
  </button>
</div>
```
This reuses the existing `.course-tabs`/`.course-tab` CSS already defined in
`platform/src/index.css` (built for `StudentDailyPlanner`'s add-activity modal) — no
new CSS needed.

- [ ] **Step 7: Render the filtered list instead of the full list**

In the Courses column (around line 454), change:
```jsx
{courses.map((c, idx) => (
```
to:
```jsx
{visibleCourses.map((c, idx) => (
```
And the empty state right below it, from:
```jsx
{courses.length === 0 ? <p className="muted small course-row-empty">No courses yet.</p> : null}
```
to:
```jsx
{visibleCourses.length === 0 ? <p className="muted small course-row-empty">No courses at this level yet.</p> : null}
```

- [ ] **Step 8: Verify**

Run: `cd platform && npm run build && npm run lint`
Expected: build succeeds, lint shows the same 6 pre-existing warnings, 0 errors.

- [ ] **Step 9: Manual check against the deployed app**

Build and deploy hosting only (no Functions/rules changes in this task):
```bash
cd "/Users/bensonksunny/Desktop/Raben learn"
firebase deploy --only hosting
```
Then in a browser at `https://raben-learn.web.app`, as an admin: open Syllabus
Builder, confirm the level tab strip appears above the columns, switching levels
filters the Subjects column, and creating a new subject while "Level 2" (or any
level) is active produces a course that shows up under that same level and nowhere
else.

- [ ] **Step 10: Commit**

```bash
git add platform/src/pages/admin/SyllabusPage.tsx
git commit -m "feat: level picker for Syllabus Builder's subjects column

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: Planning page — rewrite as a level-scoped outcomes editor

**Files:**
- Modify (full rewrite): `platform/src/pages/admin/PlanningPage.tsx`

**Interfaces:**
- Consumes: `LEVELS`, `levelName` (`lib/levels.ts`), `mapCourseDoc` (`lib/courses.ts`), `Course`/`LevelId` (`types.ts`) — all from Task 1.
- Produces: nothing consumed by later tasks.

This **replaces** Planning's entire current `Subject`/`SubjectLevel` ladder UI (the
add/edit/reorder/paste-import level cards) with a simple title+outcome editor over
`courses`. Planning intentionally does **not** get a delete button here — a course
reachable from Planning may already have real sessions/topics/exam content attached
in Syllabus Builder, so deleting a subject stays Syllabus Builder's responsibility,
where an admin can see what's attached before removing it.

- [ ] **Step 1: Replace the entire file**

Replace the full contents of `platform/src/pages/admin/PlanningPage.tsx` with:

```tsx
import { useEffect, useState, type FormEvent } from 'react'
import { addDoc, collection, doc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { LEVELS, levelName } from '../../lib/levels'
import { mapCourseDoc } from '../../lib/courses'
import type { Course, LevelId } from '../../types'

type LevelFilter = LevelId | 'unassigned'

/**
 * Lightweight outcomes editor over the same `courses` collection Syllabus Builder
 * uses — Planning only ever edits a course's title and core outcome here; sessions,
 * topics, and the exam tab stay in Syllabus Builder. No delete here on purpose: a
 * course reachable from Planning may already have real curriculum content attached.
 */
export function PlanningPage() {
  const [courses, setCourses] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [selectedLevel, setSelectedLevel] = useState<LevelFilter>(1)
  const [selectedCourseId, setSelectedCourseId] = useState<string | null>(null)

  const [addingCourse, setAddingCourse] = useState(false)
  const [newCourseTitle, setNewCourseTitle] = useState('')

  const visibleCourses = courses.filter((c) =>
    selectedLevel === 'unassigned' ? c.levelId === null : c.levelId === selectedLevel,
  )
  const selectedCourse = courses.find((c) => c.id === selectedCourseId) ?? null

  async function loadCourses() {
    try {
      const snap = await getDocs(collection(db, 'courses'))
      const list: Course[] = []
      snap.forEach((d) => list.push(mapCourseDoc(d)))
      list.sort((a, b) => a.title.localeCompare(b.title))
      setCourses(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load subjects')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadCourses() }, [])
  useEffect(() => { setSelectedCourseId(null) }, [selectedLevel])

  async function createCourse(e: FormEvent) {
    e.preventDefault()
    const title = newCourseTitle.trim()
    if (!title) return
    setSaving(true); setError('')
    try {
      const ref = await addDoc(collection(db, 'courses'), {
        title,
        levelId: selectedLevel === 'unassigned' ? null : selectedLevel,
        createdAt: serverTimestamp(),
      })
      setNewCourseTitle(''); setAddingCourse(false)
      await loadCourses()
      setSelectedCourseId(ref.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create subject')
    } finally {
      setSaving(false)
    }
  }

  async function saveOutcome(courseId: string, patch: { title?: string; coreOutcome?: string }) {
    setSaving(true); setError('')
    setCourses((prev) => prev.map((c) => (c.id === courseId ? { ...c, ...patch } : c)))
    try {
      await updateDoc(doc(db, 'courses', courseId), patch)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
      await loadCourses()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h1 style={{ margin: '0 0 0.35rem' }}>🗂️ Planning</h1>
      <p className="muted planning-intro">
        Pick a level, then a subject, to set the core outcome expected there. Sessions and topics are built in the Syllabus Builder.
      </p>
      {error ? <p className="error">{error}</p> : null}

      <div className="course-tabs" style={{ marginBottom: '0.85rem' }}>
        {LEVELS.map((lvl) => (
          <button key={lvl} type="button" className={`course-tab${selectedLevel === lvl ? ' active' : ''}`} onClick={() => setSelectedLevel(lvl)}>
            {levelName(lvl)}
          </button>
        ))}
        <button type="button" className={`course-tab${selectedLevel === 'unassigned' ? ' active' : ''}`} onClick={() => setSelectedLevel('unassigned')}>
          Unassigned
        </button>
      </div>

      <div className="syllabus-columns">
        {/* SUBJECTS */}
        <div className="syllabus-col">
          <div className="syllabus-col-header">
            <h2>📚 Subjects — {selectedLevel === 'unassigned' ? 'Unassigned' : levelName(selectedLevel)}</h2>
            <button type="button" className="btn small primary" onClick={() => setAddingCourse((v) => !v)}>+ Subject</button>
          </div>
          {addingCourse && (
            <form onSubmit={(e) => void createCourse(e)} className="form syllabus-mini-form">
              <input placeholder="Subject name *" value={newCourseTitle} onChange={(e) => setNewCourseTitle(e.target.value)} required autoFocus />
              <div className="row">
                <button type="submit" className="btn small primary" disabled={saving}>Save</button>
                <button type="button" className="btn small secondary" onClick={() => setAddingCourse(false)}>Cancel</button>
              </div>
            </form>
          )}
          {loading ? (
            <p className="muted small">Loading…</p>
          ) : (
            <ul className="syllabus-list">
              {visibleCourses.map((c) => (
                <li key={c.id} className={`syllabus-item${selectedCourseId === c.id ? ' active' : ''}`}>
                  <button type="button" className="syllabus-item-btn" onClick={() => setSelectedCourseId(c.id)}>
                    <span className="syllabus-item-title">{c.title}</span>
                    <span className="muted small syllabus-item-desc">{c.coreOutcome ? c.coreOutcome.slice(0, 60) : 'No core outcome yet'}</span>
                  </button>
                </li>
              ))}
              {visibleCourses.length === 0 ? <li className="muted small" style={{ padding: '0.5rem 0' }}>No subjects at this level yet.</li> : null}
            </ul>
          )}
        </div>

        {/* OUTCOME EDITOR */}
        {selectedCourse ? (
          <div className="syllabus-col syllabus-col-wide">
            <SubjectOutcomeEditor
              key={selectedCourse.id}
              course={selectedCourse}
              saving={saving}
              onSave={(patch) => void saveOutcome(selectedCourse.id, patch)}
            />
          </div>
        ) : (
          <div className="syllabus-col syllabus-col-wide" style={{ textAlign: 'center', padding: '2.5rem' }}>
            <p style={{ fontSize: '2.5rem', margin: 0 }}>🎯</p>
            <h3>Select a subject to set its outcome</h3>
            <p className="muted">Choose a subject on the left, or add a new one.</p>
          </div>
        )}
      </div>
    </div>
  )
}

interface SubjectOutcomeEditorProps {
  course: Course
  saving: boolean
  onSave: (patch: { title?: string; coreOutcome?: string }) => void
}

function SubjectOutcomeEditor({ course, saving, onSave }: SubjectOutcomeEditorProps) {
  const [title, setTitle] = useState(course.title)
  const [outcome, setOutcome] = useState(course.coreOutcome ?? '')

  return (
    <div>
      <div className="syllabus-col-header">
        <h2>🎯 {course.title}</h2>
        {saving ? <span className="level-save-status">Saving…</span> : null}
      </div>
      <form className="form" onSubmit={(e) => { e.preventDefault(); onSave({ title: title.trim(), coreOutcome: outcome.trim() }) }}>
        <label>Subject name
          <input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </label>
        <label>Core outcome
          <textarea
            placeholder="What should a student be able to do after completing this subject at this level?"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
            style={{ minHeight: 120 }}
          />
        </label>
        <div className="row">
          <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Run: `cd platform && npm run build && npm run lint`
Expected: build succeeds, lint shows the same 6 pre-existing warnings, 0 errors.
(The old `SubjectLevel`/`renumber`/`moveLevel`/`parseLevelsTsv`/`LevelEditor` code is
gone along with the whole old file — nothing else in the codebase imports from
`PlanningPage.tsx`, so this can't break another file.)

- [ ] **Step 3: Optional cleanup — remove now-orphaned CSS**

The old ladder UI's CSS classes (`.level-ladder`, `.level-badge`, `.level-card`,
`.level-card-body`, `.level-card-name`, `.level-card-outcome`, `.level-card-actions`,
`.level-add-card`, `.level-editor`, `.level-editor-row`, `.level-inline-confirm`,
`.level-icon-btn`, `.subject-delete-confirm`, `.planning-paste-toggle`,
`.planning-paste-box`, `.level-save-flash`) in `platform/src/index.css` are no longer
used anywhere. Before deleting each one, run `grep -rn "<class-name>" platform/src`
to confirm zero remaining references, then remove the rule. Keep `.level-save-status`
and `.level-save-status.saved` — the new editor still uses those two. This step is
cosmetic dead-code removal, not required for correctness — skip it under time
pressure and come back to it later if needed.

- [ ] **Step 4: Manual check against the deployed app**

```bash
cd "/Users/bensonksunny/Desktop/Raben learn"
firebase deploy --only hosting
```
Then as an admin at `https://raben-learn.web.app`: open Planning, confirm the same
level tabs appear, pick a level, add a subject, set its core outcome, save, reload
the page, and confirm the outcome persisted. Then open Syllabus Builder, switch to
that same level, and confirm the subject you just created there is visible (same
`courses` collection, both pages agree).

- [ ] **Step 5: Commit**

```bash
git add platform/src/pages/admin/PlanningPage.tsx platform/src/index.css
git commit -m "feat: rewrite Planning as a level-scoped outcomes editor over courses

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: Migrate `planning_subjects` data — requires a confirmation checkpoint

**Files:**
- Create (temporary, not committed): a one-off migration script — exact location and
  mechanism depend on what Firestore access is available at execution time (see
  Step 1). Delete the script after running it; it's not part of the app.

**Interfaces:**
- Consumes: the live `planning_subjects` collection (read-only until the confirmed
  write in Step 3) and the `courses` collection (`Course.coreOutcome`, from Task 1).
- Produces: nothing consumed by other tasks — this is a one-time data transform, not
  a reusable module.

**This task has a hard stop that the other three don't.** Do not write anything to
Firestore in this task until a human has explicitly confirmed the proposed mapping in
Step 2. If you are an autonomous executor and reach Step 2 with no way to get that
confirmation, stop and report back instead of proceeding.

- [ ] **Step 1: Read what's actually in `planning_subjects` on the live project**

The shape of each doc is `{ name: string, levels: [{ id, level, name, coreOutcome }] }`
(the old `SubjectLevel` shape Task 3 just removed the UI for — it still exists in
Firestore, untouched). Get the current contents by whichever of these actually works
in the execution environment:
- A small Node script using `firebase-admin` with Application Default Credentials
  (`admin.initializeApp({ credential: admin.credential.applicationDefault() })`,
  requires `gcloud auth application-default login` to have been run first) that reads
  `db.collection('planning_subjects').get()` and logs each doc.
- If ADC isn't set up and can't be, ask the user to export the collection from the
  Firebase Console (Firestore → `planning_subjects` → export, or just screenshot/copy
  the handful of documents if it's small) instead of trying to script around missing
  credentials.
- If the collection is empty or doesn't exist, skip straight to Step 4 — there's
  nothing to migrate, just confirm that with the user before closing out the task.

- [ ] **Step 2: STOP — present the proposed mapping and wait for explicit confirmation**

For each `planning_subjects` doc found, and each `level` entry inside it, propose:
*"`{subject name}` at `levelName({level number})` → course `{matching existing course
id, or 'NEW'}`, `coreOutcome` set to `{that level's coreOutcome text}`."* Show this
full list to the user. Do not proceed to Step 3 until they explicitly say to go
ahead — if anything about the proposed level number ↔ `LevelId` mapping, or which
existing course (if any) a subject should match, is ambiguous, ask rather than guess.

- [ ] **Step 3: Run the confirmed migration (only after Step 2's explicit go-ahead)**

For each confirmed mapping: if a matching course already exists, `updateDoc` to set
its `coreOutcome` (and `levelId` if it was still `null`); if none exists, `addDoc` a
new course with that `title`, `levelId`, and `coreOutcome`. Use the same credential
mechanism that worked in Step 1. Log every write as it happens so there's a record
of exactly what changed.

- [ ] **Step 4: Verify**

As an admin at `https://raben-learn.web.app`, open Planning, check each level that
had migrated data, and confirm the subjects and their core outcomes match what was
confirmed in Step 2.

- [ ] **Step 5: Decide what happens to the old collection — ask, don't assume**

`planning_subjects` is left in place, unused, per the Global Constraints. Tell the
user the migration is done and ask whether they want it deleted now or left alone;
do not delete it without a separate, explicit "yes."

- [ ] **Step 6: Commit (if the migration script was added to the repo temporarily)**

If a migration script was created inside the repo to do this, delete it (it's a
one-time tool, not app code) and commit that removal:
```bash
git add -A
git commit -m "chore: remove one-off planning_subjects migration script

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```
If the script lived entirely outside the repo (e.g. a scratch file), there's nothing
to commit for this step.
