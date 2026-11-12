import { useEffect, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { normalizeRoles } from '../../lib/roles'
import type { AttendanceCheckpoint } from '../../types'
import { todayStr } from './schedulerShared'

interface TodayStats { students: number; mentors: number; present: number; late: number }

async function loadTodayStats(): Promise<TodayStats> {
  const [usersSnap, attendanceSnap] = await Promise.all([
    getDocs(collection(db, 'users')),
    getDocs(query(collection(db, 'attendance'), where('date', '==', todayStr()))),
  ])

  const studentIds = new Set<string>()
  let mentors = 0
  usersSnap.forEach((d) => {
    const x = d.data()
    if (x.status === 'disabled') return
    const roles = normalizeRoles(x)
    if (roles.includes('student')) studentIds.add(d.id)
    if (roles.includes('mentor')) mentors++
  })

  let present = 0
  let late = 0
  attendanceSnap.forEach((d) => {
    const x = d.data()
    const checkpoints = (x.checkpoints as AttendanceCheckpoint[]) ?? []
    if (!studentIds.has(x.studentId as string) || checkpoints.length === 0) return
    present++
    if (checkpoints.some((c) => c.kind === 'login' && c.status === 'late')) late++
  })

  return { students: studentIds.size, mentors, present, late }
}

/** Today's numbers for the Manager Dashboard — "—" until loaded or if a read fails. */
export function ManagerTodayStats() {
  const [stats, setStats] = useState<TodayStats | null>(null)

  useEffect(() => {
    let cancelled = false
    loadTodayStats()
      .then((s) => { if (!cancelled) setStats(s) })
      .catch((e) => console.error('ManagerTodayStats load failed', e))
    return () => { cancelled = true }
  }, [])

  const cards = [
    { icon: '🎒', value: stats?.students ?? '—', label: 'Students', sub: 'active', color: '#f97316' },
    { icon: '✅', value: stats ? `${stats.present}/${stats.students}` : '—', label: 'Present Today', sub: stats ? `${stats.students - stats.present} absent` : '', color: '#059669' },
    { icon: '⏰', value: stats?.late ?? '—', label: 'Late Today', sub: 'students', color: stats?.late ? '#d97706' : 'var(--muted-2)' },
    { icon: '🧑‍🏫', value: stats?.mentors ?? '—', label: 'Mentors', sub: 'active', color: '#3b82f6' },
  ]

  return (
    <div className="dash-stat-grid" style={{ marginBottom: '1.75rem' }}>
      {cards.map((c) => (
        <div key={c.label} className="panel dash-stat-card">
          <span className="dash-stat-icon">{c.icon}</span>
          <span className="dash-stat-value" style={{ color: c.color }}>{c.value}</span>
          <span className="dash-stat-label">{c.label}</span>
          <span className="muted small">{c.sub}</span>
        </div>
      ))}
    </div>
  )
}
