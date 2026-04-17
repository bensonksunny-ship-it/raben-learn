import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import AppShell from './components/AppShell'
import { Login } from './pages/Login'
import { HomeRedirect } from './pages/HomeRedirect'
import { ChangePassword } from './pages/ChangePassword'
import { SyllabusPage } from './pages/admin/SyllabusPage'
import { ReportsPage } from './pages/admin/ReportsPage'
import { MentorDashboard } from './pages/mentor/MentorDashboard'
import { MentorStudentProgress } from './pages/mentor/MentorStudentProgress'
import { StudentDashboard } from './pages/student/StudentDashboard'
import { StudentCourseView } from './pages/student/StudentCourseView'
import { StudentDailyPlanner } from './pages/student/StudentDailyPlanner'
import { StudentHistory } from './pages/student/StudentHistory'

/** Lazy-loaded so admin callable code lives in its own chunk (avoids stale main-bundle caches). */
const UserManagement = lazy(() =>
  import('./pages/admin/UserManagement').then((m) => ({ default: m.UserManagement })),
)
const StudentsPage = lazy(() =>
  import('./pages/admin/StudentsPage').then((m) => ({ default: m.StudentsPage })),
)

function AdminRouteFallback() {
  return (
    <div style={{ padding: '2rem' }}>
      <p className="muted">Loading…</p>
    </div>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/change-password" element={<ChangePassword />} />
        <Route path="/" element={<AppShell />}>
          <Route index element={<HomeRedirect />} />
          <Route path="admin">
            <Route
              index
              element={
                <Suspense fallback={<AdminRouteFallback />}>
                  <UserManagement />
                </Suspense>
              }
            />
            <Route
              path="users"
              element={
                <Suspense fallback={<AdminRouteFallback />}>
                  <UserManagement />
                </Suspense>
              }
            />
            <Route
              path="students"
              element={
                <Suspense fallback={<AdminRouteFallback />}>
                  <StudentsPage />
                </Suspense>
              }
            />
            <Route path="syllabus" element={<SyllabusPage />} />
            <Route path="lessons" element={<SyllabusPage />} />
            <Route path="reports" element={<ReportsPage />} />
          </Route>
          <Route path="mentor">
            <Route index element={<MentorDashboard />} />
            <Route path="students/:studentId" element={<MentorStudentProgress />} />
            <Route path="syllabus" element={<SyllabusPage />} />
            <Route path="reports" element={<ReportsPage />} />
          </Route>
          <Route path="student">
            <Route index element={<StudentDashboard />} />
            <Route path="courses/:courseId" element={<StudentCourseView />} />
            <Route path="planner" element={<StudentDailyPlanner />} />
            <Route path="history" element={<StudentHistory />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
