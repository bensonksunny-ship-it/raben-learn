# Syllabus Paste Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Paste Syllabus" button to the syllabus builder that opens a modal where users paste tab-separated spreadsheet data, preview it as a table (≥10 rows visible), and import it into the selected course.

**Architecture:** Single file change to `SyllabusPage.tsx`. Extract `importBlocks()` from the existing `onImportCourse` so both XLSX and paste flows share the same Firestore write logic. Add `parseTsv()` as an independent column-header-based parser (the existing `parseRows` uses a different XLSX row format and is not reused). Add paste modal state, handler functions, and modal JSX.

**Tech Stack:** React 18 + TypeScript, Firebase Firestore, Vite dev server at localhost:5173. No test framework — verification is done in browser.

## Global Constraints

- Only modify `platform/src/pages/admin/SyllabusPage.tsx` — no new files, no other files
- `modal-backdrop` and `modal` CSS classes already exist in `platform/src/index.css` — use them, do not add duplicate modal base styles
- `SessionBlock` interface lives inside the component function at line 243 — keep it there
- `parseRows` (XLSX 2D-array parser) must not be modified — it is used by the XLSX import and has a different row format
- Import button label: `Import {N} topic{s}` where N = total topic count across all parsed sessions
- Paste modal width: `max-width: 720px` (wider than default 580px modal to fit the preview table) — set inline on the `.modal` div
- Row height in preview table: `36px` per topic row (matches spec CSS calc)

---

### Task 1: Extract `importBlocks` + extend `SessionBlock`

**Files:**
- Modify: `platform/src/pages/admin/SyllabusPage.tsx:243` (`SessionBlock` interface)
- Modify: `platform/src/pages/admin/SyllabusPage.tsx:291-322` (`onImportCourse` function)

**Interfaces:**
- Produces: `importBlocks(blocks: SessionBlock[]): Promise<void>` — used by Task 2's `handlePasteImport` and by the updated `onImportCourse`
- Produces: `SessionBlock` extended with `durationMinutes?: number`

- [ ] **Step 1: Add `durationMinutes` to `SessionBlock`**

Find line 243 in `SyllabusPage.tsx`:
```ts
interface SessionBlock { name: string; order: number; topics: Topic[] }
```
Replace with:
```ts
interface SessionBlock { name: string; order: number; durationMinutes?: number; topics: Topic[] }
```

- [ ] **Step 2: Extract `importBlocks` from `onImportCourse`**

The current `onImportCourse` (lines 291-322) contains a `for...of` loop that writes sessions to Firestore. Extract it into a new `importBlocks` function placed directly above `onImportCourse`:

```ts
async function importBlocks(blocks: SessionBlock[]) {
  let created = 0
  for (const s of blocks) {
    await addDoc(collection(db, 'sessions'), {
      courseId: selectedCourseId,
      courseName: selectedCourse?.title ?? '',
      title: s.name,
      order: s.order,
      durationMinutes: s.durationMinutes ?? 0,
      activities: s.topics,
      createdAt: serverTimestamp(),
    })
    created++
  }
  setImportResult(`✓ Imported ${created} session${created !== 1 ? 's' : ''}.`)
  await loadSessions(selectedCourseId!)
}
```

- [ ] **Step 3: Update `onImportCourse` to call `importBlocks`**

Replace the body of `onImportCourse` so it parses the file then delegates writes to `importBlocks`. The full updated function:

```ts
async function onImportCourse(file: File) {
  if (!selectedCourseId) return
  setImporting(true); setImportResult(null); setError('')
  try {
    const buffer = await file.arrayBuffer()
    const wb = XLSX.read(buffer, { type: 'array' })
    console.log('[Import] Sheet names:', wb.SheetNames)
    const ws = wb.Sheets[wb.SheetNames[0]]
    if (!ws) { setError('Excel file has no sheet.'); return }
    const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, { header: 1 })
    console.log('[Import] Total rows:', rows.length)
    rows.slice(0, 20).forEach((r, i) => console.log(`[Import] Row ${i}:`, JSON.stringify(r)))
    const blocks = parseRows(rows)
    console.log('[Import] Parsed blocks:', blocks.length, blocks.map(b => b.name))
    if (blocks.length === 0) { setError('No sessions found.'); return }
    await importBlocks(blocks)
    if (xlsxInputRef.current) xlsxInputRef.current.value = ''
  } catch (e) { setError(e instanceof Error ? e.message : 'Failed to import') } finally { setImporting(false) }
}
```

- [ ] **Step 4: Verify XLSX import still works**

