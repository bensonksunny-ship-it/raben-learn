import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'

const ELEMENT_ID = 'kiosk-qr-reader'

/**
 * The Live Class kiosk's camera — off by default. Someone taps "Tap to Scan"
 * to open it (so it isn't recording in the background the whole time), holds
 * the student's ID card up to the live preview, and it decodes the QR and
 * closes itself again the moment `onDecode` reports a valid scan (returns
 * `true`) — an unrecognized/noise decode (`false`) just keeps it open and
 * scanning. The box renders top-center, where most laptop/Chromebook webcams
 * physically sit, so the on-screen preview lines up with the real lens.
 */
export function QrScanner({ onDecode }: { onDecode: (text: string) => boolean }) {
  const onDecodeRef = useRef(onDecode)
  const readerRef = useRef<Html5Qrcode | null>(null)
  const [open, setOpen] = useState(false)
  const [starting, setStarting] = useState(false)
  const [cameraError, setCameraError] = useState(false)

  useEffect(() => {
    onDecodeRef.current = onDecode
  }, [onDecode])

  async function stopReader() {
    const reader = readerRef.current
    readerRef.current = null
    if (!reader) return
    try { await reader.stop() } catch { /* already stopped */ }
    try { reader.clear() } catch { /* nothing to clear */ }
  }

  async function closeCamera() {
    setOpen(false)
    await stopReader()
  }

  async function openCamera() {
    setCameraError(false)
    setStarting(true)
    const reader = new Html5Qrcode(ELEMENT_ID)
    try {
      const cameras = await Html5Qrcode.getCameras()
      if (cameras.length === 0) { setCameraError(true); return }
      // Most kiosk hardware is a single built-in webcam; if more than one
      // camera is attached (an external USB cam pointed outward), prefer
      // whichever one is labeled as the rear/environment-facing camera.
      const camera = cameras.find((c) => /back|rear|environment/i.test(c.label)) ?? cameras[cameras.length - 1]!
      await reader.start(
        camera.id,
        { fps: 10, qrbox: 230 },
        (decodedText) => {
          if (onDecodeRef.current(decodedText)) void closeCamera()
        },
        () => { /* no QR code in frame right now — expected most of the time, not an error */ },
      )
      readerRef.current = reader
      setOpen(true)
    } catch {
      setCameraError(true)
      try { await reader.stop() } catch { /* never started */ }
      try { reader.clear() } catch { /* nothing to clear */ }
    } finally {
      setStarting(false)
    }
  }

  // Closes the camera if this component ever unmounts while still open
  // (e.g. the whole kiosk page navigates away) — never leaves a stream running.
  useEffect(() => () => { void stopReader() }, [])

  return (
    <div className="kiosk-scan-box">
      <div id={ELEMENT_ID} className="kiosk-scan-video" aria-hidden />
      {open ? (
        <>
          <span className="kiosk-scan-dot" aria-hidden />
          <button type="button" className="kiosk-scan-close" onClick={() => void closeCamera()} title="Close camera" aria-label="Close camera">✕</button>
        </>
      ) : (
        <div className="kiosk-trigger-overlay">
          <button type="button" className="btn primary kiosk-trigger-btn" disabled={starting} onClick={() => void openCamera()}>
            {starting ? 'Starting camera…' : '📷 Tap to Scan'}
          </button>
          {cameraError && <p className="error small" style={{ margin: 0 }}>Couldn't access the camera.</p>}
        </div>
      )}
    </div>
  )
}
