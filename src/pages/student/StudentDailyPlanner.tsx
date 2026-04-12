import { useCallback, useEffect, useRef, useState } from 'react'
import { collection, doc, getDoc, getDocs, query, setDoc, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import type { Course, DailyPlan, DailyPlanItem, LessonItemType, ProgressEntry, Session } from '../../types'

function todayStr() { return new Date().toISOString().slice(0, 10) }
function formatTime(ms: number) {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${String(sec).padStart(2, '0')}s`
}
function itemTypeLabel(t: LessonItemType | string) { return t === 'concept' ? 'Concept' : t === 'exercise' ? 'Exercise' : 'Implementation' }
function itemTypeColors(t: LessonItemType | string) {
  if (t === 'concept') return { bg: '#dbeafe', text: '#1e40af' }
  if (t === 'exercise') return { bg: '#dcfce7', text: '#166534' }
  if (t === 'custom') return { bg: '#f3f4f6', text: '#374151' }
  return { bg: '#fce7f3', text: '#9d174d' }
}

function timeStrToMinutes(s: string): number | null {
  const m = /^(\d{2}):(\d{2})$/.exec(s.trim())
  if (!m) return null
  const hh = Number(m[1]); const mm = Number(m[2])
  if (!Number.isFinite(hh) || !Number.isFinite(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null
  return hh * 60 + mm
}
function minutesToTimeStr(min: number): string {
  const m = ((min % (24 * 60)) + (24 * 60)) % (24 * 60)
  const hh = Math.floor(m / 60)
  const mm = m % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
}

interface SuggestedItem {
  sessionId: string
  sessionTitle: string
  courseId: string
  courseName: string
  activity: { id: string; title: string; type: LessonItemType }
}

export function StudentDailyPlanner() {
  const { firebaseUser, profile } = useAuth()
  const uid = firebaseUser?.uid
  const [date, setDate] = useState(todayStr())
  const [plan, setPlan] = useState<DailyPlan | null>(null)
  const [timers, setTimers] = useState<Record<string, number>>({})
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addTab, setAddTab] = useState<'suggest' | 'browse' | 'custom'>('suggest')
  const [suggestions, setSuggestions] = useState<SuggestedItem[]>([])
  const [courses, setCourses] = useState<Course[]>([])
  const [sessions, setSessions] = useState<Session[]>([])
  const [selCourseId, setSelCourseId] = useState('')
  const [selSessionId, setSelSessionId] = useState('')
  const [selActivityId, setSelActivityId] = useState('')
  const [plannedMin, setPlannedMin] = useState(30)
  const [customTitle, setCustomTitle] = useState('')
  const [customCourseId, setCustomCourseId] = useState('')
  const [customMinutes, setCustomMinutes] = useState(30)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showStartTimeModal, setShowStartTimeModal] = useState(false)
  const [startTimeInput, setStartTimeInput] = useState('09:00')

  const savePlanQuiet = useCallback(async (items: DailyPlanItem[]) => {
    if (!uid) return
    try {
      await setDoc(doc(db, 'student_daily_plans', `${uid}_${date}`), { studentId: uid, date, items, startTime: plan?.startTime ?? '09:00' }, { merge: true })
    } catch (e) {
      console.error('savePlanQuiet failed', e)
    }
  }, [uid, date, plan?.startTime])

  const loadPlan = useCallback(async () => {
    if (!uid) return; setLoading(true)
    try {
      const snap = await getDoc(doc(db, 'student_daily_plans', `${uid}_${date}`))
      if (snap.exists()) {
        const d = snap.data()
        const loaded: DailyPlan = {
          id: snap.id,
          studentId: d.studentId as string,
          date: d.date as string,
          startTime: (d.startTime as string) ?? null,
          items: (d.items as DailyPlanItem[]) ?? [],
        }
        setPlan(loaded)
        if (!loaded.startTime) {
          setStartTimeInput('09:00')
          setShowStartTimeModal(true)
        }
      } else {
        const fresh: DailyPlan = { id: `${uid}_${date}`, studentId: uid, date, startTime: null, items: [] }
        setPlan(fresh)
        setStartTimeInput('09:00')
        setShowStartTimeModal(true)
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed') } finally { setLoading(false) }
  }, [uid, date])

  useEffect(() => { if (uid) void loadPlan() }, [uid, date, loadPlan])

  useEffect(() => {
    if (Object.keys(timers).length === 0) { if (intervalRef.current) clearInterval(intervalRef.current); return }
    intervalRef.current = setInterval(() => {
      setPlan((prev) => {
        if (!prev) return prev
        const updated = { ...prev, items: prev.items.map((it) => timers[it.id] ? { ...it, timeSpentMs: it.timeSpentMs + 1000 } : it) }
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current)
        saveTimeoutRef.current = setTimeout(() => { void savePlanQuiet(updated.items) }, 5000)
        return updated
      })
    }, 1000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [timers, savePlanQuiet])

  async function savePlan(items: DailyPlanItem[], nextStartTime?: string | null) {
    if (!uid) return
    const startTime = typeof nextStartTime === 'undefined' ? (plan?.startTime ?? null) : nextStartTime
    await setDoc(doc(db, 'student_daily_plans', `${uid}_${date}`), { studentId: uid, date, startTime, items })
    setPlan((p) => p ? { ...p, startTime, items } : p)
  }

  async function loadSuggestions() {
    if (!uid) return
    const [coursesSnap, sessionsSnap, progSnap] = await Promise.all([
      getDocs(collection(db, 'courses')),
      getDocs(collection(db, 'sessions')),
      getDocs(query(collection(db, 'student_lesson_progress'), where('studentId', '==', uid))),
    ])
    const courseMap = new Map<string, string>()
    coursesSnap.forEach((d) => { courseMap.set(d.id, (d.data().title as string) ?? '') })

    const completedItems = new Set<string>()
    progSnap.forEach((d) => {
      const entries = (d.data().entries as ProgressEntry[]) ?? []
      entries.forEach((e) => {
        const id = (e.activityId as string) ?? (e as unknown as { itemId?: string }).itemId
        if (id && (e.status === 'completed' || e.status === 'review')) completedItems.add(id)
      })
    })

    const suggested: SuggestedItem[] = []
    sessionsSnap.forEach((d) => {
      const x = d.data()
      const activities = (x.activities as Array<{ id: string; title: string; type: LessonItemType }>) ?? []
      const cid = (x.courseId as string) ?? ''
      activities.forEach((activity) => {
        const alreadyInPlan = plan?.items.some((p) => p.activityId === activity.id && p.sessionId === d.id)
        if (!completedItems.has(activity.id) && !alreadyInPlan) {
          suggested.push({ sessionId: d.id, sessionTitle: (x.title as string) ?? '', courseId: cid, courseName: courseMap.get(cid) ?? '', activity })
        }
      })
    })
    setSuggestions(suggested.slice(0, 20))
  }

  async function openAddModal() {
    setShowAddModal(true)
    setAddTab('suggest')
    setSelCourseId(''); setSelSessionId(''); setSelActivityId(''); setPlannedMin(30)
    setCustomTitle(''); setCustomCourseId(''); setCustomMinutes(30)
    await Promise.all([loadSuggestions(), loadCourses()])
  }

  async function loadCourses() {
    const snap = await getDocs(collection(db, 'courses'))
    const list: Course[] = []
    snap.forEach((d) => { const x = d.data(); list.push({ id: d.id, title: (x.title as string) ?? '' }) })
    list.sort((a, b) => a.title.localeCompare(b.title))
    setCourses(list)
  }
  async function loadSessions(courseId: string) {
    const snap = await getDocs(query(collection(db, 'sessions'), where('courseId', '==', courseId)))
    const list: Session[] = []
    snap.forEach((d) => {
      const x = d.data()
      list.push({
        id: d.id,
        title: (x.title as string) ?? '',
        subtitle: (x.subtitle as string) ?? '',
        courseId: (x.courseId as string) ?? null,
        courseName: (x.courseName as string) ?? '',
        order: Number(x.order ?? 0),
        activities: (x.activities as Session['activities']) ?? [],
      })
    })
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    setSessions(list)
  }

  function startTimer(id: string) {
    if (!plan) return
    setPlan((p) => p ? { ...p, items: p.items.map((it) => it.id === id && !it.startedAt ? { ...it, startedAt: new Date().toISOString() } : it) } : p)
    setTimers((p) => ({ ...p, [id]: Date.now() }))
  }
  function pauseTimer(id: string) { setTimers((p) => { const n = { ...p }; delete n[id]; return n }); if (plan) void savePlan(plan.items) }
  async function markDone(id: string) { if (!plan) return; pauseTimer(id); await savePlan(plan.items.map((it) => it.id === id ? { ...it, done: !it.done, completedAt: !it.done ? new Date().toISOString() : null } : it)) }
  async function removeItem(id: string) { if (!plan) return; pauseTimer(id); await savePlan(plan.items.filter((it) => it.id !== id)) }

  async function addSuggested(s: SuggestedItem, minutes: number) {
    if (!plan) return
    if (plan.items.some((i) => i.activityId === s.activity.id && i.sessionId === s.sessionId)) { setError('Already in plan'); return }
    const newItem: DailyPlanItem = {
      id: crypto.randomUUID(),
      sessionId: s.sessionId,
      sessionTitle: s.sessionTitle,
      courseId: s.courseId,
      activityId: s.activity.id,
      activityTitle: s.activity.title,
      activityType: s.activity.type,
      plannedMinutes: minutes,
      timeSpentMs: 0,
      done: false,
      startedAt: null,
      completedAt: null,
    }
    await savePlan([...plan.items, newItem])
    setSuggestions((prev) => prev.filter((x) => x.activity.id !== s.activity.id))
  }

  async function addFromBrowser() {
    if (!plan || !selSessionId || !selActivityId) return
    const session = sessions.find((s) => s.id === selSessionId)
    const activity = session?.activities.find((a) => a.id === selActivityId)
    const course = courses.find((c) => c.id === selCourseId)
    if (!session || !activity || !course) return
    if (plan.items.some((i) => i.activityId === selActivityId && i.sessionId === selSessionId)) { setError('Already in plan'); return }
    const newItem: DailyPlanItem = {
      id: crypto.randomUUID(),
      sessionId: selSessionId,
      sessionTitle: session.title,
      courseId: selCourseId,
      activityId: selActivityId,
      activityTitle: activity.title,
      activityType: activity.type,
      plannedMinutes: plannedMin,
      timeSpentMs: 0,
      done: false,
      startedAt: null,
      completedAt: null,
    }
    await savePlan([...plan.items, newItem]); setShowAddModal(false)
  }

  async function saveStartTime() {
    if (!plan) return
    const mins = timeStrToMinutes(startTimeInput)
    if (mins == null) { setError('Please enter a valid start time.'); return }
    setError('')
    await savePlan(plan.items, minutesToTimeStr(mins))
    setShowStartTimeModal(false)
  }

  async function addCustomActivity() {
    if (!plan) return
    const title = customTitle.trim()
    if (!title) { setError('Type an activity name.'); return }
    if (!Number.isFinite(customMinutes) || customMinutes < 5) { setError('Enter minutes (min 5).'); return }
    setError('')
    const course = courses.find((c) => c.id === customCourseId)
    const newItem: DailyPlanItem = {
      id: crypto.randomUUID(),
      sessionId: 'custom',
      sessionTitle: course ? `Custom · ${course.title}` : 'Custom',
      courseId: customCourseId || 'custom',
      activityId: `custom_${crypto.randomUUID()}`,
      activityTitle: title,
      activityType: 'custom',
      plannedMinutes: Math.round(customMinutes),
      timeSpentMs: 0,
      done: false,
      startedAt: null,
      completedAt: null,
    }
    await savePlan([...plan.items, newItem])
    setShowAddModal(false)
  }

  const totalItems = plan?.items.length ?? 0
  const doneItems = plan?.items.filter((i) => i.done).length ?? 0
  const pct = totalItems === 0 ? 0 : Math.round((doneItems / totalItems) * 100)
  const totalPlannedMin = plan?.items.reduce((s, i) => s + i.plannedMinutes, 0) ?? 0
  const totalSpentMs = plan?.items.reduce((s, i) => s + i.timeSpentMs, 0) ?? 0

  const defaultCourseIds = profile?.courseIds ?? []
  const defaultCourses = defaultCourseIds.length ? courses.filter((c) => defaultCourseIds.includes(c.id)) : courses
  const planStartMin = plan?.startTime ? timeStrToMinutes(plan.startTime) : null
  const planEndTime = planStartMin == null ? null : minutesToTimeStr(planStartMin + totalPlannedMin)

  return (
    <div>
      <div className="planner-header">
        <div><h1 style={{ margin: 0 }}>📅 Today's Plan</h1><p className="muted small" style={{ margin: '0.2rem 0 0' }}>Set your daily study activities and track time</p></div>
        <input type="date" className="date-picker" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      {showStartTimeModal && (
        <div className="modal-backdrop" onClick={() => { /* force explicit action */ }}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 0.75rem' }}>Start time for your day</h3>
            <p className="muted small" style={{ marginTop: 0 }}>We’ll calculate real clock times for each activity based on the minutes you plan.</p>
            <div className="form">
              <label>Start time<input type="time" value={startTimeInput} onChange={(e) => setStartTimeInput(e.target.value)} /></label>
              <div className="row">
                <button type="button" className="btn primary" onClick={() => void saveStartTime()}>Save</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {totalItems > 0 && (
        <div className="planner-stats">
          <div className="planner-stat"><span className="planner-stat-value">{doneItems}/{totalItems}</span><span className="muted small">Tasks</span></div>
          <div className="planner-stat"><span className="planner-stat-value">{pct}%</span><span className="muted small">Done</span></div>
          <div className="planner-stat"><span className="planner-stat-value">{totalPlannedMin}m</span><span className="muted small">Planned</span></div>
          <div className="planner-stat"><span className="planner-stat-value">{formatTime(totalSpentMs)}</span><span className="muted small">Spent</span></div>
          {plan?.startTime ? <div className="planner-stat"><span className="planner-stat-value">{plan.startTime}–{planEndTime ?? '—'}</span><span className="muted small">Schedule</span></div> : null}
          <div style={{ flex: 1, minWidth: 120 }}><div className="planner-progress-bar"><div className="planner-progress-fill" style={{ width: `${pct}%` }} /></div></div>
        </div>
      )}

      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="muted">Loading…</p> : null}

      <div className="plan-items-list">
        {plan?.items.map((item, idx) => {
          const isRunning = !!timers[item.id]; const colors = itemTypeColors(item.activityType); const overTime = item.timeSpentMs > item.plannedMinutes * 60000
          const itemStartMin = planStartMin == null ? null : planStartMin + plan.items.slice(0, idx).reduce((s, it) => s + (it.plannedMinutes ?? 0), 0)
          const itemEndMin = itemStartMin == null ? null : itemStartMin + (item.plannedMinutes ?? 0)
          const timeWindow = itemStartMin == null || itemEndMin == null ? null : `${minutesToTimeStr(itemStartMin)}–${minutesToTimeStr(itemEndMin)}`
          return (
            <div key={item.id} className={`plan-item${item.done ? ' done' : ''}`}>
              <button type="button" className={`plan-item-check${item.done ? ' checked' : ''}`} onClick={() => void markDone(item.id)}>{item.done ? '✓' : ''}</button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <span className="tag" style={{ background: colors.bg, color: colors.text, border: 'none', fontSize: '0.75rem' }}>{itemTypeLabel(item.activityType)}</span>
                  <strong style={{ textDecoration: item.done ? 'line-through' : 'none', opacity: item.done ? 0.6 : 1 }}>{item.activityTitle}</strong>
                </div>
                <span className="muted small">{timeWindow ? `${timeWindow} · ` : ''}{item.sessionTitle}</span>
                <div style={{ marginTop: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <span className={`timer-display${isRunning ? ' running' : ''}${overTime ? ' over' : ''}`}>{formatTime(item.timeSpentMs)}</span>
                  <span className="muted small">/ {item.plannedMinutes}m</span>
                  {!item.done && (isRunning
                    ? <button type="button" className="btn small ghost" onClick={() => pauseTimer(item.id)}>⏸ Pause</button>
                    : <button type="button" className="btn small primary" onClick={() => startTimer(item.id)}>▶ Start</button>
                  )}
                  <button type="button" className="btn small ghost" onClick={() => void removeItem(item.id)} style={{ marginLeft: 'auto', opacity: 0.5 }}>✕</button>
                </div>
              </div>
            </div>
          )
        })}
        {plan?.items.length === 0 && !loading && (
          <div className="panel" style={{ textAlign: 'center', padding: '2.5rem' }}>
            <p style={{ fontSize: '2.5rem', margin: 0 }}>📝</p><h3>Plan your day</h3><p className="muted">Add activities below — we'll suggest incomplete ones for you.</p>
          </div>
        )}
      </div>

      <button type="button" className="btn primary" style={{ marginTop: '1rem' }} onClick={() => void openAddModal()}>+ Add Activity</button>
      {plan?.startTime ? (
        <button type="button" className="btn ghost" style={{ marginLeft: '0.5rem', marginTop: '1rem' }} onClick={() => { setStartTimeInput(plan.startTime ?? '09:00'); setShowStartTimeModal(true) }}>
          Edit start time
        </button>
      ) : null}

      {showAddModal && (
        <div className="modal-backdrop" onClick={() => setShowAddModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ margin: '0 0 1rem' }}>Add Activity</h3>
            <div className="course-tabs" style={{ marginBottom: '1rem' }}>
              <button type="button" className={`course-tab${addTab === 'suggest' ? ' active' : ''}`} onClick={() => setAddTab('suggest')}>💡 Suggested</button>
              <button type="button" className={`course-tab${addTab === 'browse' ? ' active' : ''}`} onClick={() => setAddTab('browse')}>📂 Browse</button>
              <button type="button" className={`course-tab${addTab === 'custom' ? ' active' : ''}`} onClick={() => setAddTab('custom')}>✍️ Custom</button>
            </div>

            {addTab === 'suggest' && (
              <div>
                {suggestions.length === 0 ? <p className="muted">No suggestions — all activities are complete or already in your plan!</p> : null}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', maxHeight: '50vh', overflowY: 'auto' }}>
                  {suggestions.map((s) => {
                    const colors = itemTypeColors(s.activity.type)
                    return (
                      <div key={`${s.sessionId}_${s.activity.id}`} className="plan-item" style={{ padding: '0.65rem 0.85rem' }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
                            <span className="tag" style={{ background: colors.bg, color: colors.text, border: 'none', fontSize: '0.7rem' }}>{itemTypeLabel(s.activity.type)}</span>
                            <strong className="small">{s.activity.title}</strong>
                          </div>
                          <span className="muted small">{s.courseName} › {s.sessionTitle}</span>
                        </div>
                        <button type="button" className="btn small primary" onClick={() => void addSuggested(s, 30)}>+ Add</button>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {addTab === 'browse' && (
              <div className="form">
                <label>Course<select value={selCourseId} onChange={(e) => { setSelCourseId(e.target.value); setSelSessionId(''); setSelActivityId(''); if (e.target.value) void loadSessions(e.target.value) }}>
                  <option value="">Select…</option>{defaultCourses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select></label>
                {selCourseId && <label>Session<select value={selSessionId} onChange={(e) => { setSelSessionId(e.target.value); setSelActivityId('') }}>
                  <option value="">Select…</option>
                  {sessions.map((s) => <option key={s.id} value={s.id}>{s.order ? `${s.order}. ` : ''}{s.title}</option>)}
                </select></label>}
                {selSessionId && <label>Activity<select value={selActivityId} onChange={(e) => setSelActivityId(e.target.value)}>
                  <option value="">Select…</option>
                  {sessions.find((s) => s.id === selSessionId)?.activities.map((a) => <option key={a.id} value={a.id}>[{itemTypeLabel(a.type)}] {a.title}</option>)}
                </select></label>}
                {selActivityId && <label>Time (minutes)<input type="number" min={5} max={480} value={plannedMin} onChange={(e) => setPlannedMin(Number(e.target.value))} /></label>}
                <div className="row">
                  <button type="button" className="btn primary" disabled={!selActivityId} onClick={() => void addFromBrowser()}>Add</button>
                  <button type="button" className="btn ghost" onClick={() => setShowAddModal(false)}>Cancel</button>
                </div>
              </div>
            )}

            {addTab === 'custom' && (
              <div className="form">
                <label>Activity name<input value={customTitle} onChange={(e) => setCustomTitle(e.target.value)} placeholder="e.g. Revise notes, Practice questions, Break…" /></label>
                <label>Course (optional)<select value={customCourseId} onChange={(e) => setCustomCourseId(e.target.value)}>
                  <option value="">General</option>
                  {defaultCourses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
                </select></label>
                <label>Time (minutes)<input type="number" min={5} max={480} value={customMinutes} onChange={(e) => setCustomMinutes(Number(e.target.value))} /></label>
                <div className="row">
                  <button type="button" className="btn primary" onClick={() => void addCustomActivity()}>Add</button>
                  <button type="button" className="btn ghost" onClick={() => setShowAddModal(false)}>Cancel</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
