import { useEffect, useState } from 'react'
import { useEditor, EditorContent, type Editor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../../firebase/config'
import { useAuth } from '../../context/AuthContext'
import { uploadLessonImage } from '../../lib/lessonNotesStorage'

interface LessonNotesEditorProps {
  topicId: string
  topicTitle: string
  /** Admin/consultant get the rich editor; everyone else (mentor/"teacher",
   *  manager) gets a read-only rendered page with a print/download link. */
  canEdit: boolean
}

/** Inserts an uploaded image at the current cursor, used by both the toolbar
 *  button and the paste/drop handlers below. */
async function insertUploadedImage(editor: Editor, topicId: string, file: File) {
  const url = await uploadLessonImage(topicId, file)
  editor.chain().focus().setImage({ src: url }).run()
}

function Toolbar({ editor, topicId }: { editor: Editor; topicId: string }) {
  async function onPickImage(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) await insertUploadedImage(editor, topicId, file)
  }

  return (
    <div className="lesson-notes-toolbar">
      <button type="button" className={`btn small ${editor.isActive('bold') ? 'primary' : 'ghost'}`} onClick={() => editor.chain().focus().toggleBold().run()}><strong>B</strong></button>
      <button type="button" className={`btn small ${editor.isActive('italic') ? 'primary' : 'ghost'}`} onClick={() => editor.chain().focus().toggleItalic().run()}><em>I</em></button>
      <button type="button" className={`btn small ${editor.isActive('underline') ? 'primary' : 'ghost'}`} onClick={() => editor.chain().focus().toggleUnderline().run()}><u>U</u></button>
      <button type="button" className={`btn small ${editor.isActive('heading', { level: 2 }) ? 'primary' : 'ghost'}`} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>H2</button>
      <button type="button" className={`btn small ${editor.isActive('heading', { level: 3 }) ? 'primary' : 'ghost'}`} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>H3</button>
      <button type="button" className={`btn small ${editor.isActive('bulletList') ? 'primary' : 'ghost'}`} onClick={() => editor.chain().focus().toggleBulletList().run()}>• List</button>
      <button type="button" className={`btn small ${editor.isActive('orderedList') ? 'primary' : 'ghost'}`} onClick={() => editor.chain().focus().toggleOrderedList().run()}>1. List</button>
      <label className="btn small ghost" style={{ margin: 0 }}>
        🖼️ Image
        <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => void onPickImage(e)} />
      </label>
    </div>
  )
}

