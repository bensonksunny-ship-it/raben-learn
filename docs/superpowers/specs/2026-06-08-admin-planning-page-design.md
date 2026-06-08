# Admin Planning Page — Design Spec

**Date:** 2026-06-08  
**Status:** Approved

---

## Overview

A new admin page at `/admin/planning` that lets admins drag-and-drop sessions within a course to reorder them. Reordering persists by writing updated `order` values to Firestore.

This page is separate from the existing `SyllabusPage` (`/admin/syllabus`), which handles session content editing. The Planning page is purely about sequencing.

---

## Route & File

- **Route:** `/admin/planning` — added to the `<Route path="admin">` block in `App.tsx`
- **Component:** `src/pages/admin/PlanningPage.tsx`
- **Nav:** Add "Planning" link to the admin navigation alongside existing admin links

---

## Data Flow

1. On mount: fetch all documents from the `courses` Firestore collection.
2. Admin selects a course from a dropdown.
3. Fetch all sessions where `courseId == selectedCourseId` from the `sessions` collection.
4. Sort sessions by `session.order` ascending (fall back to Firestore document order if `order` is absent).
5. Render as a draggable list.
6. On drag-end: update local state immediately (optimistic), then write the new `order` (0-based index) to each session document via `updateDoc`.

---

## UI

### Header
- `<h1>Planning</h1>` with a muted subtitle: "Drag sessions to reorder them within a course."
- Course `<select>` dropdown populated from Firestore courses.
- Subtle save-status indicator: "Saving…" during write, "Saved" on success, hidden otherwise.

### Session List
Each session renders as a card containing:
- Drag handle icon (⠿) on the left
- Session number (1-based index)
- Session title (bold)
- Session subtitle (muted, if present)

Dragging uses the **HTML5 Drag and Drop API** — no additional library required.

### Empty & Loading States
- Before course selection: "Select a course to start planning."
- After selection, while loading: "Loading…"
- Course with no sessions: "No sessions found for this course."

---

## Firestore Writes

- Collection: `sessions`
- Field written: `order` (number, 0-based index)
- Trigger: drag-end event
- Method: one `updateDoc` call per session in the list (no batch API needed given typical session counts < 50)
- No schema changes required — `order` already exists on the `Session` type

---

## Error Handling

- If the Firestore write fails, show an inline error message and revert local state to the pre-drag order.
- Fetch errors display an inline error string, consistent with the rest of the app.

---

## Out of Scope

- Moving sessions between courses
- Reordering topics/activities within a session (that belongs in SyllabusPage)
- Milestone markers or calendar views
- Multi-course views
