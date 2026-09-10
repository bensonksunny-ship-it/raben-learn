# Syllabus Builder Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Syllabus Builder's flex layout with a modern LMS-style 2-column grid — lean 280px courses sidebar on the left, full-width sessions builder panel on the right.

**Architecture:** Pure UI restructure across two files. `index.css` gets new `.sb-*` CSS classes; `SyllabusPage.tsx` gets new JSX layout and two new data functions (`deleteCourse`, extended `loadCourses`). No Firestore schema changes, no changes to session/topic forms, ExamManager, or import logic.

**Tech Stack:** React 18, TypeScript, Vite, Firestore v9 modular SDK, plain CSS custom properties.

## Global Constraints

- CSS custom properties (colors, radius, shadow, fonts) from `:root` in `index.css` — never hardcode values that have a variable
- `var(--font-display)` for headings, `var(--font-body)` for body text
- No new npm packages
- Keep existing `topic-timeline`, `topic-editor`, `syllabus-mini-form` CSS untouched — they are used inside the new builder panel
- `syllabus-columns` / `syllabus-col` CSS rules stay in `index.css` — the mentor route also renders `SyllabusPage` and may still reference them

---

### Task 1: Add `.sb-*` CSS classes to `index.css`

**Files:**
- Modify: `platform/src/index.css` (append after the existing `sb-sessions-section` block near line 427)

**Interfaces:**
- Produces: all CSS classes consumed by Tasks 3 and 4

- [ ] **Step 1: Open `index.css` and locate the insertion point**

Find the line:
```css
@media (max-width: 600px) {
  .sb-course-grid { grid-template-columns: 1fr; }
}
```
The new block goes **after** that closing `}`.

- [ ] **Step 2: Append the new CSS block**

Add exactly this after the block found in Step 1:

```css
/* ── Syllabus Builder redesign ──────────────────────────────── */
.sb-layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 1.5rem;
  align-items: start;
}

/* Sidebar */
.sb-sidebar { min-width: 0; }
.sb-sidebar-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.85rem;
}
.sb-sidebar-label {
  font-size: 0.72rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.07em;
  color: var(--muted-2);
}
.sb-sidebar-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}
.sb-sidebar-item {
  display: flex;
  align-items: center;
  border-left: 3px solid transparent;
  border-radius: 10px;
  transition: background 0.15s, border-color 0.15s;
  position: relative;
}
.sb-sidebar-item:hover { background: var(--surface-soft); }
.sb-sidebar-item.active {
  border-left-color: var(--primary);
  background: var(--primary-soft);
}
.sb-sidebar-item-btn {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 0.4rem 0.55rem 0.6rem;
  border-radius: 8px;
  font-family: var(--font-body);
  text-align: left;
}
.sb-sidebar-item-icon { font-size: 1.25rem; flex-shrink: 0; line-height: 1; }
.sb-sidebar-item-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 0.12rem;
}
.sb-sidebar-item-title {
  font-weight: 650;
  font-size: 0.9rem;
  color: var(--text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}
.sb-sidebar-item.active .sb-sidebar-item-title { color: var(--primary); }
.sb-sidebar-count { font-size: 0.72rem; color: var(--muted-2); font-weight: 500; }
.sb-sidebar-item .topic-menu-btn { opacity: 0; transition: opacity 0.15s; }
.sb-sidebar-item:hover .topic-menu-btn { opacity: 1; }

/* Builder panel */
.sb-builder {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  padding: 1.5rem;
  min-width: 0;
}
.sb-builder-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
  margin-bottom: 1rem;
}
.sb-builder-course-info { flex: 1; min-width: 0; }
.sb-builder-course-title {
  font-family: var(--font-display);
  font-optical-sizing: auto;
  font-size: 1.4rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--text);
  margin: 0 0 0.25rem;
  display: flex;
  align-items: center;
  gap: 0.45rem;
  line-height: 1.2;
}
.sb-builder-course-desc {
  font-size: 0.85rem;
  color: var(--muted);
  margin: 0 0 0.35rem;
  line-height: 1.45;
}
.sb-builder-course-meta { font-size: 0.78rem; color: var(--muted-2); font-weight: 500; }
.sb-builder-actions { display: flex; gap: 0.4rem; flex-shrink: 0; align-items: center; }
.sb-builder-divider {
  border: none;
  border-top: 1px solid var(--border);
  margin: 0 0 1rem;
}
.sb-builder-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem 2rem;
  text-align: center;
  color: var(--muted-2);
}
.sb-builder-empty-icon { font-size: 2.5rem; margin-bottom: 0.75rem; opacity: 0.5; }

@media (max-width: 768px) {
  .sb-layout { grid-template-columns: 1fr; }
}
```

