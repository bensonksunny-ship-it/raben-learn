export default function ExamPage() {
  return (
    <div>
      <div style={{ marginBottom: '1.75rem' }}>
        <h1 style={{ marginBottom: '0.2rem' }}>Exams</h1>
        <p className="muted" style={{ margin: 0 }}>Your assigned exams will appear here</p>
      </div>

      <div className="panel" style={{ textAlign: 'center', padding: '3rem 2rem' }}>
        <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>📝</div>
        <h2 style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>No exams yet</h2>
        <p className="muted small" style={{ margin: 0 }}>Exams assigned to you will show up here.</p>
      </div>
    </div>
  )
}
