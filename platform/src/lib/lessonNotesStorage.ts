import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { storage } from '../firebase/storage'

/** Uploads one image for a topic's lesson notes and returns its public URL —
 *  used both by the toolbar's "Insert image" button and by the editor's
 *  paste/drop handlers (pasted screenshots, dragged image files). */
export async function uploadLessonImage(topicId: string, file: File): Promise<string> {
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')
  const path = `lesson_notes/${topicId}/${crypto.randomUUID()}-${safeName}`
  const fileRef = ref(storage, path)
  await uploadBytes(fileRef, file)
  return getDownloadURL(fileRef)
}
