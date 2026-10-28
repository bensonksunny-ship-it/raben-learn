import { collection, deleteDoc, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../firebase/config'

/**
 * The student application form — one coordinated record per student
 * (`student_applications/{studentId}`), filled in by the student from their own
 * account (existing students included) or by staff on their behalf, then
 * reviewed and approved by an admin/manager.
 *
 * Uploaded documents live in their own docs (`student_application_files/
 * {studentId}__{kind}`) as compressed data URLs rather than Firebase Storage —
 * the project has no Storage bucket, and keeping each file in a separate doc
 * keeps the application doc itself small and every file under Firestore's 1 MB
 * doc limit.
 */

export type ApplicationStatus = 'draft' | 'submitted' | 'changes_requested' | 'approved' | 'recruited'

/** Where an application lives: an existing student's own (`student_applications/
 *  {uid}`), or a prospective student's before they have an account
 *  (`applicants/{applicantId}`) — same shape, moved across on "Recruit Student". */
export type ApplicationCollection = 'student_applications' | 'applicants'

export type ApplicationFileKind = 'photo' | 'student_id' | 'birth_certificate' | 'parent_id'

export const FILE_KIND_LABEL: Record<ApplicationFileKind, string> = {
  photo: 'Student photo',
  student_id: "Student's ID card",
  birth_certificate: 'Birth certificate',
  parent_id: "Parent's ID card",
}

export interface ApplicationFileMeta {
  fileName: string
  mimeType: string
  size: number
}

export interface ApplicationDeclaration {
  parentName: string
  relation: string
  agreed: boolean
  /** "YYYY-MM-DD" — the day the declaration was made. */
  signedOn: string
}

export interface StudentApplication {
  /** The student's uid — or, for an applicant, their `applicants` doc id. */
  studentId: string
  status: ApplicationStatus

  // Admission (applicants) — the login email their account is created with on
  // recruitment, and the courses (level/syllabus) they're applying for.
  email: string
  targetCourseIds: string[]

  // Student
  fullName: string
  /** "YYYY-MM-DD" */
  dateOfBirth: string
  gender: string
  bloodGroup: string
  phone: string
  address: string
  schoolName: string
  grade: string

  // Parents / guardian
  fatherName: string
  fatherPhone: string
  fatherOccupation: string
  motherName: string
  motherPhone: string
  motherOccupation: string
  parentEmail: string
  emergencyName: string
  emergencyRelation: string
  emergencyPhone: string
  medicalNotes: string

  // Documents
  hasStudentId: boolean
  studentIdType: string
  studentIdNumber: string
  hasBirthCertificate: boolean
  parentIdName: string
  parentIdType: string
  declaration: ApplicationDeclaration | null
  files: Partial<Record<ApplicationFileKind, ApplicationFileMeta>>

  reviewNote: string
}

export function emptyApplication(studentId: string, fullName = ''): StudentApplication {
  return {
    studentId, status: 'draft', email: '', targetCourseIds: [],
    fullName, dateOfBirth: '', gender: '', bloodGroup: '', phone: '', address: '', schoolName: '', grade: '',
    fatherName: '', fatherPhone: '', fatherOccupation: '', motherName: '', motherPhone: '', motherOccupation: '',
    parentEmail: '', emergencyName: '', emergencyRelation: '', emergencyPhone: '', medicalNotes: '',
    hasStudentId: true, studentIdType: '', studentIdNumber: '', hasBirthCertificate: true,
    parentIdName: '', parentIdType: '', declaration: null, files: {},
    reviewNote: '',
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

export function normalizeApplication(studentId: string, d: Record<string, unknown> | undefined, fallbackName = ''): StudentApplication {
  const base = emptyApplication(studentId, fallbackName)
  if (!d) return base
  const status = str(d.status)
  const decl = d.declaration as Record<string, unknown> | null | undefined
  const rawFiles = (d.files as Record<string, Record<string, unknown>> | undefined) ?? {}
  const files: StudentApplication['files'] = {}
  for (const k of Object.keys(FILE_KIND_LABEL) as ApplicationFileKind[]) {
    const f = rawFiles[k]
    if (f) files[k] = { fileName: str(f.fileName), mimeType: str(f.mimeType), size: Number(f.size ?? 0) }
  }
  return {
    ...base,
    status: status === 'submitted' || status === 'changes_requested' || status === 'approved' || status === 'recruited' ? status : 'draft',
    email: str(d.email),
    targetCourseIds: Array.isArray(d.targetCourseIds) ? (d.targetCourseIds as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    fullName: str(d.fullName) || fallbackName,
    dateOfBirth: str(d.dateOfBirth), gender: str(d.gender), bloodGroup: str(d.bloodGroup), phone: str(d.phone),
    address: str(d.address), schoolName: str(d.schoolName), grade: str(d.grade),
    fatherName: str(d.fatherName), fatherPhone: str(d.fatherPhone), fatherOccupation: str(d.fatherOccupation),
    motherName: str(d.motherName), motherPhone: str(d.motherPhone), motherOccupation: str(d.motherOccupation),
    parentEmail: str(d.parentEmail), emergencyName: str(d.emergencyName), emergencyRelation: str(d.emergencyRelation),
    emergencyPhone: str(d.emergencyPhone), medicalNotes: str(d.medicalNotes),
    hasStudentId: d.hasStudentId !== false, studentIdType: str(d.studentIdType), studentIdNumber: str(d.studentIdNumber),
    hasBirthCertificate: d.hasBirthCertificate !== false,
    parentIdName: str(d.parentIdName), parentIdType: str(d.parentIdType),
    declaration: decl
      ? { parentName: str(decl.parentName), relation: str(decl.relation), agreed: decl.agreed === true, signedOn: str(decl.signedOn) }
      : null,
    files,
    reviewNote: str(d.reviewNote),
  }
}

/** True when a missing birth certificate or ID card has to be covered by a
 *  parent's ID card plus the declaration. */
export function needsParentDeclaration(a: StudentApplication): boolean {
  return !a.hasStudentId || !a.hasBirthCertificate
}

/** Every reason the application can't be submitted yet — empty means ready. */
export function validateApplication(a: StudentApplication): string[] {
  const missing: string[] = []
  const req = (v: string, label: string) => { if (!v.trim()) missing.push(label) }
  req(a.fullName, 'Full name')
  req(a.dateOfBirth, 'Date of birth')
  req(a.gender, 'Gender')
  req(a.address, 'Address')
  if (!a.fatherName.trim() && !a.motherName.trim()) missing.push("Father's or mother's name")
  if (!a.fatherPhone.trim() && !a.motherPhone.trim()) missing.push("A parent's phone number")
  req(a.emergencyName, 'Emergency contact name')
  req(a.emergencyPhone, 'Emergency contact phone')
  if (!a.files.photo) missing.push('Student photo')
  if (a.hasStudentId && !a.files.student_id) missing.push("Student's ID card upload")
  if (a.hasBirthCertificate && !a.files.birth_certificate) missing.push('Birth certificate upload')
  if (needsParentDeclaration(a)) {
    if (!a.files.parent_id) missing.push("Parent's ID card upload")
    if (!a.declaration?.agreed || !a.declaration.parentName.trim()) missing.push('Parent declaration')
  }
  return missing
}

export async function loadApplication(
  studentId: string, fallbackName = '', coll: ApplicationCollection = 'student_applications',
): Promise<{ app: StudentApplication; exists: boolean }> {
  const snap = await getDoc(doc(db, coll, studentId))
  return { app: normalizeApplication(studentId, snap.exists() ? snap.data() : undefined, fallbackName), exists: snap.exists() }
}

/** Saves the form fields with the given status. `reviewNote` is only written by
 *  staff (`asStaff`) — the rules reject a student touching it. */
export async function saveApplication(
  a: StudentApplication, status: ApplicationStatus,
  opts: { asStaff: boolean; reviewerId?: string; collection?: ApplicationCollection },
) {
  const { reviewNote, ...fields } = a
  const data: Record<string, unknown> = {
    ...fields,
    status,
    updatedAt: serverTimestamp(),
    ...(status === 'submitted' ? { submittedAt: serverTimestamp() } : {}),
    ...(opts.asStaff ? { reviewNote, ...(status === 'approved' || status === 'changes_requested' ? { reviewedAt: serverTimestamp(), reviewedBy: opts.reviewerId ?? null } : {}) } : {}),
  }
  // `mergeFields` (not `merge: true`) so each written field — notably the `files`
  // map — is replaced wholesale (a removed upload really disappears), while fields
  // this write doesn't name (staff review fields, `submittedAt`) are left alone.
  await setDoc(doc(db, opts.collection ?? 'student_applications', a.studentId), data, { mergeFields: Object.keys(data) })
}

// ---------------------------------------------------------------------------
// Uploaded documents

const fileDocId = (studentId: string, kind: ApplicationFileKind) => `${studentId}__${kind}`

/** Firestore's hard limit is 1 MiB per doc — stay well under it. */
const MAX_DATA_URL_CHARS = 900_000
const MAX_PDF_BYTES = 640_000

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(new Error('Could not read the file.'))
    r.readAsDataURL(file)
  })
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('This image format is not supported — please upload a JPG or PNG.'))
    img.src = src
  })
}

