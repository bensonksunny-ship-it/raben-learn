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

export function PlanningPage() {
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null)

  const [addingSubject, setAddingSubject] = useState(false)
  const [newSubjectName, setNewSubjectName] = useState('')

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
    if (!window.confirm('Delete this subject and all its levels? This cannot be undone.')) return
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
    // optimistic local update so the table doesn't flicker while saving
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
      <p className="muted" style={{ marginBottom: '1.25rem' }}>
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
                <button type="button" className="btn small ghost" onClick={() => setAddingSubject(false)}>Cancel</button>
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
                  <button
                    type="button"
                    className="syllabus-delete"
                    onClick={() => void deleteSubject(s.id)}
                    aria-label="Delete subject"
                    title="Delete subject"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 0.6rem', fontSize: '1rem' }}
                  >
                    ✕
                  </button>
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
  const [addingLevel, setAddingLevel] = useState(false)
  const [levelName, setLevelName] = useState('')
  const [levelOutcome, setLevelOutcome] = useState('')

  const [pasteText, setPasteText] = useState('')
  const [parsedLevels, setParsedLevels] = useState<SubjectLevel[]>([])
  const [pasteError, setPasteError] = useState<string | null>(null)

  const sortedLevels = [...subject.levels].sort((a, b) => a.level - b.level)

  function openAddLevel() {
    setLevelName(''); setLevelOutcome(''); setAddingLevel(true)
  }

  function addLevel(e: FormEvent) {
    e.preventDefault()
    const name = levelName.trim()
    if (!name) return
    const next: SubjectLevel = { id: crypto.randomUUID(), level: nextLevelNumber(subject.levels), name, coreOutcome: levelOutcome.trim() }
    onSaveLevels([...subject.levels, next])
    setAddingLevel(false)
  }

  function updateLevel(id: string, patch: Partial<SubjectLevel>) {
    onSaveLevels(subject.levels.map((l) => (l.id === id ? { ...l, ...patch } : l)))
  }

  function deleteLevel(id: string) {
    if (!window.confirm('Delete this level?')) return
    onSaveLevels(subject.levels.filter((l) => l.id !== id))
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
    setPasteText(''); setParsedLevels([]); setPasteError(null)
  }

  return (
    <div>
      <div className="syllabus-col-header">
        <h2>🎯 {subject.name}</h2>
        <button type="button" className="btn small primary" onClick={openAddLevel}>+ Level</button>
      </div>

      {addingLevel && (
        <form onSubmit={addLevel} className="form syllabus-mini-form">
          <div className="row" style={{ marginBottom: '0.4rem', alignItems: 'center' }}>
            <span className="muted small" style={{ minWidth: '4rem' }}>Level {nextLevelNumber(subject.levels)}</span>
            <input
              placeholder="Level name * (e.g. Speak Clearly)"
              value={levelName}
              onChange={(e) => setLevelName(e.target.value)}
              required
              autoFocus
              style={{ flex: 1 }}
            />
          </div>
          <textarea
            placeholder="Core outcome expected…"
            value={levelOutcome}
            onChange={(e) => setLevelOutcome(e.target.value)}
            style={{ width: '100%', minHeight: 60, fontFamily: 'inherit', boxSizing: 'border-box', marginBottom: '0.5rem' }}
          />
          <div className="row">
            <button type="submit" className="btn small primary" disabled={saving}>Save</button>
            <button type="button" className="btn small ghost" onClick={() => setAddingLevel(false)}>Cancel</button>
          </div>
        </form>
      )}

      {sortedLevels.length === 0 ? (
        <p className="muted small" style={{ padding: '0.5rem 0' }}>No levels yet — add one above, or paste a batch below.</p>
      ) : (
        <div className="table-wrap" style={{ marginBottom: '1.5rem' }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 70 }}>Level</th>
                <th style={{ width: 200 }}>Name</th>
                <th>Core Outcome</th>
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {sortedLevels.map((l) => (
                <LevelRow
                  key={`${l.id}:${l.name}:${l.coreOutcome}`}
                  level={l}
                  onUpdate={(patch) => updateLevel(l.id, patch)}
                  onDelete={() => deleteLevel(l.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Paste to bulk-add */}
      <div>
        <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#6366f1', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
          📋 Paste levels
        </div>
        <p className="muted small" style={{ marginBottom: '0.5rem' }}>
          Copy cells from Excel or Google Sheets and paste below. First row must be column headers:&nbsp;
          <code>Level · Name · Core Outcome</code> (Level column is optional — numbered automatically if omitted).
        </p>
        <textarea
          style={{
            width: '100%', minHeight: 100, fontFamily: 'monospace', fontSize: '0.8rem', padding: '0.5rem',
            border: '1px solid var(--border)', borderRadius: 'var(--radius)', resize: 'vertical', boxSizing: 'border-box',
          }}
          placeholder={'Name\tCore Outcome\nSpeak Clearly\tStudent can construct basic sentences and speak with clear pronunciation\nWrite Well\tStudent can write structured, grammatically correct paragraphs'}
          value={pasteText}
          onPaste={(e) => { e.preventDefault(); handlePaste(e.clipboardData.getData('text/plain')) }}
          onChange={(e) => handlePaste(e.target.value)}
        />
        {pasteError && (
          <p className="error" style={{ marginTop: '0.5rem', marginBottom: 0 }}>⚠ {pasteError}</p>
        )}
        {parsedLevels.length > 0 && (
          <div style={{ marginTop: '0.75rem' }}>
            <p className="muted small" style={{ marginBottom: '0.4rem' }}>
              <strong style={{ color: 'var(--text)' }}>Preview</strong> — {parsedLevels.length} level{parsedLevels.length !== 1 ? 's' : ''}
            </p>
            <div style={{ maxHeight: 'calc(6 * 36px)', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
                <thead>
                  <tr style={{ background: 'var(--surface-2, #f4f6fb)', position: 'sticky', top: 0 }}>
                    <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)', width: 60 }}>Level</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Name</th>
                    <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)' }}>Core Outcome</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedLevels.map((l) => (
                    <tr key={l.id} style={{ height: 36, borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '4px 8px', color: 'var(--muted-2)' }}>{l.level}</td>
                      <td style={{ padding: '4px 8px' }}>{l.name}</td>
                      <td style={{ padding: '4px 8px' }}>{l.coreOutcome}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="row" style={{ marginTop: '0.75rem', justifyContent: 'flex-end' }}>
              <button type="button" className="btn small ghost" onClick={() => { setPasteText(''); setParsedLevels([]); setPasteError(null) }}>Clear</button>
              <button type="button" className="btn small primary" disabled={saving} onClick={importPasted}>
                {saving ? '⏳ Adding…' : `Add ${parsedLevels.length} level${parsedLevels.length !== 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

interface LevelRowProps {
  level: SubjectLevel
  onUpdate: (patch: Partial<SubjectLevel>) => void
  onDelete: () => void
}

function LevelRow({ level, onUpdate, onDelete }: LevelRowProps) {
  // Keyed by `${id}:${name}:${coreOutcome}` in the parent, so this remounts
  // (and re-seeds local state) whenever the underlying level data changes
  // externally, without resetting state on every local keystroke.
  const [name, setName] = useState(level.name)
  const [outcome, setOutcome] = useState(level.coreOutcome)

  return (
    <tr style={{ verticalAlign: 'top' }}>
      <td style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--muted-2)' }}>{level.level}</td>
      <td>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => { const trimmed = name.trim(); if (trimmed && trimmed !== level.name) onUpdate({ name: trimmed }) }}
          style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '0.3rem 0.4rem', font: 'inherit', boxSizing: 'border-box' }}
        />
      </td>
      <td>
        <textarea
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          onBlur={() => { const trimmed = outcome.trim(); if (trimmed !== level.coreOutcome) onUpdate({ coreOutcome: trimmed }) }}
          rows={1}
          style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 6, padding: '0.3rem 0.4rem', font: 'inherit', resize: 'vertical', boxSizing: 'border-box' }}
        />
      </td>
      <td style={{ textAlign: 'right' }}>
        <button
          type="button"
          onClick={onDelete}
          aria-label="Delete level"
          title="Delete level"
          style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: 0.45, fontSize: '1rem' }}
        >
          ✕
        </button>
      </td>
    </tr>
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
