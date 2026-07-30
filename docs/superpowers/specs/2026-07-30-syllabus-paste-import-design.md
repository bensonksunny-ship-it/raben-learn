# Syllabus Paste Import + Preview Table — Design Spec

**Date:** 2026-07-30  
**Status:** Approved  
**Scope:** Add a "Paste from Spreadsheet" import option to the syllabus builder, with a live preview table showing at least 10 rows, alongside the existing XLSX file import.

---

## Problem

The syllabus builder already supports Excel file import but requires the user to save their spreadsheet as a file first. Users want to copy cells directly from Excel or Google Sheets and paste them in — a faster, more natural flow. The pasted data should appear as a visible table before confirming import.

---

## Approach

Extend `SyllabusPage.tsx` with:
1. A "Paste Syllabus" button beside the existing import button
2. A modal with a `<textarea>` for paste input
3. A `parseTsv()` helper that converts tab-separated text → row objects, fed into the existing `parseRows()` function
4. A preview `<table>` inside the modal showing ≥10 rows before import is confirmed

No new backend logic. The import path after parsing is identical to the XLSX import flow.

---

## Expected Spreadsheet Format

Users paste from Excel or Google Sheets. The first row is treated as column headers (case-insensitive, trimmed). Expected columns (same as XLSX import):

| Column | Required | Notes |
|---|---|---|
| Session | Yes | Session title; repeated for each topic row in the session |
| Order | No | Numeric session order; inferred from row sequence if omitted |
| Duration | No | Session duration in minutes |
| Topic | Yes | Topic title |
| Type | No | `concept` or `exercise`; defaults to `exercise` if omitted/unrecognised |

Example paste (tab-separated):

```
Session	Order	Duration	Topic	Type
Intro to Python	1	60	Variables and Types	concept
Intro to Python	1	60	First Script	exercise
Data Structures	2	90	Lists	concept
Data Structures	2	90	Dicts	concept
```

---

## UI

### Trigger

A new "Paste Syllabus" button sits beside the existing "Import XLSX" button in the course header action bar. Same styling as the import button.

### Modal Layout

```
┌─────────────────────────────────────────────┐
│ Paste Syllabus                          [✕] │
├─────────────────────────────────────────────┤
│ Copy cells from Excel or Google Sheets and  │
│ paste below. First row must be headers:     │
│ Session · Order · Duration · Topic · Type   │
│                                             │
│ ┌─────────────────────────────────────────┐ │
│ │ <textarea> (paste here)                 │ │
│ │                                         │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ ── Preview ──────────────────────────────── │
│ ┌──────────────────────────────────────────┐│
│ │ #  Session        Topic       Type  Dur  ││
│ │ ── Intro to Python ───────── (60 min) ── ││
│ │ 1  Intro to Python Variables  concept    ││
│ │ 2  Intro to Python First Scri exercise   ││
│ │    (10 rows visible, scroll for more)    ││
│ └──────────────────────────────────────────┘│
│                                             │
│ ⚠ Error state: "Couldn't detect columns…"  │
│                                             │
│                   [Cancel]  [Import N rows] │
└─────────────────────────────────────────────┘
```

- The `<textarea>` auto-triggers parse on `paste` event (no manual "Parse" button needed)
- Preview table appears immediately after paste
- "Import N rows" button label shows the topic count; disabled if parse failed
- Error message appears inline below the textarea when no valid columns are detected

---

## Data Flow

```
User pastes TSV text
       │
       ▼
parseTsv(text) → { header: value }[]
       │
       ▼
parseRows(rows) → SessionBlock[]       ← existing function, unchanged
       │
  ┌────┴────┐
  │         │
  ▼         ▼
Preview   onImportCourse(blocks)       ← existing function, unchanged
table
```

---

## `parseTsv(text: string): Record<string, string>[]`

New helper added near the top of `SyllabusPage.tsx` (or exported to a shared util if needed):

```ts
function parseTsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const headers = lines[0].split('\t').map(h => h.trim().toLowerCase())
  return lines.slice(1).map(line => {
    const cells = line.split('\t')
    return Object.fromEntries(headers.map((h, i) => [h, (cells[i] ?? '').trim()]))
  })
}
```

- Splits on tab (`\t`) to match clipboard output from Excel/Google Sheets
- Header row is lowercased so column matching is case-insensitive
- Returns empty array if fewer than 2 lines (no data rows)

`parseRows()` already handles unknown/missing columns gracefully, so no changes needed there.

---

## Preview Table

Rendered inside the modal below the textarea. Columns: `#` · `Session` · `Topic` · `Type` · `Duration`.

**Session group rows:** A shaded `<tr>` spanning all columns acts as a visual divider between sessions (similar to `<thead>` grouping). Styled with a light background and bold session title.

**Minimum 10 rows visible:**
```css
.paste-preview-wrap {
  max-height: calc(10 * 36px);   /* 36px = one data row height */
  overflow-y: auto;
}
```
The wrapper always shows 10 topic rows without scrolling. Larger imports scroll within the fixed height. Session header rows don't count toward the 10-row minimum (they're decorative).

**Empty state:** If `parsedBlocks` is empty and text has been pasted, show: _"Couldn't detect columns. Expected headers: Session, Topic, Type, Duration."_

**No data yet:** Table area is hidden until the user pastes something.

---

## State Added to `SyllabusPage`

```ts
const [showPasteModal, setShowPasteModal] = useState(false)
const [pasteText, setPasteText] = useState('')
const [parsedBlocks, setParsedBlocks] = useState<SessionBlock[]>([])
const [pasteError, setPasteError] = useState<string | null>(null)
```

`handlePaste(text: string)`:
1. Calls `parseTsv(text)` → rows
2. Calls `parseRows(rows)` → blocks
3. If blocks.length > 0: sets `parsedBlocks`, clears `pasteError`
4. If blocks.length === 0: sets `pasteError`, clears `parsedBlocks`

`handlePasteImport()`:
1. Calls `onImportCourse(parsedBlocks)` (existing function)
2. Closes modal, resets paste state

---

## Error Handling

| Scenario | Behaviour |
|---|---|
| Pasted text has no recognisable headers | Inline error: "Couldn't detect columns. Expected: Session, Topic, Type, Duration." |
| Headers found but no data rows | Inline error: "No data rows found after header." |
| Some rows missing Topic column | Those rows are skipped silently (existing `parseRows` behaviour) |
| Import fails (Firestore error) | Same error toast as existing XLSX import |

---

## What Does Not Change

- `parseRows()` — used as-is
- `onImportCourse()` — used as-is
- XLSX import button and flow — unchanged
- All existing topic/session rendering (ordered lists stay as-is outside the modal)
- No new Firestore collections or Cloud Functions

---

## File Change Summary

| File | Change |
|---|---|
| `platform/src/pages/admin/SyllabusPage.tsx` | Add `parseTsv()`, paste modal state, modal JSX, "Paste Syllabus" button, preview table |
