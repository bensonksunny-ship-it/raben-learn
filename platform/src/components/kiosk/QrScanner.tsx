import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'

const ELEMENT_ID = 'kiosk-qr-reader'

type Status = 'closed' | 'starting' | 'open' | 'error'

/**
 * The Live Class kiosk's camera — a small inline "Tap to Scan" trigger beside
 * the header's other controls. Tapping it opens the live feed as its own
 * centered, backdropped card (not floating over the page), with a scan-frame
 * guide and a close button, easy for a student to line their ID card up
 * against. Closes itself the moment `onDecode` reports a valid scan (returns
 * `true`) — an unrecognized/noise decode (`false`) just keeps it open and
 * scanning.
 */
export function QrScanner({ onDecode }: { onDecode: (text: string) => boolean }) {
  const onDecodeRef = useRef(onDecode)
  const readerRef = useRef<Html5Qrcode | null>(null)
  const [status, setStatus] = useState<Status>('closed')

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
    setStatus('closed')
    await stopReader()
  }

  async function openCamera() {
    // `starting` mounts and fully sizes the live-feed container *before*
    // html5-qrcode measures it to build its own <video> — starting the
    // camera while that box was still the trigger button's size (effectively
    // 0×0 for this purpose) left the feed rendering wrong even though the
    // camera was genuinely active.
    setStatus('starting')
    const reader = new Html5Qrcode(ELEMENT_ID)
    try {
      const cameras = await Html5Qrcode.getCameras()
      if (cameras.length === 0) { setStatus('error'); return }
      // Most kiosk hardware is a single built-in (front-facing) webcam — pick
      // a rear/environment one only if there's genuinely more than one
      // camera to choose from, never force a facingMode a laptop doesn't have.
      const camera = cameras.length > 1
        ? cameras.find((c) => /back|rear|environment/i.test(c.label)) ?? cameras[cameras.length - 1]!
        : cameras[0]!
      await reader.start(
        camera.id,
        {
          // No `qrbox` — that option makes the library insert its own "shaded
          // region" overlay div, sized from border-width math against the
          // viewfinder's reported dimensions. Against a custom (non-default)
          // container size that math produces oversized borders that can
          // cover almost the entire preview in a dark tint — a known source
          // of a camera that's genuinely streaming but looks black. Our own
          // `.kiosk-scan-frame` below already draws the visible scan-frame
          // guide, so this isn't needed.
          fps: 15,
          // Passing just a camera id (no `videoConstraints`) leaves
          // html5-qrcode requesting the browser's bare default resolution —
          // often quite low — which makes the decoder need the card held
          // closer/stiller and more frames to land a successful read. Asking
          // for a sharper capture up front (still the same exact camera)
          // gives the decoder far more detail per scan, so it reads faster
          // and more reliably. `ideal` lets the browser fall back gracefully
          // on hardware that can't do 720p.
          videoConstraints: { deviceId: { exact: camera.id }, width: { ideal: 1280 }, height: { ideal: 720 } },
        },
        (decodedText) => {
          if (onDecodeRef.current(decodedText)) void closeCamera()
        },
        () => { /* no QR code in frame right now — expected most of the time, not an error */ },
      )
      readerRef.current = reader
      setStatus('open')
    } catch {
      setStatus('error')
      try { await reader.stop() } catch { /* never started */ }
      try { reader.clear() } catch { /* nothing to clear */ }
    }
  }

  // Closes the camera if this component ever unmounts while still open
  // (e.g. the whole kiosk page navigates away) — never leaves a stream running.
  useEffect(() => () => { void stopReader() }, [])

  const overlayOpen = status === 'starting' || status === 'open' || status === 'error'

  return (
    <>
      <button type="button" className="btn primary kiosk-scan-trigger" disabled={overlayOpen} onClick={() => void openCamera()}>
        📷 Tap to Scan
      </button>
      {overlayOpen && (
        <div className="kiosk-scan-backdrop" onClick={() => void closeCamera()}>
          <div className="kiosk-scan-card" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="kiosk-scan-close" onClick={() => void closeCamera()} title="Close camera" aria-label="Close camera">✕</button>
            <div className="kiosk-scan-video-wrap">
              <div id={ELEMENT_ID} className="kiosk-scan-video" aria-hidden />
              <div className="kiosk-scan-frame" aria-hidden />
              {status === 'open' && <span className="kiosk-scan-dot" aria-hidden />}
            </div>
            {status === 'starting' && <p className="muted small" style={{ margin: 0 }}>Starting camera…</p>}
            {status === 'error' && <p className="error small" style={{ margin: 0 }}>Couldn't access the camera — check permissions and try again.</p>}
          </div>
        </div>
      )}
    </>
  )
}
