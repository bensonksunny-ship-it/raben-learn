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
  // A front-facing webcam's raw feed moves opposite to how a student moves
  // their card — exactly backwards from the mirrored view everyone already
  // expects from a laptop camera, which made lining the card up with the
  // scan-frame guide much harder than it should be. Mirrored by default
  // (true front-facing-webcam default); a genuine rear/environment camera
  // (picked below only when more than one is available) shows unmirrored,
  // same as a phone's own rear camera preview. Display-only — html5-qrcode
  // decodes from the raw, unmirrored video frames regardless of this CSS
  // transform, so flipping it can never break a scan.
  const [mirrored, setMirrored] = useState(true)

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

  // Set the instant a close is requested, checked again after every await in
  // `openCamera` below — if a student backs out (taps the backdrop) while
  // the camera is still mid-`starting`, the element they were waiting on
  // gets unmounted out from under that still-running attempt, and without
  // this guard it presses on anyway into a now-missing element.
  const cancelledRef = useRef(false)

  async function closeCamera() {
    cancelledRef.current = true
    setStatus('closed')
    await stopReader()
  }

  async function openCamera() {
    cancelledRef.current = false
    // `starting` mounts and fully sizes the live-feed container *before*
    // html5-qrcode measures it to build its own <video> — starting the
    // camera while that box was still the trigger button's size (effectively
    // 0×0 for this purpose) left the feed rendering wrong even though the
    // camera was genuinely active.
    setStatus('starting')
    // Actually wait for that resize to paint, rather than just hoping
    // `getCameras()` below takes long enough to let React's render commit on
    // its own — once camera permission is already granted (the normal case
    // after first use), `getCameras()` can resolve in only a couple of
    // milliseconds, fast enough to race ahead of the paint and still measure
    // the old, tiny size. Double-rAF guarantees the previous render has both
    // committed and actually painted before we go any further.
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    if (cancelledRef.current) return
    // Everything from here on, *including* the constructor, is inside the
    // try — it was sitting outside before, so any failure to find the
    // element (this cancellation race, or anything else) crashed as an
    // uncaught promise rejection instead of landing on the error state below.
    let reader: Html5Qrcode | null = null
    try {
      reader = new Html5Qrcode(ELEMENT_ID)
      const cameras = await Html5Qrcode.getCameras()
      if (cancelledRef.current) return
      if (cameras.length === 0) { setStatus('error'); return }
      // Most kiosk hardware is a single built-in (front-facing) webcam — pick
      // a rear/environment one only if there's genuinely more than one
      // camera to choose from, never force a facingMode a laptop doesn't have.
      const rearCamera = cameras.length > 1 ? cameras.find((c) => /back|rear|environment/i.test(c.label)) : undefined
      const camera = rearCamera ?? cameras[cameras.length - 1]!
      setMirrored(!rearCamera)
      await reader.start(
        camera.id,
        // Just the camera id, nothing else — no `qrbox` (it makes the library
        // insert its own "shaded region" overlay, sized from border-width
        // math that goes wrong against a custom container and can cover the
        // whole preview in a dark tint) and no explicit `videoConstraints`
        // resolution request either (asking a webcam for a specific
        // width/height can make cheap hardware take a long time — or hang —
        // negotiating a mode it has to fake, instead of just handing back
        // its native default instantly). This is the simplest, most
        // broadly-compatible configuration the library supports.
        { fps: 10 },
        (decodedText) => {
          if (onDecodeRef.current(decodedText)) void closeCamera()
        },
        () => { /* no QR code in frame right now — expected most of the time, not an error */ },
      )
      if (cancelledRef.current) { void reader.stop().catch(() => {}); reader.clear(); return }
      readerRef.current = reader
      setStatus('open')
    } catch {
      if (!cancelledRef.current) setStatus('error')
      try { await reader?.stop() } catch { /* never started */ }
      try { reader?.clear() } catch { /* nothing to clear */ }
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
              <div id={ELEMENT_ID} className={`kiosk-scan-video${mirrored ? ' mirrored' : ''}`} aria-hidden />
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