export function LessonNotesEditor({ topicId, topicTitle, canEdit }: LessonNotesEditorProps) {
  const { profile } = useAuth()
  const [loading, setLoading] = useState(true)
  const [savedHtml, setSavedHtml] = useState('')
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [error, setError] = useState('')
  // Once there are saved notes, show them read-only by default — "Edit" is an
  // explicit action, and "Save Notes" switches back to the read-only view.
  const [editing, setEditing] = useState(false)

  const editor = useEditor({
    editable: canEdit,
    // This component is lazy-loaded behind a <Suspense> boundary (see
    // SyllabusPage), and TipTap's default `immediatelyRender: true` tries to
    // render synchronously on first render — exactly the combination its own
    // docs warn causes "Cannot read properties of null (reading 'commands')"
    // crashes. `false` defers the first render to an effect instead, which
    // also makes `editor` genuinely `Editor | null` (matching every `editor?.`
    // guard already below) rather than TypeScript's optimistic default type.
    immediatelyRender: false,
    extensions: [
      StarterKit,
      Image,
      Placeholder.configure({ placeholder: 'Write lesson notes — paste text, images, or cliparts…' }),
    ],
    content: '',
    editorProps: {
      // Handles a pasted screenshot/image file (clipboard has actual File
      // objects). An <img src="data:..."> pasted as part of rich HTML (e.g. a
      // small clipart copied from a webpage) isn't intercepted here — it
      // falls through to the Image extension's own default HTML parsing and
      // gets embedded inline, which is fine for the occasional small image.
      handlePaste: (_view, event) => {
        const files = Array.from(event.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
        if (files.length === 0 || !editor) return false
        event.preventDefault()
        void (async () => { for (const file of files) await insertUploadedImage(editor, topicId, file) })()
        return true
      },
    },
  })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const snap = await getDoc(doc(db, 'topic_notes', topicId))
        const html = snap.exists() ? ((snap.data().html as string) ?? '') : ''
        if (cancelled) return
        setSavedHtml(html)
        setEditing(canEdit && !html)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load notes')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [topicId, canEdit])

  // With `immediatelyRender: false` above, `editor` starts out `null` and
  // only becomes ready slightly after mount — syncing content in the fetch
  // effect above (keyed only on `topicId`) would silently no-op via the `?.`
  // whenever that race lands before the editor exists, and never re-run once
  // it does. This re-syncs whenever either one becomes ready.
  useEffect(() => {
    if (!editor) return
    editor.commands.setContent(savedHtml)
  }, [editor, savedHtml])

  async function save() {
    if (!editor) return
    setSaving(true); setError('')
    try {
      const html = editor.getHTML()
      await setDoc(doc(db, 'topic_notes', topicId), {
        topicId, html, updatedAt: serverTimestamp(), updatedBy: profile?.id ?? null,
      })
      setSavedHtml(html)
      setSavedAt(Date.now())
      setEditing(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save notes')
    } finally {
      setSaving(false)
    }
  }

  function openPrintView() {
    window.open(`/lesson-notes-print/${topicId}?title=${encodeURIComponent(topicTitle)}`, '_blank', 'noopener')
  }

  if (loading) return <p className="muted">Loading…</p>

  if (!canEdit) {
    return (
      <div>
        <div className="row" style={{ marginBottom: '1rem' }}>
          <button type="button" className="btn primary small" onClick={openPrintView}>🖨 Print / Download</button>
        </div>
        {error ? <p className="error small">{error}</p> : null}
        {savedHtml ? (
          <div className="lesson-notes-view" dangerouslySetInnerHTML={{ __html: savedHtml }} />
        ) : (
          <p className="muted small">No notes written for this topic yet.</p>
        )}
      </div>
    )
  }

  if (!editing) {
    return (
      <div>
        <div className="row" style={{ marginBottom: '1rem' }}>
          <button type="button" className="btn secondary small" onClick={() => setEditing(true)}>✎ Edit</button>
          <button type="button" className="btn primary small" onClick={openPrintView}>🖨 Print / Download</button>
        </div>
        {error ? <p className="error small">{error}</p> : null}
        {savedHtml ? (
          <div className="lesson-notes-view" dangerouslySetInnerHTML={{ __html: savedHtml }} />
        ) : (
          <p className="muted small">No notes written for this topic yet.</p>
        )}
      </div>
    )
  }

  return (
    <div>
      {error ? <p className="error small" style={{ marginBottom: '0.5rem' }}>{error}</p> : null}
      {editor && <Toolbar editor={editor} topicId={topicId} />}
      <div className="lesson-notes-editor-surface">
        <EditorContent editor={editor} />
      </div>
      <div className="row" style={{ marginTop: '0.75rem', alignItems: 'center' }}>
        <button type="button" className="btn primary small" disabled={saving} onClick={() => void save()}>
          {saving ? 'Saving…' : 'Save Notes'}
        </button>
        {savedHtml && (
          <button type="button" className="btn secondary small" disabled={saving} onClick={() => { editor?.commands.setContent(savedHtml); setEditing(false) }}>
            Cancel
          </button>
        )}
        <button type="button" className="btn secondary small" onClick={openPrintView}>🖨 Print / Download</button>
        {savedAt ? <span className="muted small">Saved ✓</span> : null}
      </div>
    </div>
  )
}
