import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom'
import AppShell from './components/AppShell'
import { RequireCapability } from './components/RequireCapability'
import { Login } from './pages/Login'
import { HomeRedirect } from './pages/HomeRedirect'
import { ChangePassword } from './pages/ChangePassword'
import AdminDashboard from './pages/admin/AdminDashboard'
import { ManagerDashboard } from './pages/admin/ManagerDashboard'
import ProfilePage from './pages/ProfilePage'
import ExamPage from './pages/ExamPage'
import { SyllabusPage } from './pages/admin/SyllabusPage'
import { ReportsPage } from './pages/admin/ReportsPage'
import { MentorDashboard } from './pages/mentor/MentorDashboard'
import { MentorStudentProgress } from './pages/mentor/MentorStudentProgress'
import { StudentDashboard } from './pages/student/StudentDashboard'
import { StudentDailyPlanner } from './pages/student/StudentDailyPlanner'
import { StudentHistory } from './pages/student/StudentHistory'
import { ConsultantDashboard } from './pages/consultant/ConsultantDashboard'

/** Lazy-loaded so admin callable code lives in its own chunk (avoids stale main-bundle caches). */
const UserManagement = lazy(() =>
  import('./pages/admin/UserManagement').then((m) => ({ default: m.UserManagement })),
)
const StudentsPage = lazy(() =>
  import('./pages/admin/StudentsPage').then((m) => ({ default: m.StudentsPage })),
)
const SchedulePage = lazy(() =>
  import('./pages/admin/SchedulePage').then((m) => ({ default: m.SchedulePage })),
)
const StudentPreviewPage = lazy(() =>
  import('./pages/admin/StudentPreviewPage').then((m) => ({ default: m.StudentPreviewPage })),
)
const ConsultantPreviewPage = lazy(() =>
  import('./pages/admin/ConsultantPreviewPage').then((m) => ({ default: m.ConsultantPreviewPage })),
)
const LiveClassPage = lazy(() =>
  import('./pages/admin/LiveClassPage').then((m) => ({ default: m.LiveClassPage })),
)
const ScanPage = lazy(() => import('./pages/ScanPage'))
const ExamPrintView = lazy(() => import('./pages/admin/ExamPrintView'))
const ExamInstructions = lazy(() => import('./pages/exam/ExamInstructions'))
const ExamRunner = lazy(() => import('./pages/exam/ExamRunner'))
const ExamResults = lazy(() => import('./pages/exam/ExamResults'))

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
        {/* Public-ish, outside <AppShell> on purpose — this is where an ID-card QR
            scan lands, and that can't wait on nav chrome or a role-gated dashboard.
            Still requires being signed in (ScanPage handles that itself, with its
            own "please sign in" state) — see firestore.rules' `attendance` match
            for how a scan is authorized without needing a staff role. */}
        <Route
          path="/scan/:studentId/:qrToken"
          element={<Suspense fallback={<AdminRouteFallback />}><ScanPage /></Suspense>}
        />
        <Route path="/" element={<AppShell />}>
          <Route index element={<HomeRedirect />} />
          <Route
            path="manager"
            element={
              <RequireCapability cap="managerArea">
                <ManagerDashboard />
              </RequireCapability>
            }
          />
          <Route
            path="users"
            element={
              <RequireCapability cap="manageUsers">
                <Suspense fallback={<AdminRouteFallback />}>
                  <UserManagement />
                </Suspense>
              </RequireCapability>
            }
          />
          <Route
            path="students"
            element={
              <RequireCapability cap="manageStudents">
                <Suspense fallback={<AdminRouteFallback />}>
                  <StudentsPage />
                </Suspense>
              </RequireCapability>
            }
          />
          <Route
            path="schedule"
            element={
              <RequireCapability cap="manageTimetable">
                <Suspense fallback={<AdminRouteFallback />}>
                  <SchedulePage />
                </Suspense>
              </RequireCapability>
            }
          />
          <Route
            path="manager/student-preview"
            element={
              <RequireCapability cap="managerArea">
                <Suspense fallback={<AdminRouteFallback />}>
                  <StudentPreviewPage />
                </Suspense>
              </RequireCapability>
            }
          />
          <Route
            path="manager/consultant-preview"
            element={
              <RequireCapability cap="managerArea">
                <Suspense fallback={<AdminRouteFallback />}>
                  <ConsultantPreviewPage />
                </Suspense>
              </RequireCapability>
            }
          />
          <Route
            path="live-class"
            element={
              <RequireCapability cap="liveClassArea">
                <Suspense fallback={<AdminRouteFallback />}>
                  <LiveClassPage />
                </Suspense>
              </RequireCapability>
            }
          />
          {/* Academic Consultant's whole area — a small dashboard (stats + a way
              into Syllabus), then Syllabus itself. Admin/mentor already reach the
              same <SyllabusPage> through their own /admin/syllabus,
              /mentor/syllabus routes below, gated on adminArea/mentorArea instead. */}
          <Route
            path="consultant"
            element={
              <RequireCapability cap="syllabusArea">
                <ConsultantDashboard />
              </RequireCapability>
            }
          />
          <Route
            path="syllabus"
            element={
              <RequireCapability cap="syllabusArea">
                <SyllabusPage />
              </RequireCapability>
            }
          />
          {/* Retired — merged into /schedule. Redirects so old bookmarks/links still work. */}
          <Route path="timetable" element={<Navigate to="/schedule" replace />} />
          <Route path="admin/diary" element={<Navigate to="/schedule" replace />} />
          {/* Retired — "Course View" (browsing into a course's lessons/syllabus) is
              gone entirely for students, list page and per-course detail page alike.
              Redirects so old bookmarks/links still land somewhere valid. */}
          <Route path="student/courses" element={<Navigate to="/student" replace />} />
          <Route path="student/courses/:courseId" element={<Navigate to="/student" replace />} />
          {/* Retired — Syllabus Builder now edits a course's title/description/core
              outcome directly, so the separate Planning page (the same `courses`
              collection, outcome-only) was redundant with it. */}
          <Route path="admin/planning" element={<Navigate to="/admin/syllabus" replace />} />
          <Route path="admin" element={<RequireCapability cap="adminArea"><Outlet /></RequireCapability>}>
            <Route index element={<AdminDashboard />} />
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
            <Route
              path="exam-print/:courseId/:examId"
              element={<Suspense fallback={<AdminRouteFallback />}><ExamPrintView /></Suspense>}
            />
          </Route>
          <Route path="mentor" element={<RequireCapability cap="mentorArea"><Outlet /></RequireCapability>}>
            <Route index element={<MentorDashboard />} />
            <Route path="students/:studentId" element={<MentorStudentProgress />} />
            <Route path="syllabus" element={<SyllabusPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route
              path="exam-print/:courseId/:examId"
              element={<Suspense fallback={<AdminRouteFallback />}><ExamPrintView /></Suspense>}
            />
          </Route>
          <Route path="student" element={<RequireCapability cap="studentArea"><Outlet /></RequireCapability>}>
            <Route index element={<StudentDashboard />} />
            <Route path="planner" element={<StudentDailyPlanner />} />
            <Route path="history" element={<StudentHistory />} />
          </Route>
          <Route path="profile" element={<ProfilePage />} />
          <Route path="exam" element={<ExamPage />} />
          <Route
            path="exam/:courseId/:examId/instructions"
            element={<Suspense fallback={<AdminRouteFallback />}><ExamInstructions /></Suspense>}
          />
          <Route
            path="exam/:courseId/:examId/run"
            element={<Suspense fallback={<AdminRouteFallback />}><ExamRunner /></Suspense>}
          />
          <Route
            path="exam/:courseId/:examId/results/:attemptId"
            element={<Suspense fallback={<AdminRouteFallback />}><ExamResults /></Suspense>}
          />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