- [ ] **Step 3: Run the dev server and confirm no CSS errors**

```bash
cd "/Users/bensonksunny/Desktop/Raben learn/platform" && npm run dev
```

Open the app in a browser. Navigate to `/admin/syllabus`. The page should render (layout may look odd until Tasks 3–4 update the JSX). No console CSS parse errors.

- [ ] **Step 4: Commit**

```bash
git add platform/src/index.css
git commit -m "style: add sb-layout, sb-sidebar-*, sb-builder-* CSS for syllabus redesign"
```

---

### Task 2: Extend `loadCourses()` + add `deleteCourse()` + `COURSE_ICONS` constant

**Files:**
- Modify: `platform/src/pages/admin/SyllabusPage.tsx`

**Interfaces:**
- Consumes: `deleteDoc`, `doc` from `firebase/firestore` (already imported)
- Produces:
  - `const COURSE_ICONS: readonly string[]` — used by Tasks 3 & 4
  - `sessionCounts: Map<string, number>` state — used by Task 3
  - `deleteCourse(c: Course): Promise<void>` — called from Task 3's ⋮ menu

- [ ] **Step 1: Add `COURSE_ICONS` constant at the top of the file**

After the `import` block (around line 10), before `function newTopic`, add:

```typescript
const COURSE_ICONS = ['📚', '🧬', '🧮', '🎵', '🏛️', '🔬', '🎨', '💻'] as const
```

- [ ] **Step 2: Add `sessionCounts` state**

Inside `SyllabusPage()`, after the existing `const [rightTab, setRightTab] = useState<'sessions' | 'exam'>('sessions')` line, add:

```typescript
const [sessionCounts, setSessionCounts] = useState<Map<string, number>>(new Map())
```

- [ ] **Step 3: Extend `loadCourses()` to parallel-fetch session counts**

Replace the existing `loadCourses` function:

```typescript
async function loadCourses() {
  const [coursesSnap, sessionsSnap] = await Promise.all([
    getDocs(collection(db, 'courses')),
    getDocs(collection(db, 'sessions')),
  ])
  const list: Course[] = []
  coursesSnap.forEach((d) => {
    const x = d.data()
    list.push({ id: d.id, title: (x.title as string) ?? '', description: (x.description as string) ?? '' })
  })
  list.sort((a, b) => a.title.localeCompare(b.title))
  setCourses(list)

  const counts = new Map<string, number>()
  sessionsSnap.forEach((d) => {
    const cid = (d.data().courseId as string) ?? ''
    if (cid) counts.set(cid, (counts.get(cid) ?? 0) + 1)
  })
  setSessionCounts(counts)
}
```

- [ ] **Step 4: Add `deleteCourse()` function**

After the `loadCourses` function, add:

```typescript
async function deleteCourse(c: Course) {
  if (!window.confirm(`Delete "${c.title}"? This cannot be undone.`)) return
  setError('')
  try {
    await deleteDoc(doc(db, 'courses', c.id))
    if (selectedCourseId === c.id) setSelectedCourseId(null)
    await loadCourses()
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to delete course')
  }
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd "/Users/bensonksunny/Desktop/Raben learn/platform" && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add platform/src/pages/admin/SyllabusPage.tsx
git commit -m "feat: add COURSE_ICONS, sessionCounts preload, deleteCourse to SyllabusPage"
```

---

### Task 3: Rebuild the courses sidebar JSX

**Files:**
- Modify: `platform/src/pages/admin/SyllabusPage.tsx`

**Interfaces:**
- Consumes: `COURSE_ICONS`, `sessionCounts`, `deleteCourse` from Task 2
- Produces: `<aside className="sb-sidebar">` — left column of the new `.sb-layout` grid

