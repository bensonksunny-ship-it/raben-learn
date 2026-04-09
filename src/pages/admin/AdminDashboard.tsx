import { Link } from 'react-router-dom'

export default function AdminDashboard() {
  return (
    <div>
      <h1>Admin Dashboard</h1>
      <div className="course-grid">
        <Link to="/admin/students" className="course-card"><h3>🎓 Students</h3><p className="muted">Add students and manage enrollments.</p></Link>
        <Link to="/admin/users" className="course-card"><h3>👤 User Management</h3><p className="muted">Create accounts, assign courses, manage roles.</p></Link>
        <Link to="/admin/syllabus" className="course-card"><h3>📚 Syllabus Builder</h3><p className="muted">Design courses, modules, and sessions.</p></Link>
        <Link to="/admin/reports" className="course-card"><h3>📊 Reports</h3><p className="muted">Per-student progress, course completion rates, time spent.</p></Link>
      </div>
    </div>
  )
}
