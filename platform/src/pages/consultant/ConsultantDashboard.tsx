import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { mapCourseDoc } from '../../lib/courses'
import { readTopicsFromSessionDoc } from '../../lib/topics'
import type { Course } from '../../types'
import { WelcomeBanner } from '../../components/WelcomeBanner'
import { CoursesIcon, SessionsIcon } from '../../components/manager/StatIcons'
import { NavCard } from '../../components/manager/NavCard'

interface ConsultantStats {
  courses: number
  sessions: number
  topics: number
  levelsCovered: number
}

/**
 * Landing page for the Academic Consultant role — a glance at the curriculum
 * (courses/sessions/topics, scoped to exactly what this role cares about; no
 * student/mentor counts like AdminDashboard's, since consultant has no access
 * to that part of the app at all), then straight into the one real tool:
 * Syllabus. `homePath()`/`AppShell`'s Home icon both point here now instead of
 * jumping straight to `/syllabus`, same as every other role gets a dashboard
 * first.
 */
export function ConsultantDashboard() {
  const [stats, setStats] = useState<ConsultantStats | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      try {
        const [coursesSnap, sessionsSnap] = await Promise.all([
          getDocs(collection(db, 'courses')),
          getDocs(collection(db, 'sessions')),
        ])
        const courses: Course[] = coursesSnap.docs.map(mapCourseDoc)
        let topicCount = 0
        sessionsSnap.forEach((d) => { topicCount += readTopicsFromSessionDoc(d.data().activities).length })
        const levelsCovered = new Set(courses.filter((c) => c.levelId !== null).map((c) => c.levelId)).size
        setStats({ courses: courses.length, sessions: sessionsSnap.size, topics: topicCount, levelsCovered })
      } catch (e) {
        console.error('ConsultantDashboard load failed', e)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  return (
    <div>
      <WelcomeBanner title="Shape the curriculum" subtitle="Review and refine every course and syllabus in one place." />

      {loading ? <p className="muted">Loading…</p> : null}

      {stats && (
        <div className="dash-stat-grid" style={{ marginBottom: '1.75rem' }}>
          <Link to="/syllabus" className="panel dash-stat-card">
            <span className="dash-stat-icon"><CoursesIcon color="#7c3aed" /></span>
            <span className="dash-stat-value" style={{ color: '#7c3aed' }}>{stats.courses}</span>
            <span className="dash-stat-label">Courses</span>
            <span className="muted small">across {stats.levelsCovered} level{stats.levelsCovered === 1 ? '' : 's'}</span>
            <span className="dash-stat-arrow" aria-hidden>→</span>
          </Link>
          <Link to="/syllabus" className="panel dash-stat-card">
            <span className="dash-stat-icon"><SessionsIcon color="#059669" /></span>
            <span className="dash-stat-value" style={{ color: '#059669' }}>{stats.sessions}</span>
            <span className="dash-stat-label">Sessions</span>
            <span className="muted small">{stats.topics} topic{stats.topics === 1 ? '' : 's'} total</span>
            <span className="dash-stat-arrow" aria-hidden>→</span>
          </Link>
        </div>
      )}

      <div className="nav-card-grid">
        <NavCard icon="📚" title="Syllabus" color="#7c3aed" to="/syllabus" />
      </div>
    </div>
  )
}
