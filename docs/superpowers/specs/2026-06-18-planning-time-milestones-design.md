# Planning Page — Time & Milestones Design Spec

**Date:** 2026-06-18  
**Status:** Approved

---

## Overview

Two additions to the Planning page's Levels tab, plus a small change to the Syllabus page:

1. **Time Planning** — Each session gets a `durationMinutes` field. Admins set it in the Syllabus page. The Levels tab shows read-only time totals per subject and per level.
2. **Level Milestones** — Each level card gets a free-form Goals textarea. Admins type what students should achieve by the end of that level. Auto-saved on blur.

---

## Firestore Schema Changes

### `sessions` collection
Add field: `durationMinutes: number` (default `0`)  
Written by: Syllabus page  
Read by: Levels tab in Planning page

### `planning_levels` collection
Add field: `milestones: string` (default `""`)  
Written by: Levels tab (Goals textarea, on blur)  
Read by: Levels tab on load (already fetched)

---

## Files Changed

| File | Change |
|------|--------|
| `platform/src/types.ts` | Add `durationMinutes?: number` to `Session` interface |
| `platform/src/pages/admin/SyllabusPage.tsx` | Add "Duration (min)" number input to session editor, saves `durationMinutes` via `updateDoc` |
| `platform/src/pages/admin/PlanningPage.tsx` | Show per-session duration, subject subtotals, level totals; add Goals textarea per level |

---

## Syllabus Page Change

In the session editor (where session title/subtitle are edited), add a number input:

- Label: `Duration (min)`
- Type: `number`, min `0`, step `5`
- Default: `0`
- Saves: `updateDoc(sessionRef, { durationMinutes: value })` on change (debounced 500ms or on blur)
- Displayed alongside existing session metadata fields

---

## Levels Tab Changes

### Session rows
Each session card inside an expanded `SubjectRow` gains a right-aligned grey label:
- `30 min` if `durationMinutes > 0`
- Nothing shown if `durationMinutes === 0` (avoids cluttering unset sessions)

### Subject row header
Right of the subject title, show the subject's total time:
- Sum of `durationMinutes` across all sessions in that subject
- Format: `⏱ 2h 00m` for ≥ 60 min, `⏱ 45m` for < 60 min
- Only shown if total > 0

### Level card header
Right of the subject count chip, show the level's total time:
- Sum of all subject totals within that level
- Format: `⏱ 4h 30m` (same formatter)
- Displayed as a blue chip: `background: #e0f2fe; color: #0369a1`
- Only shown if total > 0

### Goals textarea (milestones)
Inside each expanded level card, above the subject list:

- Section label: `🏁 Level Goals` (small, muted, uppercase)
- Plain `<textarea>`, min-height `64px`, resizable vertically
- Placeholder: `"What should a student achieve by the end of Level N?"`
- Loaded from `planning_levels.milestones` on expand
- Saved via `setDoc(planningLevelRef, { milestones: value }, { merge: true })` on blur
- Optimistic — no loading indicator needed

---

## Time Formatting

Shared helper function `formatDuration(minutes: number): string`:
- `0` → `""` (empty, caller hides the element)
- `< 60` → `"45m"`
- `≥ 60` → `"2h 30m"` (omit `0m` suffix: `"2h"` not `"2h 00m"`)

---

## Error Handling

- Syllabus duration save failure: show inline error near the input (consistent with existing Syllabus error pattern)
- Milestones save failure: show a brief error message below the textarea, auto-clear after 4 seconds
- No error handling needed for read-only time display (if a session has no `durationMinutes`, it's treated as 0)

---

## Out of Scope

- Editing `durationMinutes` from the Levels tab (read-only there)
- Rich text / bullet-list milestones (plain textarea for now)
- Roadmap tab (separate spec)
- Prerequisites (separate spec)