**Context:** The current JSX `return` block starts with `<div>` containing `<h1>`, notices, error, then `<div className="syllabus-columns">` which holds two child divs. We are replacing the entire `syllabus-columns` block with `<div className="sb-layout">` containing `<aside className="sb-sidebar">` and `<div className="sb-builder">`. The outer `<div>`, `<h1>`, notice banner, and error `<p>` stay exactly as-is.

- [ ] **Step 1: Locate the `syllabus-columns` div in the return block**

It is at line ~339 in the current file:
```tsx
<div className="syllabus-columns">
```
And it closes at line ~582 just before the `addTopicSessionId` modal backdrop.

- [ ] **Step 2: Replace the opening tag and the entire courses panel**

Replace from `<div className="syllabus-columns">` through the closing `</div>` of the courses panel div (the `</div>` just before `{/* SESSIONS */}`), with this:

```tsx
<div className="sb-layout">
  {/* COURSES SIDEBAR */}
  <aside className="sb-sidebar">
    <div className="sb-sidebar-header">
      <span className="sb-sidebar-label">Courses</span>
      <button
        type="button"
        className="btn small primary"
        onClick={() => { setAddingCourse((v) => !v); setError('') }}
      >
        {addingCourse ? '✕ Cancel' : '+ Course'}
      </button>
    </div>

    {addingCourse && (
      <form onSubmit={(e) => void createCourse(e)} className="form syllabus-mini-form">
        <input
          placeholder="Course title *"
          value={newCourseTitle}
          onChange={(e) => setNewCourseTitle(e.target.value)}
          required
          autoFocus
        />
        <input
          placeholder="Description (optional)"
          value={newCourseDesc}
          onChange={(e) => setNewCourseDesc(e.target.value)}
        />
        <div className="row">
          <button type="submit" className="btn small primary" disabled={saving}>Save</button>
          <button type="button" className="btn small secondary" onClick={() => setAddingCourse(false)}>Cancel</button>
        </div>
      </form>
    )}

    <ul className="sb-sidebar-list">
      {courses.map((c, idx) => (
        <li key={c.id} className={`sb-sidebar-item${selectedCourseId === c.id ? ' active' : ''}`}>
          <button
            type="button"
            className="sb-sidebar-item-btn"
            onClick={() => setSelectedCourseId(c.id)}
          >
            <span className="sb-sidebar-item-icon">
              {COURSE_ICONS[idx % COURSE_ICONS.length]}
            </span>
            <span className="sb-sidebar-item-body">
              <span className="sb-sidebar-item-title">{c.title}</span>
              <span className="sb-sidebar-count">
                {(sessionCounts.get(c.id) ?? 0)} session{(sessionCounts.get(c.id) ?? 0) !== 1 ? 's' : ''}
              </span>
            </span>
          </button>
          <div className="topic-menu-wrap" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="topic-menu-btn"
              onClick={() => setOpenMenuId(openMenuId === `course-${c.id}` ? null : `course-${c.id}`)}
              title="Course options"
            >⋮</button>
            {openMenuId === `course-${c.id}` && (
              <div className="topic-menu-dropdown">
                <button
                  type="button"
                  className="topic-menu-item danger"
                  onClick={() => { setOpenMenuId(null); void deleteCourse(c) }}
                >Delete</button>
              </div>
            )}
          </div>
        </li>
      ))}
      {courses.length === 0 && (
        <li className="muted small" style={{ padding: '0.75rem 0.5rem' }}>No courses yet.</li>
      )}
    </ul>
  </aside>
```

Note: `.sb-layout` is left open here — the old sessions panel code below it still provides the closing `</div>` temporarily, so the file compiles. Task 4 replaces that entire sessions block (including its closing tag) with the new builder panel + proper closing tag.

- [ ] **Step 3: Check the dev server for JSX errors**

The page will look broken until Task 4 adds the builder panel, but there should be no red TypeScript/JSX compile errors in the terminal.

- [ ] **Step 4: Commit**

```bash
git add platform/src/pages/admin/SyllabusPage.tsx
git commit -m "feat: rebuild SyllabusPage courses sidebar with sb-sidebar layout"
```

---

### Task 4: Rebuild the sessions builder panel JSX

**Files:**
- Modify: `platform/src/pages/admin/SyllabusPage.tsx`

**Interfaces:**
- Consumes: `COURSE_ICONS`, `sessionCounts`, `sessions`, `selectedCourse`, `selectedCourseId` — all already in component state/scope
- Produces: `<div className="sb-builder">` — right column of `.sb-layout`, closes the grid

