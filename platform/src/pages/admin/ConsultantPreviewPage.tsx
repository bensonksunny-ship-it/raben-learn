import { SyllabusPage } from './SyllabusPage'

/**
 * Read-only preview of an Academic Consultant's one page — Syllabus — same
 * spirit as "Preview Student View" next to it on the sidebar. Unlike a
 * student's dashboard, the syllabus isn't per-person data, so there's no
 * picker here — it's just the real page, rendered with every edit affordance
 * (Add Course, rename/delete, the Exam button, the editable topic grid)
 * turned off via `readOnly`. The real role does have full add/edit rights on
 * it; only this preview is locked down, so an admin/manager can look without
 * risking a real change.
 */
export function ConsultantPreviewPage() {
  return (
    <div>
      <div className="panel" style={{ marginBottom: '1.5rem', background: '#fae8ff', borderColor: '#e9a8f2' }}>
        <strong>👁️ Read-only preview — Academic Consultant</strong>
      </div>
      <SyllabusPage readOnly />
    </div>
  )
}
