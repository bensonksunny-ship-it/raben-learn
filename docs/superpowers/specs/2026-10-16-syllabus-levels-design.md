# Grade Levels for Syllabus & Planning — Design

Status: draft, pending user review of this document.

## Goal

Introduce **Level** (0 = "Basement", 1–10 = like school classes) as the top
organizing layer above Subjects. Each level has its own independent subjects
— "Math" at Level 3 and "Math" at Level 5 are separate content, not shared.

This also **unifies** Planning and Syllabus Builder's two separate, currently
inconsistent notions of "level":
- Planning today: one subject has many skill-progression levels (e.g.
  English → Level 1 "Speak Clearly", Level 2 "...").
- This design: Level is the top container; "English at Level 2" *is* the
  subject, and its description/outcome is a property of that one subject,
  not an array of sub-levels underneath it.

After this, both pages organize around the same Level → Subject structure;
they just offer different editors over it (see UI section).

## Why this reuses almost everything already built

Sessions, Topics, and the Exam system are already keyed by `courseId`, not
by anything level-related. Tagging each `Course` with a `levelId` makes
every session, topic, and exam *automatically* level-scoped for free —
nothing about `Session`, `Topic`, `ExamConfig`, `ExamQuestion`, or
`ExamAttempt` needs to change.

## Data model

```ts
// A fixed range, not a Firestore-backed/renameable entity — same pattern as
// `Weekday`/`WEEKDAYS` elsewhere in this codebase. 11 fixed levels, display
// names hardcoded, no admin UI to add/remove levels (not asked for; YAGNI).
export type LevelId = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
const LEVELS: LevelId[] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
function levelName(id: LevelId): string { return id === 0 ? 'Basement' : `Level ${id}` }

export interface Course {
  id: string
  title: string
  description?: string
  createdAt?: unknown
  /** null = not yet migrated/assigned — see Migration below. Every course
   *  created through the new UI always has one; this is purely a transition
   *  state for data that predates this feature. */
  levelId: LevelId | null
  /** Absorbed from Planning's old `SubjectLevel.coreOutcome` — the outcome
   *  expected of a student who completes this subject at this level. */
  coreOutcome?: string
}
```

`Session`, `Topic`, `ExamConfig`, `ExamQuestion`, `ExamAttempt`: **unchanged**.

## Migration (manual step, not automatic — explicit confirmation before running)

Two existing things need to move, neither of them automatically inferable:

1. **Existing `courses` docs have no level.** They all become `levelId: null`
   ("Unassigned") on deploy. An admin manually assigns each one to a level
   through the new UI — there's no way to guess "Math" belongs in Level 3
   vs Level 5 from existing data. The new Syllabus/Planning UIs both get an
   "Unassigned" bucket so these are easy to find and re-home, one at a time.
2. **Existing `planning_subjects` docs** (`{ name, levels: [{id, level, name,
   coreOutcome}] }`) need their `coreOutcome` text copied onto the matching
   `(levelId, subject name)` course — or, where no matching course exists
   yet, used to *create* one. This is a real data transform, not a schema
   no-op, and **must not run automatically** — I'll check what's actually in
   that collection on the live project first, then propose the exact mapping
   for sign-off before writing anything. The old collection is left in place
   (unused, not deleted) until that's confirmed done and you explicitly say
   to remove it.

## UI

**Syllabus Builder** (`/admin/syllabus`) — full content editor, unchanged
below the top layer:
- New top strip: Level picker (`Basement`, `Level 1` … `Level 10`,
  `Unassigned`), replacing "pick a subject" as the first interaction.
- Selecting a level filters the existing Subjects column to
  `courses.levelId === selected`. "+ Subject" creates a course pre-tagged
  with that level.
- Everything right of that (Sessions, Topics, the Exam tab) — **unchanged**.

**Planning** (`/admin/planning`) — lightweight outcomes editor, re-scoped to
the same data instead of its own collection:
- Same Level picker at top, same filtered Subjects list.
- Selecting a subject edits just `title` + `coreOutcome` — no
  sessions/topics here, same lightweight feel Planning has today.

Two pages stay separate (matching today's nav — "Syllabus" vs "Planning"
remain distinct links) since they serve different editing depths; nothing
asked for merging them into one screen.

## Explicit non-goals (this pass — flagged assumptions, not confirmed)

- **Students are not assigned a level.** "My Courses" keeps showing a
  student's enrolled courses regardless of level — no `UserProfile` change.
  *(This was the one open question from our chat that "ok" didn't
  explicitly answer — flagging it here so it's visible on review rather
  than silently assumed.)*
- No admin UI to add/rename/remove levels beyond the fixed 0–10 range.
- No change to Exam, Session, or Topic data shapes — they inherit
  level-scoping for free through `courseId`.
- `planning_subjects` collection is not deleted by this work — only
  stops being written to, pending your explicit go-ahead to remove it.