**Context:** Replace the old `{selectedCourseId ? (<div className="syllabus-col syllabus-col-wide">…</div>) : null}` block and the closing `</div>` of `syllabus-columns` with the new builder panel + closing `</div>` of `sb-layout`.

The existing content inside the sessions panel (tab bar, session form, `syllabus-lesson-list`, ExamManager) is **kept exactly as-is**. Only the wrapper structure and header change.

- [ ] **Step 1: Locate and replace the sessions panel**

Find the block starting with:
```tsx
        {/* SESSIONS */}
        {selectedCourseId ? (
          <div className="syllabus-col syllabus-col-wide">
            <div className="syllabus-col-header">
              <h2>📝 Sessions</h2>
              <div className="row">
                <label className="btn small ghost" ...>
```

And ending with:
```tsx
          </div>
        ) : null}
      </div>
```
(the final `</div>` closes `syllabus-columns`)

Replace **that entire block** with:

```tsx
  {/* BUILDER PANEL */}
  <div className="sb-builder">
    {!selectedCourseId ? (
      <div className="sb-builder-empty">
        <div className="sb-builder-empty-icon">📋</div>
        <div style={{ fontWeight: 600, fontSize: '1rem', marginBottom: '0.35rem', color: 'var(--text)' }}>
          Select a course to start building
        </div>
        <div className="muted small">← Choose from the sidebar</div>
      </div>
    ) : (
      <>
        {/* Course context header */}
        <div className="sb-builder-header">
          <div className="sb-builder-course-info">
            <div className="sb-builder-course-title">
              <span>{COURSE_ICONS[Math.max(0, courses.findIndex((c) => c.id === selectedCourseId)) % COURSE_ICONS.length]}</span>
              {selectedCourse?.title}
            </div>
            {selectedCourse?.description && (
              <p className="sb-builder-course-desc">{selectedCourse.description}</p>
            )}
            <span className="sb-builder-course-meta">
              {sessions.length} session{sessions.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div className="sb-builder-actions">
            <label className="btn small secondary" style={{ cursor: 'pointer' }} title="Import sessions from Excel">
              {importing ? '⏳…' : '📥 Import'}
              <input
                ref={xlsxInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImportCourse(f) }}
              />
            </label>
            <button type="button" className="btn small primary" onClick={openNewSessionForm}>
              + Session
            </button>
          </div>
        </div>
        <hr className="sb-builder-divider" />

        {/* Tab bar */}
        {isAdminOrMentor && (
          <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.75rem', borderBottom: '2px solid var(--border)' }}>
            {(['sessions', 'exam'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setRightTab(t)}
                style={{
                  padding: '0.4rem 0.85rem',
                  border: 'none',
                  borderBottom: rightTab === t ? '2px solid var(--primary)' : '2px solid transparent',
                  background: 'none',
                  color: rightTab === t ? 'var(--primary)' : 'var(--muted-2)',
                  fontWeight: rightTab === t ? 700 : 400,
                  cursor: 'pointer',
                  fontSize: '0.86rem',
                  marginBottom: '-2px',
                }}
              >
                {t === 'sessions' ? '📋 Sessions' : '📝 Exam'}
              </button>
            ))}
          </div>
        )}

        {rightTab === 'sessions' && (
          <>
            <div className="muted small" style={{ marginBottom: '0.75rem', lineHeight: 1.6 }}>
              <strong style={{ color: 'var(--text)' }}>Session Excel format:</strong>&nbsp;
              Session title (single cell) → optional subtitle → <code>SL no · Topic · Type · Remark</code> → data rows
            </div>
            {importResult ? <p className="notice" style={{ marginBottom: '0.5rem' }}>{importResult}</p> : null}

            {sessionFormOpen ? (
              <div className="panel" style={{ marginBottom: '1rem' }}>
                <h3 style={{ marginBottom: '0.75rem' }}>{editingSessionId ? '✏️ Edit session' : '✨ New session'}</h3>
                <form onSubmit={(e) => void saveSession(e)} className="form">
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
                    <label style={{ flex: 1 }}>Session title<input value={sessionTitle} onChange={(e) => setSessionTitle(e.target.value)} placeholder="e.g. Session-1" required /></label>
                    <label style={{ width: 90, flexShrink: 0 }}>Order<input type="number" value={sessionOrder} onChange={(e) => setSessionOrder(Number(e.target.value))} min={1} /></label>
                    <label style={{ width: 110, flexShrink: 0 }}>Duration (min)<input type="number" value={sessionDuration} min={0} step={5} onChange={(e) => setSessionDuration(Number(e.target.value))} /></label>
                  </div>
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <h4 style={{ margin: 0 }}>Topics</h4>
                      <div className="row">
                        <button type="button" className="btn small ghost" onClick={() => setSessionTopics((p) => [...p, newTopic('concept')])}>+ Concept</button>
                        <button type="button" className="btn small ghost" onClick={() => setSessionTopics((p) => [...p, newTopic('exercise')])}>+ Exercise</button>
                      </div>
                    </div>
                    <p className="muted small" style={{ margin: '0 0 0.5rem' }}>
                      Topics appear in the student syllabus in this exact order. Mix Concepts and Exercises freely.
                    </p>
                    <ol className="topic-editor-list">
                      {sessionTopics.map((t, i) => {
                        const colors = topicTypeColor(t.type)
                        return (
                          <li key={t.id} className="topic-editor-row" style={{ borderLeftColor: colors.bg }}>
                            <span className="topic-editor-index muted small">{i + 1}</span>
                            <select
                              value={t.type}
                              onChange={(e) => updateTopic(i, { type: e.target.value as TopicType })}
                              aria-label="Topic type"
                            >
                              <option value="concept">Concept</option>
                              <option value="exercise">Exercise</option>
                            </select>
                            <input
                              placeholder={`${topicTypeLabel(t.type)} title *`}
                              value={t.title}
                              onChange={(e) => updateTopic(i, { title: e.target.value })}
                            />
                            <input
                              placeholder="Remark (optional)"
                              value={t.remark ?? ''}
                              onChange={(e) => updateTopic(i, { remark: e.target.value })}
                            />
                            <div className="topic-editor-actions">
                              <button type="button" className="btn small ghost" title="Move up" disabled={i === 0} onClick={() => moveTopic(i, -1)}>↑</button>
                              <button type="button" className="btn small ghost" title="Move down" disabled={i === sessionTopics.length - 1} onClick={() => moveTopic(i, 1)}>↓</button>
                              <button type="button" className="btn small ghost" onClick={() => removeTopic(i)} disabled={sessionTopics.length === 1} title="Remove">✕</button>
                            </div>
                          </li>
                        )
                      })}
                    </ol>
                  </div>
                  <div className="row">
                    <button type="submit" className="btn primary" disabled={saving}>{saving ? 'Saving…' : editingSessionId ? 'Update' : 'Create'}</button>
                    <button type="button" className="btn ghost" onClick={() => setSessionFormOpen(false)}>Cancel</button>
                  </div>
                </form>
              </div>
            ) : null}

            <ul className="syllabus-lesson-list">
              {sessions.map((s) => {
                const conceptCount = s.activities.filter((t) => t.type === 'concept').length
                const exerciseCount = s.activities.length - conceptCount
                return (
                  <li key={s.id} className="syllabus-lesson syllabus-session-card">
                    <div className="row syllabus-session-head">
                      <div>
                        <strong className="syllabus-session-title">{s.order}. {s.title}</strong>
                        <span className="muted small syllabus-session-meta">
                          {s.activities.length} topic{s.activities.length === 1 ? '' : 's'}
                          {s.activities.length > 0 ? ` · ${conceptCount} concept${conceptCount === 1 ? '' : 's'}, ${exerciseCount} exercise${exerciseCount === 1 ? '' : 's'}` : ''}
                          {(s.durationMinutes ?? 0) > 0 ? ` · ${s.durationMinutes} min` : ''}
                        </span>
                      </div>
                      <div className="actions syllabus-session-actions">
                        <button type="button" className="btn small ghost" onClick={() => openAddTopic(s)} disabled={saving}>+ Topic</button>
                        <button type="button" className="btn small ghost" onClick={() => openEditSessionForm(s)}>Edit</button>
                        <button type="button" className="btn small ghost" onClick={() => void deleteSession(s.id)}>Delete</button>
                      </div>
                    </div>

                    {s.activities.length === 0 ? (
                      <p className="muted small" style={{ margin: '0.25rem 0 0' }}>No topics yet.</p>
                    ) : (
                      <ol className="topic-timeline">
                        {s.activities.map((t, idx) => {
                          const colors = topicTypeColor(t.type)
                          return (
                            <li key={t.id} className={`topic-timeline-row${t.completed ? ' topic-done' : ''}`}>
                              <span className="topic-timeline-index muted small">{idx + 1}</span>
                              <button
                                type="button"
                                className={`topic-complete-btn${t.completed ? ' done' : ''}`}
                                onClick={() => void updateTopicInline(s, t.id, { completed: !t.completed })}
                                disabled={saving}
                                title={t.completed ? 'Mark incomplete' : 'Mark complete'}
                              >
                                {t.completed ? '✓' : ''}
                              </button>
                              <span className="topic-timeline-badge" style={{ background: colors.bg, color: colors.text }}>
                                {topicTypeLabel(t.type)}
                              </span>
                              <span className={`topic-timeline-title${t.completed ? ' topic-title-done' : ''}`}>
                                {t.title}
                                {t.remark ? <span className="muted"> — {t.remark}</span> : null}
                              </span>
                              <div className="topic-menu-wrap">
                                <button
                                  type="button"
                                  className="topic-menu-btn"
                                  onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === t.id ? null : t.id) }}
                                  disabled={saving}
                                  title="Options"
                                >⋮</button>
                                {openMenuId === t.id && (
                                  <div className="topic-menu-dropdown" onClick={(e) => e.stopPropagation()}>
                                    <button
                                      type="button"
                                      className="topic-menu-item"
                                      onClick={() => { void updateTopicInline(s, t.id, { type: t.type === 'concept' ? 'exercise' : 'concept' }); setOpenMenuId(null) }}
                                      disabled={saving}
                                    >
                                      {t.type === 'concept' ? 'Exercise' : 'Concept'}
                                    </button>
                                    <button
                                      type="button"
                                      className="topic-menu-item"
                                      onClick={() => { void quickEditTopicTitle(s, t); setOpenMenuId(null) }}
                                      disabled={saving}
                                    >Edit</button>
                                    <button
                                      type="button"
                                      className="topic-menu-item danger"
                                      onClick={() => { void deleteTopicInline(s, t.id); setOpenMenuId(null) }}
                                      disabled={saving}
                                    >Delete</button>
                                  </div>
                                )}
                              </div>
                            </li>
                          )
                        })}
                      </ol>
                    )}
                  </li>
                )
              })}
              {sessions.length === 0 && <li className="muted small" style={{ padding: '0.5rem 0' }}>No sessions yet.</li>}
            </ul>
          </>
        )}
        {rightTab === 'exam' && selectedCourseId && <ExamManager courseId={selectedCourseId} />}
      </>
    )}
  </div>
</div>
```

