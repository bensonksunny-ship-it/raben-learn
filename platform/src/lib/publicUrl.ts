/** Permanent production site that shareable/printed links always point at — so a
 *  link is the same whether it's generated on localhost, Firebase Hosting, or a
 *  per-deploy Vercel preview URL. Override with `VITE_PUBLIC_APP_URL` if the
 *  domain changes. Used by the Live Class kiosk link and ID-card QR codes. */
export const PUBLIC_APP_URL = (import.meta.env.VITE_PUBLIC_APP_URL as string | undefined)?.trim().replace(/\/+$/, '')
  || 'https://platform-beta-cyan.vercel.app'

/** The QR printed on a student's ID card — opens the Live Class check-in page
 *  already carrying the student's id and token (see `/scan/:studentId/:qrToken`). */
export function studentScanUrl(studentId: string, qrToken: string): string {
  return `${PUBLIC_APP_URL}/scan/${studentId}/${qrToken}`
}
