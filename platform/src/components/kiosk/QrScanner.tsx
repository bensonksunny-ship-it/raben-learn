import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeScannerState } from 'html5-qrcode'

const ELEMENT_ID = 'kiosk-qr-reader'

/**
 * A small always-on camera box in the corner of the Live Class kiosk screen —
 * a student holds their ID card up to it and it decodes the QR instantly, no
 * tap/click needed. Runs continuously while the kiosk is in its neutral state;
 * `active={false}` pauses the feed (not torn down) while a scanned student's
 * own overlay is on screen, so the same card held in frame doesn't re-trigger
 * mid-overlay, and resuming afterwards doesn't re-request camera permission.
 */
export function QrScanner({ active, onDecode }: { active: boolean; onDecode: (text: string) => void }) {
  const onDecodeRef = useRef(onDecode)
  onDecodeRef.current = onDecode
  const readerRef = useRef<Html5Qrcode | null>(null)
  const [cameraError, setCameraError] = useState(false)

  useEffect(() => {
    let cancelled = false
    const reader = new Html5Qrcode(ELEMENT_ID)

    void (async () => {
      try {
        const cameras = await Html5Qrcode.getCameras()
        if (cancelled) return
        if (cameras.length === 0) { setCameraError(true); return }
        // Most kiosk hardware is a single built-in webcam; if more than one
        // camera is attached (an external USB cam pointed outward), prefer
        // whichever one is labeled as the rear/environment-facing camera.
        const camera = cameras.find((c) => /back|rear|environment/i.test(c.label)) ?? cameras[cameras.length - 1]!
        await reader.start(
          camera.id,
          { fps: 10, qrbox: 230 },
          (decodedText) => onDecodeRef.current(decodedText),
          () => { /* no QR code in frame right now — expected most of the time, not an error */ },
        )
        if (cancelled) { void reader.stop().catch(() => {}); return }
        readerRef.current = reader
      } catch {
        if (!cancelled) setCameraError(true)
      }
    })()

    return () => {
      cancelled = true
      if (readerRef.current) {
        readerRef.current = null
        void reader.stop().then(() => reader.clear()).catch(() => {})
      }
    }
    // Started once for the page's whole lifetime — `active` below pauses/resumes
    // the same running camera instead of restarting it.
  }, [])

  useEffect(() => {
    const reader = readerRef.current
    if (!reader) return
    if (active) {
      if (reader.getState() === Html5QrcodeScannerState.PAUSED) reader.resume()
    } else if (reader.getState() === Html5QrcodeScannerState.SCANNING) {
      reader.pause(true)
    }
  }, [active])

  return (
    <div className="kiosk-scan-box" aria-hidden>
      <div id={ELEMENT_ID} className="kiosk-scan-video" />
      <span className={`kiosk-scan-dot${cameraError ? ' error' : ''}`} />
    </div>
  )
}