- [ ] **Step 2: Verify TypeScript compiles cleanly**

```bash
cd "/Users/bensonksunny/Desktop/Raben learn/platform" && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Manual verification in browser**

Visit `/admin/syllabus` and check:

1. **Desktop layout**: Sidebar is ~280px wide on the left; builder panel fills remaining width
2. **Empty state**: "Select a course to start building" centred in the builder panel when no course is selected
3. **Course selection**: Clicking a course highlights it with blue left border + soft background; builder panel shows course title (display font), description, session count
4. **Course icons**: Each course shows a different emoji from the set; cycles if more than 8 courses
5. **Session count pills**: Show correct count in the sidebar (matches sessions in Firestore)
6. **⋮ menu on courses**: Hidden by default, visible on hover; clicking opens dropdown with "Delete"; confirm dialog fires before deletion; deleted course deselects if it was active
7. **+ Course form**: Opens inline below sidebar header; saves and closes correctly
8. **+ Session / Import buttons**: Right-aligned in the builder header; function correctly
9. **Session form**: Opens inside the builder panel correctly
10. **Topics, ⋮ menus, complete buttons**: All unchanged and functional
11. **Exam tab**: Renders ExamManager correctly
12. **Mobile (≤768px)**: Grid collapses to single column, sidebar stacks above builder

- [ ] **Step 4: Commit**

```bash
git add platform/src/pages/admin/SyllabusPage.tsx
git commit -m "feat: rebuild SyllabusPage builder panel with sb-builder layout and course context header"
```