/** Downscales and re-encodes an image as JPEG until it fits in one Firestore doc. */
async function compressImage(file: File, maxSide: number): Promise<string> {
  const img = await loadImage(await readAsDataUrl(file))
  let side = maxSide
  let quality = 0.85
  for (let attempt = 0; attempt < 8; attempt++) {
    const scale = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const url = canvas.toDataURL('image/jpeg', quality)
    if (url.length <= MAX_DATA_URL_CHARS) return url
    if (quality > 0.6) quality -= 0.1
    else side = Math.round(side * 0.8)
  }
  throw new Error('This image is too large — please upload a smaller one.')
}

/** Compresses (images) or size-checks (PDFs) a picked file, stores it in its own
 *  doc, and returns the metadata to record on the application. */
export async function uploadApplicationFile(studentId: string, kind: ApplicationFileKind, file: File): Promise<ApplicationFileMeta> {
  let dataUrl: string
  let mimeType: string
  if (file.type === 'application/pdf') {
    if (file.size > MAX_PDF_BYTES) throw new Error('This PDF is too large (max 600 KB) — upload a photo of the document instead.')
    dataUrl = await readAsDataUrl(file)
    mimeType = 'application/pdf'
  } else if (file.type.startsWith('image/') || file.type === '') {
    dataUrl = await compressImage(file, kind === 'photo' ? 900 : 1600)
    mimeType = 'image/jpeg'
  } else {
    throw new Error('Please upload a photo (JPG/PNG) or a PDF.')
  }
  const meta: ApplicationFileMeta = { fileName: file.name || `${kind}.jpg`, mimeType, size: Math.round(dataUrl.length * 0.75) }
  await setDoc(doc(db, 'student_application_files', fileDocId(studentId, kind)), {
    studentId, kind, dataUrl, ...meta, uploadedAt: serverTimestamp(),
  })
  return meta
}

