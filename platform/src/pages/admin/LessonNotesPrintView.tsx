import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { AppIcon } from '../../components/AppIcon'

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

  const printedOn = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })

  return (
    <div className="lesson-notes-print-page">
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
        .lesson-notes-print-page h1 {
          font-family: 'Fraunces', Georgia, serif; font-weight: 600; font-size: 1.7rem; letter-spacing: -0.01em;
          margin: 0 0 1.5rem; padding-bottom: 1.1rem; border-bottom: 2px solid #ece9fb; color: #241B52;
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
            <div className="lnp-wordmark">Raben Learn</div>
            <div className="lnp-kicker">Lesson Notes</div>
          </div>
        </div>
        <div className="lnp-body-pad">
          <h1>{title}</h1>
          {html ? (
            <div className="notes-body" dangerouslySetInnerHTML={{ __html: html }} />
          ) : (
            <p className="empty">No notes written for this topic yet.</p>
          )}
        </div>
        <div className="lnp-footer">
          <span>Raben Learn</span>
          <span>Printed {printedOn}</span>
        </div>
      </div>
    </div>
  )
}
