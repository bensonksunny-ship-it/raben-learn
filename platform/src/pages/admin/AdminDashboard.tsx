import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import { normalizeRoles } from '../../lib/roles'
import type { Course } from '../../types'
import { DashboardImageCard } from '../../components/DashboardImageCard'

interface DashStats {
  students: number
  activeStudents: number
  mentors: number
  courses: number
  sessions: number
}

function formatDate(d: Date) {
  return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })
}

export default function AdminDashboard() {
  const { profile } = useAuth()
  const [stats, setStats] = useState<DashStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { void load() }, [])

  async function load() {
    try {
      const [usersSnap, coursesSnap, sessionsSnap] = await Promise.all([
        getDocs(collection(db, 'users')),
        getDocs(collection(db, 'courses')),
        getDocs(collection(db, 'sessions')),
      ])

      // Users
      let studentCount = 0, activeStudents = 0, mentorCount = 0
      usersSnap.forEach((d) => {
        const x = d.data()
        const roles = normalizeRoles(x)
        if (roles.includes('student')) {
          studentCount++
          if (x.status === 'active') activeStudents++
        }
        if (roles.includes('mentor')) mentorCount++
      })

      // Courses
      const courseList: Course[] = []
      coursesSnap.forEach((d) => { const x = d.data(); courseList.push({ id: d.id, title: (x.title as string) ?? '' }) })

      setStats({ students: studentCount, activeStudents, mentors: mentorCount, courses: courseList.length, sessions: sessionsSnap.size })
    } catch (e) {
      console.error('Dashboard load failed', e)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      {/* Page header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1.75rem' }}>
        <div>
          <h1 style={{ marginBottom: '0.2rem' }}>Dashboard</h1>
          <p className="muted" style={{ margin: 0 }}>
            Welcome back{profile?.name ? `, ${profile.name}` : ''}
          </p>
        </div>
        <span className="page-stat">{formatDate(new Date())}</span>
      </div>

      {loading ? <p className="muted">Loading…</p> : null}

      {/* Stat cards */}
      {stats && (
        <div className="dash-stat-grid">
          {([
            { icon: '🎓', value: stats.students, label: 'Students', sub: `${stats.activeStudents} active`, color: 'var(--primary)', to: '/admin/students' },
            { icon: '👨‍🏫', value: stats.mentors, label: 'Mentors', sub: 'teaching staff', color: '#d97706', to: '/admin/users' },
            { icon: '📚', value: stats.courses, label: 'Courses', sub: 'available', color: '#7c3aed', to: '/admin/syllabus' },
            { icon: '📄', value: stats.sessions, label: 'Sessions', sub: 'total lessons', color: '#059669', to: '/admin/syllabus' },
          ] as const).map((s) => (
            <Link key={s.label} to={s.to} className="panel dash-stat-card">
              <span className="dash-stat-icon">{s.icon}</span>
              <span className="dash-stat-value" style={{ color: s.color }}>{s.value}</span>
              <span className="dash-stat-label">{s.label}</span>
              <span className="muted small">{s.sub}</span>
              <span className="dash-stat-arrow" aria-hidden>→</span>
            </Link>
          ))}
        </div>
      )}

      <DashboardImageCard />
    </div>
  )
}