export async function loadApplicationFile(studentId: string, kind: ApplicationFileKind): Promise<string | null> {
  const snap = await getDoc(doc(db, 'student_application_files', fileDocId(studentId, kind)))
  return snap.exists() ? (snap.data().dataUrl as string | undefined) ?? null : null
}

export async function deleteApplicationFile(studentId: string, kind: ApplicationFileKind): Promise<void> {
  await deleteDoc(doc(db, 'student_application_files', fileDocId(studentId, kind)))
}

// ---------------------------------------------------------------------------
// Applicants → recruitment

/** A fresh id for a new applicant (not yet saved). */
export function newApplicantId(): string {
  return `applicant_${doc(collection(db, 'applicants')).id}`
}

/**
 * Carries an applicant's application over to the newly created student account
 * `uid`: the form (as an approved `student_applications/{uid}`), every uploaded
 * document (re-keyed to the student), and marks the applicant as recruited.
 * The account itself is created by the caller (Cloud Function) first.
 */
export async function moveApplicantToStudent(applicant: StudentApplication, uid: string, reviewerId?: string) {
  await saveApplication({ ...applicant, studentId: uid, reviewNote: '' }, 'approved', { asStaff: true, reviewerId })
  for (const kind of Object.keys(applicant.files) as ApplicationFileKind[]) {
    const snap = await getDoc(doc(db, 'student_application_files', fileDocId(applicant.studentId, kind)))
    if (!snap.exists()) continue
    await setDoc(doc(db, 'student_application_files', fileDocId(uid, kind)), { ...snap.data(), studentId: uid, kind })
  }
  await setDoc(doc(db, 'applicants', applicant.studentId), {
    status: 'recruited', recruitedStudentId: uid, recruitedAt: serverTimestamp(), recruitedBy: reviewerId ?? null,
  }, { merge: true })
}
