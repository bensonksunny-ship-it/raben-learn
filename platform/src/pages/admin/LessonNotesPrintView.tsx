import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../../firebase/config'

/** Read-only, printable view of one topic's lesson notes — opened in a new tab
 *  from the Notes modal's "Print / Download" button (mirrors ExamPrintView's
 *  own window.print() pattern). Any signed-in user can reach it directly by
 *  URL; the real access boundary is the `topic_notes` Firestore rule, same
 *  tradeoff the exam rules already make for exam content. */
export default function LessonNotesPrintView() {
  const { topicId } = useParams<{ topicId: string }>()
  const [html, setHtml] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    void (async () => {
      if (!topicId) return
      try {
        const snap = await getDoc(doc(db, 'topic_notes', topicId))
        setHtml(snap.exists() ? ((snap.data().html as string) ?? '') : '')
        setTitle((new URLSearchParams(window.location.search).get('title')) ?? 'Lesson Notes')
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        setLoading(false)
      }
    })()
  }, [topicId])

  if (loading) return <p style={{ padding: '2rem' }}>Loading…</p>
  if (error) return <p style={{ padding: '2rem', color: '#991b1b' }}>{error}</p>

  return (
    <div className="lesson-notes-print-page">
      <style>{`
        .lesson-notes-print-page { max-width: 760px; margin: 0 auto; padding: 2rem; font-family: Georgia, 'Times New Roman', serif; color: #111; }
        .lesson-notes-print-page h1 { font-size: 1.4rem; margin: 0 0 1.5rem; }
        .lesson-notes-print-page .print-btn { margin-bottom: 1.5rem; }
        .lesson-notes-print-page .notes-body img { max-width: 100%; border-radius: 6px; }
        .lesson-notes-print-page .notes-body { line-height: 1.6; }
        .lesson-notes-print-page .empty { color: #777; font-style: italic; }
        @media print {
          .print-btn { display: none; }
          .lesson-notes-print-page { padding: 0; }
          .sidebar, .launcher-fab { display: none !important; }
          .main { margin: 0 !important; }
        }
      `}</style>

      <button type="button" className="btn primary print-btn" onClick={() => window.print()}>🖨 Print / Save as PDF</button>

      <h1>{title}</h1>
      {html ? (
        <div className="notes-body" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <p className="empty">No notes written for this topic yet.</p>
      )}
    </div>
  )
}