In the browser at `http://localhost:5173`, navigate to Syllabus Builder, select a course, and use "Import Sessions" with an existing XLSX file. Confirm sessions still import as before. If no XLSX is available, just confirm no TypeScript errors in the terminal running `vite`.

- [ ] **Step 5: Commit**

```bash
git add platform/src/pages/admin/SyllabusPage.tsx
git commit -m "refactor: extract importBlocks from onImportCourse in SyllabusPage"
```

---

### Task 2: Add `parseTsv` + paste modal state + handlers

**Files:**
- Modify: `platform/src/pages/admin/SyllabusPage.tsx`

**Interfaces:**
- Consumes: `importBlocks(blocks: SessionBlock[]): Promise<void>` from Task 1
- Consumes: `SessionBlock` with `durationMinutes?: number` from Task 1
- Produces: `parseTsv(text: string): SessionBlock[]` — used by `handlePaste` and the preview table render
- Produces: `showPasteModal`, `pasteText`, `parsedBlocks`, `pasteError` state
- Produces: `handlePaste(text: string): void`
- Produces: `handlePasteImport(): Promise<void>`

- [ ] **Step 1: Add `parseTsv` function**

Add this function directly below `parseRows` (around line 290, before `onImportCourse`):

```ts
function parseTsv(text: string): SessionBlock[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const headers = lines[0]!.split('\t').map(h => h.trim().toLowerCase())

  const sessionIdx = headers.indexOf('session')
  const topicIdx = headers.findIndex(h => h === 'topic' || h === 'title' || h === 'activity')
  const typeIdx = headers.indexOf('type')
  const orderIdx = headers.indexOf('order')
  const durationIdx = headers.findIndex(h => h === 'duration' || h === 'duration (min)' || h === 'duration(min)')

  if (sessionIdx === -1 || topicIdx === -1) return []

  const sessionMap = new Map<string, { order: number; durationMinutes: number; topics: Topic[] }>()
  const sessionKeys: string[] = []
  let autoOrder = 0

  for (const line of lines.slice(1)) {
    const cells = line.split('\t')
    const sessionName = (cells[sessionIdx] ?? '').trim()
    const topicTitle = (cells[topicIdx] ?? '').trim()
    if (!sessionName || !topicTitle) continue

    if (!sessionMap.has(sessionName)) {
      autoOrder++
      const parsedOrder = orderIdx >= 0 ? parseInt(cells[orderIdx] ?? '', 10) : NaN
      const parsedDur = durationIdx >= 0 ? parseInt(cells[durationIdx] ?? '', 10) : NaN
      sessionMap.set(sessionName, {
        order: isNaN(parsedOrder) ? autoOrder : parsedOrder,
        durationMinutes: isNaN(parsedDur) ? 0 : parsedDur,
        topics: [],
      })
      sessionKeys.push(sessionName)
    }

    const rawType = typeIdx >= 0 ? (cells[typeIdx] ?? '').trim() : ''
    sessionMap.get(sessionName)!.topics.push({
      id: crypto.randomUUID(),
      title: topicTitle,
      type: parseTopicType(rawType),
      remark: '',
    })
  }

  return sessionKeys.map(name => {
    const s = sessionMap.get(name)!
    return { name, order: s.order, durationMinutes: s.durationMinutes, topics: s.topics }
  })
}
```

- [ ] **Step 2: Verify `parseTsv` in browser console**

Open the browser console at `http://localhost:5173` and paste:

```js
// This won't work directly since parseTsv is not exported,
// but you can temporarily add a console.log inside the function on first render:
// console.log('parseTsv test:', parseTsv("Session\tTopic\tType\nIntro\tVariables\tconcept\nIntro\tScript\texercise\nDS\tLists\tconcept"))
// Expected: array with 2 SessionBlocks — "Intro" (2 topics) and "DS" (1 topic)
```

Alternatively, after the next step you can verify by pasting into the textarea and checking the preview.

- [ ] **Step 3: Add paste modal state variables**

Add these four state declarations alongside the existing state at the top of the component (after the existing `const [importResult, ...` line):

```ts
const [showPasteModal, setShowPasteModal] = useState(false)
const [pasteText, setPasteText] = useState('')
const [parsedBlocks, setParsedBlocks] = useState<SessionBlock[]>([])
const [pasteError, setPasteError] = useState<string | null>(null)
```

- [ ] **Step 4: Add `handlePaste` and `handlePasteImport`**

Add these two functions directly above `onImportCourse`:

