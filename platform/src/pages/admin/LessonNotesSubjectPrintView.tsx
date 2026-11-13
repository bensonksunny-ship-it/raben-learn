import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { mapCourseDoc } from '../../lib/courses'
import { readTopicsFromSessionDoc } from '../../lib/topics'
import { levelName } from '../../lib/levels'
import { AppIcon } from '../../components/AppIcon'
import type { Course, Topic } from '../../types'

interface TopicSection {
  topic: Topic
  html: string
}

/** Read-only, printable compilation of every topic's lesson notes for one
 *  subject — opened in a new tab from the Syllabus Builder's "Download Full
 *  Subject PDF" button (same window.print() pattern as LessonNotesPrintView,
 *  just concatenated across every topic in syllabus order instead of one). */
export default function LessonNotesSubjectPrintView() {
  const { courseId } = useParams<{ courseId: string }>()
  const [course, setCourse] = useState<Course | null>(null)
  const [sections, setSections] = useState<TopicSection[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      if (!courseId) return
      try {
        const courseSnap = await getDoc(doc(db, 'courses', courseId))
        if (!courseSnap.exists()) { setError('Subject not found'); return }
        setCourse(mapCourseDoc(courseSnap))

        const sessionsSnap = await getDocs(query(collection(db, 'sessions'), where('courseId', '==', courseId)))
        const sessions = sessionsSnap.docs
          .map((d) => ({ order: Number(d.data().order ?? 0), topics: readTopicsFromSessionDoc(d.data().activities) }))
          .sort((a, b) => a.order - b.order)
        const topics = sessions.flatMap((s) => s.topics)

        const notes = await Promise.all(
          topics.map(async (topic) => {
            const snap = await getDoc(doc(db, 'topic_notes', topic.id))
            const html = snap.exists() ? ((snap.data().html as string) ?? '') : ''
            return { topic, html }
          }),
        )
        setSections(notes.filter((s) => s.html.trim().length > 0))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        setLoading(false)
      }
    })()
  }, [courseId])

  if (loading) return <p style={{ padding: '2rem' }}>Loading…</p>
  if (error) return <p style={{ padding: '2rem', color: '#991b1b' }}>{error}</p>

  const printedOn = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <div className="lesson-notes-print-page lnp-subject">
      <style>{`
        .lesson-notes-print-page { max-width: 760px; margin: 2rem auto; color: #1c1c24; }
        .lnp-sheet {
          background: #fff; border: 1px solid #e3e1f5; border-radius: 16px; overflow: hidden;
          box-shadow: 0 1px 3px rgba(20,16,60,0.06), 0 10px 30px rgba(20,16,60,0.07);
        }
        .lnp-accent { height: 10px; background: linear-gradient(90deg, #4C3FB4, #8B7CF0, #2d62c8); }
        .lnp-header { display: flex; align-items: center; gap: 0.75rem; padding: 1.75rem 2.25rem 1.1rem; border-bottom: 1px solid #ece9fb; }
        .lnp-header .icon { width: 40px; height: 40px; flex-shrink: 0; }
        .lnp-wordmark { font-family: 'Fraunces', Georgia, serif; font-style: italic; font-weight: 600; font-size: 1.1rem; color: #352569; letter-spacing: -0.01em; }
        .lnp-kicker { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #8B7CF0; margin-top: 0.1rem; }
        .lnp-body-pad { padding: 1.5rem 2.25rem 2.25rem; }
        .lnp-cover { padding: 2.5rem 2.25rem 2.25rem; text-align: center; }
        .lnp-cover .lnp-level { font-size: 0.78rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #8B7CF0; margin: 0 0 0.6rem; }
        .lnp-cover h1 { font-family: 'Fraunces', Georgia, serif; font-weight: 600; font-size: 2rem; letter-spacing: -0.01em; margin: 0 0 0.5rem; color: #241B52; }
        .lnp-cover .lnp-subtitle { color: #555; margin: 0 0 1.5rem; }
        .lnp-cover .lnp-meta { color: #8b87a6; font-size: 0.85rem; }
        .lesson-notes-print-page h1 {
          font-family: 'Fraunces', Georgia, serif; font-weight: 600; font-size: 1.7rem; letter-spacing: -0.01em;
          margin: 0 0 1.5rem; padding-bottom: 1.1rem; border-bottom: 2px solid #ece9fb; color: #241B52;
        }
        .lnp-topic-section { padding: 2rem 2.25rem; border-top: 1px solid #ece9fb; }
        .lnp-topic-section .lnp-topic-kicker { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #8B7CF0; margin: 0 0 0.3rem; }
        .lnp-topic-section h2.lnp-topic-title {
          font-family: 'Fraunces', Georgia, serif; font-weight: 600; font-size: 1.4rem; letter-spacing: -0.01em;
          margin: 0 0 1rem; color: #241B52;
        }
        .print-btn-row { max-width: 760px; margin: 0 auto 1rem; display: flex; justify-content: flex-end; }
        .lesson-notes-print-page .notes-body img { max-width: 100%; border-radius: 10px; margin: 0.75rem 0; box-shadow: 0 2px 10px rgba(20,16,60,0.1); }
        .lesson-notes-print-page .notes-body { line-height: 1.75; font-size: 1.02rem; }
        .lesson-notes-print-page .notes-body h2, .lesson-notes-print-page .notes-body h3 { font-family: 'Fraunces', Georgia, serif; color: #241B52; }
        .lesson-notes-print-page .empty { color: #777; font-style: italic; }
        .lnp-footer { display: flex; justify-content: space-between; padding: 1rem 2.25rem; border-top: 1px solid #ece9fb; font-size: 0.75rem; color: #8b87a6; }
        @media print {
          .print-btn-row { display: none; }
          .lesson-notes-print-page { margin: 0; max-width: none; }
          .lnp-sheet { border: none; border-radius: 0; box-shadow: none; }
          .lnp-cover { page-break-after: always; }
          .lnp-topic-section { page-break-before: always; border-top: none; }
          .sidebar, .launcher-fab { display: none !important; }
          .main { margin: 0 !important; }
          @page { margin: 1.5cm; }
        }
      `}</style>

      <div className="print-btn-row">
        <button type="button" className="btn primary" onClick={() => window.print()}>🖨 Print / Save as PDF</button>
      </div>

      <div className="lnp-sheet">
        <div className="lnp-accent" />
        <div className="lnp-header">
          <AppIcon className="icon" />
          <div>
            <div className="lnp-wordmark">ROL's</div>
            <div className="lnp-kicker">Lesson Notes Compilation</div>
          </div>
        </div>

        <div className="lnp-cover">
          {course?.levelId !== null && course?.levelId !== undefined ? <p className="lnp-level">{levelName(course.levelId)}</p> : null}
          <h1>{course?.title ?? 'Subject'}</h1>
          {course?.description ? <p className="lnp-subtitle">{course.description}</p> : null}
          <p className="lnp-meta">{sections.length} topic{sections.length === 1 ? '' : 's'} · Printed {printedOn}</p>
        </div>

        {sections.length === 0 ? (
          <div className="lnp-body-pad">
            <p className="empty">No lesson notes have been written for this subject yet.</p>
          </div>
        ) : (
          sections.map(({ topic, html }, idx) => (
            <div className="lnp-topic-section" key={topic.id}>
              <p className="lnp-topic-kicker">Topic {idx + 1} of {sections.length}</p>
              <h2 className="lnp-topic-title">{topic.title}</h2>
              <div className="notes-body" dangerouslySetInnerHTML={{ __html: html }} />
            </div>
          ))
        )}

        <div className="lnp-footer">
          <span>ROL's</span>
          <span>Printed {printedOn}</span>
        </div>
      </div>
    </div>
  )
}
