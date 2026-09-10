# Syllabus Builder Redesign — Design Spec
**Date:** 2026-07-30  
**Status:** Approved

---

## Goal

Redesign the Syllabus Builder layout to match a modern educational LMS: a lean 280px courses sidebar on the left and a spacious sessions builder panel on the right, giving maximum screen real estate to the content-building area.

---

## Layout

Replace the current `syllabus-columns` flex container with a CSS grid:

```css
.sb-layout {
  display: grid;
  grid-template-columns: 280px 1fr;
  gap: 1.5rem;
  align-items: start;
}
```

- Fills `.main` naturally — no `max-width` constraint or `justify-content: center`
- `align-items: start` so both columns scroll independently
- Mobile (`≤768px`): single column, sidebar stacks above builder

The page-level `<h1>Syllabus Builder</h1>`, notice banner, and error message remain above the grid, unchanged.

---

## Left: Courses Sidebar (`.sb-sidebar`)

A bare list — no card box-shadow. Structure:

```
[Courses label + "+ Course" button]
[Inline create form — shown when addingCourse]
[Course item list]
```

### Course Items

Each course renders as a compact row:

```
[icon]  [title]          [⋮]
        [N sessions pill]
```

- **Icon**: emoji auto-cycled by course index from `['📚','🧬','🧮','🎵','🏛️','🔬','🎨','💻']`
- **Session count pill**: `N sessions` — sourced from a `sessionCounts: Map<courseId, number>` loaded at startup
- **Active state**: 3px primary-colour left border + `var(--primary-soft)` background
- **⋮ button**: hidden by default (`opacity: 0`), revealed on row hover (`opacity: 1`)
- **⋮ menu**: single item — "Delete course" — triggers `deleteCourse(course)` with `window.confirm`

### Session Count Preload

`loadCourses()` is extended to also fetch all sessions in one `getDocs(collection(db, 'sessions'))` call, building `Map<courseId, count>` stored in a new `sessionCounts` state variable. This avoids N+1 queries.

### New `deleteCourse(course)` Function

```ts
async function deleteCourse(c: Course) {
  if (!window.confirm(`Delete "${c.title}"? This cannot be undone.`)) return
  await deleteDoc(doc(db, 'courses', c.id))
  if (selectedCourseId === c.id) setSelectedCourseId(null)
  await loadCourses()
}
```

Note: does not cascade-delete sessions. Sessions for a deleted course become orphaned (acceptable — consistent with current behaviour for manual Firestore ops).

### Inline Create Form

Stays in the sidebar below the header. Unchanged fields (`title`, `description`). Visually tightened to fit the 280px column.

---

## Right: Sessions Builder Panel (`.sb-builder`)

A single panel card (`background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow)`) with internal sections.

### Course Context Header

Shown when a course is selected:

```
📘  Music Theory                    [📥 Import]  [+ Session]
    Advanced concepts for students
    ● 7 sessions
────────────────────────────────────────────────────────────
```

- Course icon (same emoji from sidebar) + title in display font, large
- Description (if present) in muted small text
- Session count pill (`N sessions`)
- Import and `+ Session` buttons right-aligned in the same row as the title
- Subtle `border-bottom` divider separating header from tab bar / session list

### Tab Bar

Existing Sessions | Exam tabs — unchanged logic, just re-styled to sit below the course context header inside the builder panel.

### Sessions List

Existing `syllabus-lesson-list` / `syllabus-lesson` / `topic-timeline` markup and CSS are **unchanged**. The builder panel provides extra padding around them.

### Empty State (no course selected)

```
          📋
   Select a course
   to start building
   ← Choose from the sidebar
```

Centred, muted, fills the builder panel.

### Session Form

Existing form markup unchanged — renders as a panel inside the builder, same as today.

---

## CSS Changes

### New classes (additions to `index.css`)

| Class | Purpose |
|---|---|
| `.sb-layout` | Replaces `syllabus-columns` — CSS grid `280px 1fr` |
| `.sb-sidebar` | Left courses column — no card style, just spacing |
| `.sb-sidebar-header` | Flex row: label + "+ Course" button |
| `.sb-sidebar-list` | `list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.25rem` |
| `.sb-sidebar-item` | Course row — flex, hover reveals ⋮, active border |
| `.sb-sidebar-item.active` | Primary left border + primary-soft bg |
| `.sb-sidebar-item-icon` | Emoji icon, `1.35rem` |
| `.sb-sidebar-item-body` | Flex column: title + count pill |
| `.sb-sidebar-item-title` | `font-weight: 650; font-size: 0.93rem` |
| `.sb-sidebar-count` | Session count pill — small badge |
| `.sb-sidebar-menu` | `.topic-menu-wrap` reuse for ⋮ |
| `.sb-builder` | Right panel — card style |
| `.sb-builder-header` | Course title row + action buttons |
| `.sb-builder-course-title` | Display font, `1.4rem` |
| `.sb-builder-divider` | `border-bottom: 1px solid var(--border); margin: 1rem 0` |
| `.sb-builder-empty` | Centred empty-state block |

### Removed / retired classes

`syllabus-columns`, `syllabus-col`, `syllabus-col-wide` are no longer used in `SyllabusPage.tsx`. Their CSS rules remain in `index.css` (they're used by `MentorDashboard`'s syllabus route which also renders `SyllabusPage`). No CSS deletion needed.

### Mobile

```css
@media (max-width: 768px) {
  .sb-layout { grid-template-columns: 1fr; }
}
```

---

## Files Changed

| File | Change |
|---|---|
| `src/pages/admin/SyllabusPage.tsx` | New layout markup, sidebar items with icon/count/⋮, builder header, `deleteCourse`, session count preload in `loadCourses` |
| `src/index.css` | Add `.sb-layout`, `.sb-sidebar-*`, `.sb-builder-*` rules |

No changes to: `ExamManager.tsx`, topic-timeline/editor CSS, import logic, session form, `types.ts`, Firestore data model.

---

## Non-Goals

- No drag-to-reorder courses in the sidebar
- No cascade-delete of sessions when a course is deleted
- No icon/level picker UI — icons are auto-assigned by index
- No server-side session count — counts come from the preload query at page load
