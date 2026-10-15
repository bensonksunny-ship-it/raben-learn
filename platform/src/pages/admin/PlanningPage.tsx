import { useEffect, useState, type FormEvent } from 'react'
import { addDoc, collection, deleteDoc, doc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../../firebase/config'

interface SubjectLevel {
  id: string
  level: number
  name: string
  coreOutcome: string
}

interface Subject {
  id: string
  name: string
  levels: SubjectLevel[]
}

function nextLevelNumber(levels: SubjectLevel[]): number {
  return levels.reduce((max, l) => Math.max(max, l.level), 0) + 1
}

/** Sort by level and renumber 1..n so the ladder stays gap-free after reorder/delete. */
function renumber(levels: SubjectLevel[]): SubjectLevel[] {
  return [...levels].sort((a, b) => a.level - b.level).map((l, i) => ({ ...l, level: i + 1 }))
}

export function PlanningPage() {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null)

  const [addingSubject, setAddingSubject] = useState(false)
  const [newSubjectName, setNewSubjectName] = useState('')
  const [confirmDeleteSubjectId, setConfirmDeleteSubjectId] = useState<string | null>(null)

  const selectedSubject = subjects.find((s) => s.id === selectedSubjectId) ?? null

  async function loadSubjects() {
    try {
      const snap = await getDocs(collection(db, 'planning_subjects'))
      const list: Subject[] = []
      snap.forEach((d) => {
        const x = d.data()
        const levels = Array.isArray(x.levels) ? (x.levels as SubjectLevel[]) : []
        list.push({ id: d.id, name: (x.name as string) ?? '', levels })
      })
      list.sort((a, b) => a.name.localeCompare(b.name))
      setSubjects(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load subjects')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadSubjects() }, [])

  async function createSubject(e: FormEvent) {
    e.preventDefault()
    const name = newSubjectName.trim()
    if (!name) return
    setSaving(true); setError('')
    try {
      const ref = await addDoc(collection(db, 'planning_subjects'), { name, levels: [], createdAt: serverTimestamp() })
      setNewSubjectName(''); setAddingSubject(false)
      await loadSubjects()
      setSelectedSubjectId(ref.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create subject')
    } finally {
      setSaving(false)
    }
  }

  async function deleteSubject(id: string) {
    setConfirmDeleteSubjectId(null)
    try {
      await deleteDoc(doc(db, 'planning_subjects', id))
      if (selectedSubjectId === id) setSelectedSubjectId(null)
      await loadSubjects()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete subject')
    }
  }

  async function saveLevels(subjectId: string, levels: SubjectLevel[]) {
    setSaving(true); setError('')
    // optimistic local update so the ladder doesn't flicker while saving
    setSubjects((prev) => prev.map((s) => (s.id === subjectId ? { ...s, levels } : s)))
    try {
      await updateDoc(doc(db, 'planning_subjects', subjectId), { levels })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save levels')
      await loadSubjects()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <h1 style={{ margin: '0 0 0.35rem' }}>🗂️ Planning</h1>
      <p className="muted planning-intro">
        Define subjects and the levels students progress through — a name and the core outcome expected at each level.
      </p>
      {error ? <p className="error">{error}</p> : null}

      <div className="syllabus-columns">
        {/* SUBJECTS */}
        <div className="syllabus-col">
          <div className="syllabus-col-header">
            <h2>📚 Subjects</h2>
            <button type="button" className="btn small primary" onClick={() => setAddingSubject((v) => !v)}>+ Subject</button>
          </div>
          {addingSubject && (
            <form onSubmit={(e) => void createSubject(e)} className="form syllabus-mini-form">
              <input placeholder="Subject name *" value={newSubjectName} onChange={(e) => setNewSubjectName(e.target.value)} required autoFocus />
              <div className="row">
                <button type="submit" className="btn small primary" disabled={saving}>Save</button>
                <button type="button" className="btn small secondary" onClick={() => setAddingSubject(false)}>Cancel</button>
              </div>
            </form>
          )}
          {loading ? (
            <p className="muted small">Loading…</p>
          ) : (
            <ul className="syllabus-list">
              {subjects.map((s) => (
                <li key={s.id} className={`syllabus-item${selectedSubjectId === s.id ? ' active' : ''}`}>
                  <button type="button" className="syllabus-item-btn" onClick={() => setSelectedSubjectId(s.id)}>
                    <span className="syllabus-item-title">{s.name}</span>
                    <span className="muted small syllabus-item-desc">{s.levels.length} level{s.levels.length === 1 ? '' : 's'}</span>
                  </button>
                  {confirmDeleteSubjectId === s.id ? (
                    <span className="subject-delete-confirm">
                      <button type="button" className="btn small primary" onClick={() => void deleteSubject(s.id)}>Delete</button>
                      <button type="button" className="btn small secondary" onClick={() => setConfirmDeleteSubjectId(null)}>Cancel</button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      className="syllabus-delete level-icon-btn danger"
                      onClick={() => setConfirmDeleteSubjectId(s.id)}
                      aria-label={`Delete ${s.name}`}
                      title="Delete subject"
                    >
                      ✕
                    </button>
                  )}
                </li>
              ))}
              {subjects.length === 0 ? <li className="muted small" style={{ padding: '0.5rem 0' }}>No subjects yet.</li> : null}
            </ul>
          )}
        </div>

        {/* LEVELS */}
        {selectedSubject ? (
          <div className="syllabus-col syllabus-col-wide">
            <SubjectLevelsPanel
              key={selectedSubject.id}
              subject={selectedSubject}
              saving={saving}
              onSaveLevels={(levels) => void saveLevels(selectedSubject.id, levels)}
            />
          </div>
        ) : (
          <div className="syllabus-col syllabus-col-wide" style={{ textAlign: 'center', padding: '2.5rem' }}>
            <p style={{ fontSize: '2.5rem', margin: 0 }}>🎯</p>
            <h3>Select a subject to define its levels</h3>
            <p className="muted">Choose a subject on the left, or add a new one.</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Levels panel ──────────────────────────────────────────────────────────────

interface SubjectLevelsPanelProps {
  subject: Subject
  saving: boolean
  onSaveLevels: (levels: SubjectLevel[]) => void
}

function SubjectLevelsPanel({ subject, saving, onSaveLevels }: SubjectLevelsPanelProps) {
  const sortedLevels = [...subject.levels].sort((a, b) => a.level - b.level)

  // editingId is a level id, or 'new' for the add-a-level editor, or null.
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [draftOutcome, setDraftOutcome] = useState('')
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [showPaste, setShowPaste] = useState(false)

  const [pasteText, setPasteText] = useState('')
  const [parsedLevels, setParsedLevels] = useState<SubjectLevel[]>([])
  const [pasteError, setPasteError] = useState<string | null>(null)

  // Brief "Saved ✓" confirmation whenever a save finishes. savedTick bumps on
  // each completed save so the flash element remounts and re-runs its CSS fade.
  const [prevSaving, setPrevSaving] = useState(saving)
  const [savedTick, setSavedTick] = useState(0)
  if (prevSaving !== saving) {
    setPrevSaving(saving)
    if (prevSaving && !saving) setSavedTick((n) => n + 1)
  }

  function startAdd() {
    setConfirmDeleteId(null)
    setDraftName(''); setDraftOutcome('')
    setEditingId('new')
  }
  function startEdit(l: SubjectLevel) {
    setConfirmDeleteId(null)
    setDraftName(l.name); setDraftOutcome(l.coreOutcome)
    setEditingId(l.id)
  }
  function cancelEdit() {
    setEditingId(null); setDraftName(''); setDraftOutcome('')
  }
  function commitEdit(e: FormEvent) {
    e.preventDefault()
    const name = draftName.trim()
    if (!name) return
    const coreOutcome = draftOutcome.trim()
    if (editingId === 'new') {
      const next: SubjectLevel = { id: crypto.randomUUID(), level: nextLevelNumber(subject.levels), name, coreOutcome }
      onSaveLevels([...subject.levels, next])
    } else {
      onSaveLevels(subject.levels.map((l) => (l.id === editingId ? { ...l, name, coreOutcome } : l)))
    }
    cancelEdit()
  }

  function moveLevel(id: string, dir: 'up' | 'down') {
    const sorted = [...subject.levels].sort((a, b) => a.level - b.level)
    const i = sorted.findIndex((l) => l.id === id)
    const j = dir === 'up' ? i - 1 : i + 1
    if (i === -1 || j < 0 || j >= sorted.length) return
    const a = sorted[i]!
    const b = sorted[j]!
    sorted[i] = b
    sorted[j] = a
    onSaveLevels(sorted.map((l, idx) => ({ ...l, level: idx + 1 })))
  }

  function deleteLevel(id: string) {
    onSaveLevels(renumber(subject.levels.filter((l) => l.id !== id)))
    setConfirmDeleteId(null)
  }

  function handlePaste(text: string) {
    setPasteText(text)
    if (!text.trim()) { setParsedLevels([]); setPasteError(null); return }
    const rows = parseLevelsTsv(text, nextLevelNumber(subject.levels))
    if (rows.length > 0) {
      setParsedLevels(rows)
      setPasteError(null)
    } else {
      setParsedLevels([])
      const lines = text.trim().split(/\r?\n/)
      if (lines.length < 2) {
        setPasteError('No data rows found. Paste must have a header row and at least one data row.')
      } else {
        setPasteError("Couldn't detect columns. Expected headers: Level (optional), Name, Core Outcome.")
      }
    }
  }

  function importPasted() {
    if (parsedLevels.length === 0) return
    onSaveLevels([...subject.levels, ...parsedLevels])
    setPasteText(''); setParsedLevels([]); setPasteError(null); setShowPaste(false)
  }

  return (
    <div>
      <div className="syllabus-col-header">
        <h2>🎯 {subject.name}</h2>
        <span className="row" style={{ gap: '0.6rem' }}>
          {saving ? <span className="level-save-status">Saving…</span> : null}
          {!saving && savedTick > 0 ? <span key={savedTick} className="level-save-status saved level-save-flash">Saved ✓</span> : null}
          <span className="muted small">{sortedLevels.length} level{sortedLevels.length === 1 ? '' : 's'}</span>
        </span>
      </div>

      {sortedLevels.length === 0 && editingId !== 'new' ? (
        <p className="muted small" style={{ padding: '0.5rem 0 1rem' }}>
          No levels yet — add the first one below, or paste a batch from a spreadsheet.
        </p>
      ) : null}

      <ul className="level-ladder">
        {sortedLevels.map((l, idx) => (
          <li key={l.id}>
            {editingId === l.id ? (
              <LevelEditor
                heading={`Edit level ${l.level}`}
                name={draftName}
                outcome={draftOutcome}
                saving={saving}
                onName={setDraftName}
                onOutcome={setDraftOutcome}
                onSubmit={commitEdit}
                onCancel={cancelEdit}
              />
            ) : confirmDeleteId === l.id ? (
              <div className="level-card" style={{ alignItems: 'center' }}>
                <span className="level-badge">{l.level}</span>
                <div className="level-inline-confirm">
                  <span>Delete “{l.name}”?</span>
                </div>
                <div className="level-editor-row">
                  <button type="button" className="btn small primary" onClick={() => deleteLevel(l.id)}>Delete</button>
                  <button type="button" className="btn small secondary" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="level-card">
                <span className="level-badge">{l.level}</span>
                <div className="level-card-body">
                  <div className="level-card-name">{l.name}</div>
                  <div className={`level-card-outcome${l.coreOutcome ? '' : ' empty'}`}>
                    {l.coreOutcome || 'No core outcome yet'}
                  </div>
                </div>
                <div className="level-card-actions">
                  <button
                    type="button"
                    className="level-icon-btn"
                    onClick={() => moveLevel(l.id, 'up')}
                    disabled={idx === 0 || saving}
                    aria-label="Move level up"
                    title="Move up"
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    className="level-icon-btn"
                    onClick={() => moveLevel(l.id, 'down')}
                    disabled={idx === sortedLevels.length - 1 || saving}
                    aria-label="Move level down"
                    title="Move down"
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    className="level-icon-btn"
                    onClick={() => startEdit(l)}
                    aria-label={`Edit ${l.name}`}
                    title="Edit"
                  >
                    ✎
                  </button>
                  <button
                    type="button"
                    className="level-icon-btn danger"
                    onClick={() => { setEditingId(null); setConfirmDeleteId(l.id) }}
                    aria-label={`Delete ${l.name}`}
                    title="Delete"
                  >
                    🗑
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}

        <li>
          {editingId === 'new' ? (
            <LevelEditor
              heading={`New level ${nextLevelNumber(subject.levels)}`}
              name={draftName}
              outcome={draftOutcome}
              saving={saving}
              onName={setDraftName}
              onOutcome={setDraftOutcome}
              onSubmit={commitEdit}
              onCancel={cancelEdit}
            />
          ) : (
            <button type="button" className="level-add-card" onClick={startAdd}>
              <span aria-hidden>＋</span> Add level
            </button>
          )}
        </li>
      </ul>

      {/* Paste to bulk-add */}
      <div style={{ marginTop: '1.25rem' }}>
        <button type="button" className="planning-paste-toggle" onClick={() => setShowPaste((v) => !v)}>
          📋 {showPaste ? 'Hide spreadsheet paste' : 'Paste levels from a spreadsheet'}
        </button>

        {showPaste && (
          <div className="planning-paste-box">
            <p className="muted small" style={{ marginBottom: '0.5rem' }}>
              Copy cells from Excel or Google Sheets and paste below. First row must be column headers:&nbsp;
              <code>Level · Name · Core Outcome</code> (Level column is optional — numbered automatically if omitted).
            </p>
            <textarea
              placeholder={'Name\tCore Outcome\nSpeak Clearly\tStudent can construct basic sentences and speak with clear pronunciation\nWrite Well\tStudent can write structured, grammatically correct paragraphs'}
              value={pasteText}
              onPaste={(e) => { e.preventDefault(); handlePaste(e.clipboardData.getData('text/plain')) }}
              onChange={(e) => handlePaste(e.target.value)}
            />
            {pasteError && <p className="error" style={{ marginTop: '0.5rem', marginBottom: 0 }}>⚠ {pasteError}</p>}
            {parsedLevels.length > 0 && (
              <div style={{ marginTop: '0.75rem' }}>
                <p className="muted small" style={{ marginBottom: '0.4rem' }}>
                  <strong style={{ color: 'var(--text)' }}>Preview</strong> — {parsedLevels.length} level{parsedLevels.length !== 1 ? 's' : ''}
                </p>
                <div className="table-wrap" style={{ maxHeight: 'calc(6 * 40px)', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                  <table className="table">
                    <thead>
                      <tr>
                        <th style={{ width: 60 }}>Level</th>
                        <th style={{ width: 180 }}>Name</th>
                        <th>Core Outcome</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedLevels.map((l) => (
                        <tr key={l.id}>
                          <td style={{ color: 'var(--muted-2)' }}>{l.level}</td>
                          <td>{l.name}</td>
                          <td>{l.coreOutcome}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="row" style={{ marginTop: '0.75rem', justifyContent: 'flex-end' }}>
                  <button type="button" className="btn small secondary" onClick={() => { setPasteText(''); setParsedLevels([]); setPasteError(null) }}>Clear</button>
                  <button type="button" className="btn small primary" disabled={saving} onClick={importPasted}>
                    {saving ? '⏳ Adding…' : `Add ${parsedLevels.length} level${parsedLevels.length !== 1 ? 's' : ''}`}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Level editor ──────────────────────────────────────────────────────────────

interface LevelEditorProps {
  heading: string
  name: string
  outcome: string
  saving: boolean
  onName: (v: string) => void
  onOutcome: (v: string) => void
  onSubmit: (e: FormEvent) => void
  onCancel: () => void
}

function LevelEditor({ heading, name, outcome, saving, onName, onOutcome, onSubmit, onCancel }: LevelEditorProps) {
  return (
    <form className="level-editor" onSubmit={onSubmit}>
      <span className="muted small" style={{ fontWeight: 700 }}>{heading}</span>
      <input
        placeholder="Level name * (e.g. Speak Clearly)"
        value={name}
        onChange={(e) => onName(e.target.value)}
        required
        autoFocus
      />
      <textarea
        placeholder="Core outcome expected at this level…"
        value={outcome}
        onChange={(e) => onOutcome(e.target.value)}
      />
      <div className="level-editor-row">
        <button type="submit" className="btn small primary" disabled={saving || !name.trim()}>Save</button>
        <button type="button" className="btn small secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

// ─── Paste parsing ─────────────────────────────────────────────────────────────

function parseLevelsTsv(text: string, startLevel: number): SubjectLevel[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const headers = lines[0]!.split('\t').map((h) => h.trim().toLowerCase())

  const levelIdx = headers.indexOf('level')
  const nameIdx = headers.findIndex((h) => h === 'name' || h === 'level name')
  const outcomeIdx = headers.findIndex((h) => h.includes('outcome'))

  if (nameIdx === -1) return []

  const rows: SubjectLevel[] = []
  let autoLevel = startLevel - 1
  for (const line of lines.slice(1)) {
    const cells = line.split('\t')
    const name = (cells[nameIdx] ?? '').trim()
    if (!name) continue
    autoLevel++
    const parsedLevel = levelIdx >= 0 ? parseInt(cells[levelIdx] ?? '', 10) : NaN
    const coreOutcome = outcomeIdx >= 0 ? (cells[outcomeIdx] ?? '').trim() : ''
    rows.push({
      id: crypto.randomUUID(),
      level: Number.isFinite(parsedLevel) ? parsedLevel : autoLevel,
      name,
      coreOutcome,
    })
  }
  return rows
}