```ts
function handlePaste(text: string) {
  setPasteText(text)
  if (!text.trim()) {
    setParsedBlocks([])
    setPasteError(null)
    return
  }
  const blocks = parseTsv(text)
  if (blocks.length > 0) {
    setParsedBlocks(blocks)
    setPasteError(null)
  } else {
    setParsedBlocks([])
    const lines = text.trim().split(/\r?\n/)
    if (lines.length < 2) {
      setPasteError('No data rows found. Paste must have a header row and at least one data row.')
    } else {
      setPasteError('Couldn\'t detect columns. Expected headers: Session, Topic, Type, Duration.')
    }
  }
}

async function handlePasteImport() {
  if (!selectedCourseId || parsedBlocks.length === 0) return
  setImporting(true); setError('')
  try {
    await importBlocks(parsedBlocks)
    setShowPasteModal(false)
    setPasteText('')
    setParsedBlocks([])
    setPasteError(null)
  } catch (e) {
    setError(e instanceof Error ? e.message : 'Failed to import')
  } finally {
    setImporting(false)
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add platform/src/pages/admin/SyllabusPage.tsx
git commit -m "feat: add parseTsv and paste modal state to SyllabusPage"
```

---

### Task 3: Add "Paste Syllabus" button + modal JSX + preview table

**Files:**
- Modify: `platform/src/pages/admin/SyllabusPage.tsx`

**Interfaces:**
- Consumes: `showPasteModal`, `setShowPasteModal`, `pasteText`, `parsedBlocks`, `pasteError`, `handlePaste`, `handlePasteImport`, `importing` from Task 2
- Consumes: `SessionBlock` with `durationMinutes?` from Task 1

- [ ] **Step 1: Add `Fragment` to the React import**

Find line 1 in `SyllabusPage.tsx`:
```ts
import { useEffect, useRef, useState, type FormEvent } from 'react'
```
Replace with:
```ts
import { Fragment, useEffect, useRef, useState, type FormEvent } from 'react'
```

- [ ] **Step 2: Add "Paste Syllabus" button**

Find the existing import button label div (around line 375-380):

```tsx
<label className="btn small ghost" style={{ cursor: 'pointer' }} title="Import sessions from Excel">
  {importing ? '⏳…' : '📥 Import Sessions'}
  <input ref={xlsxInputRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
    onChange={(e) => { const f = e.target.files?.[0]; if (f) void onImportCourse(f) }} />
</label>
```

Add a "Paste Syllabus" button immediately before it (inside the same `<div className="row">`):

```tsx
<button
  type="button"
  className="btn small ghost"
  title="Paste from Excel or Google Sheets"
  onClick={() => setShowPasteModal(true)}
>
  📋 Paste Syllabus
</button>
```

The `<div className="row">` should now contain three children: Paste button, Import label, + Session button.

- [ ] **Step 3: Add paste modal JSX**

Add the paste modal just before the closing `</div>` of the entire component return (after the existing "Add Topic" modal at line 584-601):

```tsx
{showPasteModal && (
  <div className="modal-backdrop" onClick={() => { setShowPasteModal(false); setPasteText(''); setParsedBlocks([]); setPasteError(null) }}>
    <div className="modal" style={{ maxWidth: 720 }} onClick={(e) => e.stopPropagation()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
        <h3 style={{ margin: 0 }}>📋 Paste Syllabus</h3>
        <button
          type="button"
          className="btn small ghost"
          onClick={() => { setShowPasteModal(false); setPasteText(''); setParsedBlocks([]); setPasteError(null) }}
        >✕</button>
      </div>

      <p className="muted small" style={{ marginBottom: '0.75rem' }}>
        Copy cells from Excel or Google Sheets and paste below. First row must be column headers:&nbsp;
        <code>Session · Order · Duration · Topic · Type</code>
      </p>

      <textarea
        style={{
          width: '100%',
          minHeight: 120,
          fontFamily: 'monospace',
          fontSize: '0.8rem',
          padding: '0.5rem',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          resize: 'vertical',
          boxSizing: 'border-box',
        }}
        placeholder={"Session\tOrder\tDuration\tTopic\tType\nIntro to Python\t1\t60\tVariables\tconcept"}
        value={pasteText}
        onPaste={(e) => {
          e.preventDefault()
          const text = e.clipboardData.getData('text/plain')
          handlePaste(text)
        }}
        onChange={(e) => handlePaste(e.target.value)}
      />

      {pasteError && (
        <p className="error" style={{ marginTop: '0.5rem', marginBottom: 0 }}>
          ⚠ {pasteError}
        </p>
      )}

      {parsedBlocks.length > 0 && (
        <div style={{ marginTop: '1rem' }}>
          <p className="muted small" style={{ marginBottom: '0.4rem' }}>
            <strong style={{ color: 'var(--text)' }}>Preview</strong> — {parsedBlocks.length} session{parsedBlocks.length !== 1 ? 's' : ''},{' '}
            {parsedBlocks.reduce((n, b) => n + b.topics.length, 0)} topic{parsedBlocks.reduce((n, b) => n + b.topics.length, 0) !== 1 ? 's' : ''}
          </p>
          <div style={{ maxHeight: 'calc(10 * 36px)', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
              <thead>
                <tr style={{ background: 'var(--surface-2, #f4f6fb)', position: 'sticky', top: 0 }}>
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)', width: 32 }}>#</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Session</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Topic</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)', width: 90 }}>Type</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid var(--border)', width: 70 }}>Dur (min)</th>
                </tr>
              </thead>
              <tbody>
                {parsedBlocks.map((block) => (
                  <Fragment key={block.name}>
                    {block.topics.map((topic, tidx) => (
                    <tr key={topic.id} style={{ height: 36, borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '4px 8px', color: 'var(--muted-2)', fontSize: '0.75rem' }}>{tidx + 1}</td>
                      <td style={{ padding: '4px 8px', color: tidx === 0 ? 'var(--text)' : 'var(--muted-2)', fontWeight: tidx === 0 ? 600 : 400 }}>
                        {tidx === 0 ? block.name : ''}
                      </td>
                      <td style={{ padding: '4px 8px' }}>{topic.title}</td>
                      <td style={{ padding: '4px 8px' }}>
                        <span style={{
                          ...topicTypeColor(topic.type),
                          padding: '1px 6px',
                          borderRadius: 4,
                          fontSize: '0.75rem',
                          fontWeight: 600,
                        }}>
                          {topicTypeLabel(topic.type)}
                        </span>
                      </td>
                      <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--muted-2)' }}>
                        {tidx === 0 && (block.durationMinutes ?? 0) > 0 ? block.durationMinutes : ''}
                      </td>
                    </tr>
                  ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="row" style={{ marginTop: '1.25rem', justifyContent: 'flex-end' }}>
        <button
          type="button"
          className="btn ghost"
          onClick={() => { setShowPasteModal(false); setPasteText(''); setParsedBlocks([]); setPasteError(null) }}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn primary"
          disabled={parsedBlocks.length === 0 || importing || !selectedCourseId}
          onClick={() => void handlePasteImport()}
        >
          {importing
            ? '⏳ Importing…'
            : `Import ${parsedBlocks.reduce((n, b) => n + b.topics.length, 0)} topic${parsedBlocks.reduce((n, b) => n + b.topics.length, 0) !== 1 ? 's' : ''}`}
        </button>
      </div>
    </div>
  </div>
)}
```

- [ ] **Step 4: Manual verification in browser**

Open `http://localhost:5173`, go to Syllabus Builder, select a course.

**Test A — Button visible:**
Confirm "📋 Paste Syllabus" button appears beside "📥 Import Sessions".

**Test B — Modal opens/closes:**
Click "Paste Syllabus" → modal opens. Click ✕ or backdrop → modal closes, textarea clears.

**Test C — Valid paste shows preview table:**
Click "Paste Syllabus", click into the textarea, then paste this text (copy from here, including tabs):
```
Session	Order	Duration	Topic	Type
Intro to Python	1	60	Variables and Types	concept
Intro to Python	1	60	First Script	exercise
Data Structures	2	90	Lists	concept
Data Structures	2	90	Dicts	concept
Data Structures	2	90	Sets	exercise
```
Expected: Preview table appears with 5 topic rows (Data Structures session shows all 3 topics). "Import 5 topics" button is enabled.

**Test D — Table shows ≥10 rows before scrolling:**
Paste a syllabus with 12+ topic rows. Confirm the table shows exactly 10 rows before the scrollbar appears (wrapper height = 360px).

**Test E — Error state:**
Paste plain text with no tab-separated headers (e.g. `"hello world"`). Confirm error message appears: `"Couldn't detect columns. Expected headers: Session, Topic, Type, Duration."`

**Test F — Import completes:**
With a valid paste and a test course selected, click "Import N topics". Confirm: modal closes, sessions appear in the sessions list, success notice shows.

- [ ] **Step 5: Commit**

```bash
git add platform/src/pages/admin/SyllabusPage.tsx
git commit -m "feat: add paste syllabus modal with TSV parser and preview table"
```
