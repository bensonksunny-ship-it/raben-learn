import QRCodeStyling from 'qr-code-styling'

/**
 * Print-ready student ID card, drawn on a canvas and exported as two separate
 * JPEGs (front / back). Portrait CR80 card size (2.125" × 3.375") at 600 dpi.
 */
const W = 1275
const H = 2025
const BRAND = '#ff8a3d'
const BRAND_DARK = '#e0662a'
const INK = '#1f2a44'
const MUTED = '#6b7690'

export interface IdCardFrontData {
  name: string
  studentCode: string
  grade: string
  dateOfBirth: string
  bloodGroup: string
  photoDataUrl: string | null
}

export interface IdCardBackData {
  scanUrl: string | null
  emergencyName: string
  emergencyPhone: string
  address: string
}

export interface BadgeData {
  name: string
  studentCode: string
  grade: string
  scanUrl: string | null
}

/** Single-sided 58 mm circular badge, full-bleed — same brand/QR data as the
 *  card, laid out round. The circle exactly fills the canvas (no extra
 *  bleed margin or cut-line guides). 1370 px at 600 dpi is exactly 58 mm
 *  (1370 / 600 * 25.4 = 58.0 mm) — well above the 300 dpi / 685 px floor,
 *  and the PNG gets its DPI embedded (`withPngDpi` below) so printing "at
 *  100% / actual size" actually comes out to a true 58 mm circle instead of
 *  whatever the print driver's own default DPI assumption happens to be. */
const BADGE_D = 1370
const BADGE_DPI = 600

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load image'))
    img.src = src
  })
}

/** The one QR renderer for both the card's back and the badge — same data,
 *  same stylized look, so a printed card and badge for the same student
 *  always carry an identical-looking code. Rounded data dots + extra-rounded
 *  finder frames with round eye dots (the modern look, not harsh squares),
 *  high error correction and a real quiet zone (`margin`) so a kiosk camera
 *  reads it instantly, and full black-on-white contrast regardless of the
 *  surrounding design's own colors. */
async function renderStyledQr(data: string, size: number): Promise<HTMLImageElement> {
  const qr = new QRCodeStyling({
    width: size,
    height: size,
    type: 'canvas',
    data,
    margin: Math.round(size * 0.04),
    qrOptions: { errorCorrectionLevel: 'H' },
    dotsOptions: { type: 'dots', color: INK },
    cornersSquareOptions: { type: 'extra-rounded', color: INK },
    cornersDotOptions: { type: 'dot', color: BRAND_DARK },
    backgroundOptions: { color: '#ffffff' },
  })
  const raw = await qr.getRawData('png')
  if (!raw) throw new Error('QR generation failed')
  const url = URL.createObjectURL(raw as Blob)
  try {
    return await loadImage(url)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Standard PNG/zlib CRC32, needed to hand-build a valid `pHYs` chunk below. */
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let i = 0; i < 8; i++) crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

/** `canvas.toDataURL('image/png')` carries no physical-size information at
 *  all — a print driver that's asked for "100% / actual size" has to assume
 *  *some* DPI, and its default (often 96, the screen standard) can turn a
 *  precisely-sized badge into the wrong physical diameter. This inserts a
 *  PNG `pHYs` chunk (right after the mandatory `IHDR`, which is always
 *  exactly 25 bytes after the 8-byte PNG signature) recording `dpi`, which
 *  print software and badge-maker tools that honor embedded resolution will
 *  then use to print this image at its true size. */
function withPngDpi(dataUrl: string, dpi: number): string {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

  const pixelsPerMeter = Math.round(dpi / 0.0254)
  const chunkBody = new Uint8Array(13) // "pHYs" (4) + X/Y pixels-per-unit (4+4) + unit specifier (1)
  const bodyView = new DataView(chunkBody.buffer)
  chunkBody.set(new TextEncoder().encode('pHYs'), 0)
  bodyView.setUint32(4, pixelsPerMeter)
  bodyView.setUint32(8, pixelsPerMeter)
  chunkBody[12] = 1 // unit specifier: 1 = meters

  const chunk = new Uint8Array(4 + chunkBody.length + 4)
  new DataView(chunk.buffer).setUint32(0, chunkBody.length - 4) // length field excludes the 4-byte type
  chunk.set(chunkBody, 4)
  new DataView(chunk.buffer).setUint32(4 + chunkBody.length, crc32(chunkBody))

  const IHDR_END = 8 + 25 // PNG signature + the always-25-byte IHDR chunk
  const out = new Uint8Array(bytes.length + chunk.length)
  out.set(bytes.subarray(0, IHDR_END), 0)
  out.set(chunk, IHDR_END)
  out.set(bytes.subarray(IHDR_END), IHDR_END + chunk.length)

  let outBinary = ''
  for (const b of out) outBinary += String.fromCharCode(b)
  return `data:image/png;base64,${btoa(outBinary)}`
}

function newCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  return [c, ctx]
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** Shrinks the font until `text` fits in `maxWidth`. */
function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, startPx: number, weight = 700) {
  let px = startPx
  do {
    ctx.font = `${weight} ${px}px "Segoe UI", Roboto, Helvetica, Arial, sans-serif`
    if (ctx.measureText(text).width <= maxWidth) return
    px -= 4
  } while (px > 24)
}

function font(px: number, weight = 600) {
  return `${weight} ${px}px "Segoe UI", Roboto, Helvetica, Arial, sans-serif`
}

/** Wraps `text` onto lines no wider than `maxWidth`, capped at `maxLines`. */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ')
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (ctx.measureText(next).width <= maxWidth) { line = next; continue }
    if (line) lines.push(line)
    line = w
    if (lines.length === maxLines) break
  }
  if (line && lines.length < maxLines) lines.push(line)
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = lines[maxLines - 1]!.replace(/.{0,3}$/, '…')
  }
  return lines
}

async function drawHeader(ctx: CanvasRenderingContext2D, subtitle: string) {
  const grad = ctx.createLinearGradient(0, 0, W, 360)
  grad.addColorStop(0, BRAND)
  grad.addColorStop(1, BRAND_DARK)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, 360)
  try {
    const logo = await loadImage('/pwa-192x192.png')
    ctx.save()
    roundRect(ctx, 80, 80, 200, 200, 44)
    ctx.fillStyle = '#fff'
    ctx.fill()
    ctx.clip()
    ctx.drawImage(logo, 90, 90, 180, 180)
    ctx.restore()
  } catch { /* logo is decoration only */ }
  ctx.fillStyle = '#fff'
  ctx.textBaseline = 'alphabetic'
  ctx.textAlign = 'left'
  ctx.font = font(104, 800)
  ctx.fillText("ROL's", 320, 190)
  ctx.font = font(52, 600)
  ctx.globalAlpha = 0.92
  ctx.fillText(subtitle, 322, 262)
  ctx.globalAlpha = 1
}

function drawFooter(ctx: CanvasRenderingContext2D, text: string) {
  ctx.fillStyle = INK
  ctx.fillRect(0, H - 140, W, 140)
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.font = font(44, 600)
  ctx.fillText(text, W / 2, H - 72)
  ctx.font = font(28, 500)
  ctx.globalAlpha = 0.72
  ctx.fillText('Powered by Raben Learn', W / 2, H - 32)
  ctx.globalAlpha = 1
}

export async function renderIdCardFront(d: IdCardFrontData): Promise<string> {
  const [canvas, ctx] = newCanvas()
  await drawHeader(ctx, 'STUDENT ID CARD')

  // Photo — centre-cropped to a 4:5 portrait frame.
  const pw = 640, ph = 800, px = (W - pw) / 2, py = 440
  ctx.save()
  roundRect(ctx, px, py, pw, ph, 48)
  ctx.fillStyle = '#f1f3f7'
  ctx.fill()
  ctx.clip()
  if (d.photoDataUrl) {
    try {
      const img = await loadImage(d.photoDataUrl)
      const scale = Math.max(pw / img.naturalWidth, ph / img.naturalHeight)
      const dw = img.naturalWidth * scale, dh = img.naturalHeight * scale
      ctx.drawImage(img, px + (pw - dw) / 2, py + (ph - dh) / 2, dw, dh)
    } catch { /* falls through to the empty frame */ }
  } else {
    ctx.fillStyle = MUTED
    ctx.textAlign = 'center'
    ctx.font = font(52, 600)
    ctx.fillText('No photo', W / 2, py + ph / 2)
  }
  ctx.restore()
  ctx.lineWidth = 10
  ctx.strokeStyle = BRAND
  roundRect(ctx, px, py, pw, ph, 48)
  ctx.stroke()

  // Name
  ctx.fillStyle = INK
  ctx.textAlign = 'center'
  fitText(ctx, d.name || '—', W - 160, 96, 800)
  ctx.fillText(d.name || '—', W / 2, 1370)

  // Details
  const rows: [string, string][] = [
    ['Student ID', d.studentCode],
    ['Class', d.grade || '—'],
    ['Date of birth', formatDob(d.dateOfBirth)],
    ['Blood group', d.bloodGroup || '—'],
  ]
  let y = 1480
  for (const [label, value] of rows) {
    ctx.textAlign = 'left'
    ctx.fillStyle = MUTED
    ctx.font = font(48, 600)
    ctx.fillText(label, 150, y)
    ctx.textAlign = 'right'
    ctx.fillStyle = INK
    fitText(ctx, value, 620, 54, 700)
    ctx.fillText(value, W - 150, y)
    y += 92
  }

  drawFooter(ctx, 'Valid while enrolled')
  return canvas.toDataURL('image/jpeg', 0.92)
}

export async function renderIdCardBack(d: IdCardBackData): Promise<string> {
  const [canvas, ctx] = newCanvas()
  await drawHeader(ctx, 'ATTENDANCE PASS')

  const qs = 820, qx = (W - qs) / 2, qy = 470
  if (d.scanUrl) {
    const qrImg = await renderStyledQr(d.scanUrl, qs)
    ctx.drawImage(qrImg, qx, qy, qs, qs)
  } else {
    ctx.fillStyle = '#f1f3f7'
    ctx.fillRect(qx, qy, qs, qs)
    ctx.fillStyle = MUTED
    ctx.textAlign = 'center'
    ctx.font = font(52, 600)
    ctx.fillText('QR code not generated', W / 2, qy + qs / 2)
  }
  ctx.textAlign = 'center'
  ctx.fillStyle = INK
  ctx.font = font(50, 700)
  ctx.fillText('Scan at the Live Class desk', W / 2, qy + qs + 90)

  let y = qy + qs + 210
  ctx.textAlign = 'left'
  ctx.fillStyle = MUTED
  ctx.font = font(42, 600)
  ctx.fillText('In case of emergency', 150, y)
  ctx.fillStyle = INK
  const emergency = [d.emergencyName, d.emergencyPhone].filter(Boolean).join(' · ') || '—'
  fitText(ctx, emergency, W - 300, 54, 700)
  ctx.fillText(emergency, 150, y + 66)

  y += 170
  ctx.fillStyle = MUTED
  ctx.font = font(42, 600)
  ctx.fillText('Address', 150, y)
  ctx.fillStyle = INK
  ctx.font = font(44, 500)
  wrapLines(ctx, d.address || '—', W - 300, 2).forEach((line, i) => ctx.fillText(line, 150, y + 62 + i * 56))

  drawFooter(ctx, "If found, please return to ROL's")
  return canvas.toDataURL('image/jpeg', 0.92)
}

/** Draws `text` along an arc centered above `(cx, cy)` at `radius` — the
 *  badge's curved brand header. Each letter is rotated to stay upright
 *  relative to the circle it's following. */
function drawCurvedText(ctx: CanvasRenderingContext2D, text: string, cx: number, cy: number, radius: number, px: number, weight = 800) {
  ctx.save()
  ctx.font = font(px, weight)
  ctx.fillStyle = '#fff'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const letters = text.split('')
  const gap = px * 0.08
  const widths = letters.map((l) => ctx.measureText(l).width)
  const totalAngle = (widths.reduce((a, b) => a + b, 0) + gap * (letters.length - 1)) / radius
  let angle = -totalAngle / 2
  for (let i = 0; i < letters.length; i++) {
    const letterAngle = widths[i]! / radius
    const mid = angle + letterAngle / 2
    ctx.save()
    ctx.translate(cx + radius * Math.sin(mid), cy - radius * Math.cos(mid))
    ctx.rotate(mid)
    ctx.fillText(letters[i]!, 0, 0)
    ctx.restore()
    angle += letterAngle + gap / radius
  }
  ctx.restore()
}

/** Draws a simple 5-point star — the badge's decorative sparkle accents. */
function drawStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, outerR: number, innerR: number, color: string, alpha: number) {
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = color
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR
    const angle = (Math.PI / 5) * i - Math.PI / 2
    const x = cx + r * Math.cos(angle)
    const y = cy + r * Math.sin(angle)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fill()
  ctx.restore()
}

/** Single-sided 58 mm circular badge, full-bleed (no outer ring/guide lines,
 *  no square panel) — a rich warm-to-cool brand gradient with a few star
 *  accents, "ROL'S" curved along the top clear of everything below it, a
 *  circular white disc (not a square) behind the stylized QR for guaranteed
 *  contrast, and Name / Student ID / Class stacked underneath in light
 *  high-contrast type against the gradient. Every element keeps clear
 *  padding from the outer edge so nothing clips against the curve. */
export async function renderBadge(d: BadgeData): Promise<string> {
  const canvas = document.createElement('canvas')
  canvas.width = BADGE_D
  canvas.height = BADGE_D
  const ctx = canvas.getContext('2d')!
  const cx = BADGE_D / 2
  const cy = BADGE_D / 2
  const r = BADGE_D / 2

  // The whole canvas *is* the 58 mm circle — full bleed, clipped so nothing
  // ever renders in the (transparent) corners outside it.
  ctx.save()
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.closePath()
  ctx.clip()

  const grad = ctx.createLinearGradient(0, 0, BADGE_D, BADGE_D)
  grad.addColorStop(0, BRAND)
  grad.addColorStop(0.55, '#7c3aed')
  grad.addColorStop(1, '#2d1b69')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, BADGE_D, BADGE_D)

  drawStar(ctx, cx - 365, cy - 426, 26, 12, '#ffffff', 0.3)
  drawStar(ctx, cx + 357, cy - 410, 18, 8, '#ffffff', 0.25)
  drawStar(ctx, cx - 426, cy + 319, 17, 8, '#ffffff', 0.22)
  drawStar(ctx, cx + 410, cy + 334, 21, 10, '#ffffff', 0.25)

  // Brand header — curved well clear of the QR disc below it.
  drawCurvedText(ctx, "ROL'S · STUDENT ID", cx, cy, r - 85, 34, 800)

  // QR disc — a plain circle (not a square), sized so its full extent
  // (including the shadow) stays well inside the outer edge: disc center is
  // offset slightly above true center to leave balanced room for the name/
  // ID/class block below it.
  const qrSize = 660 // ~48% of the 1370 px diameter
  const discR = qrSize / 2 + 40
  const discCx = cx
  const discCy = cy - 40
  ctx.save()
  ctx.shadowColor = 'rgba(20,10,60,0.3)'
  ctx.shadowBlur = 30
  ctx.shadowOffsetY = 10
  ctx.beginPath()
  ctx.arc(discCx, discCy, discR, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255,255,255,0.97)'
  ctx.fill()
  ctx.restore()

  const qx = discCx - qrSize / 2
  const qy = discCy - qrSize / 2
  if (d.scanUrl) {
    const qrImg = await renderStyledQr(d.scanUrl, qrSize)
    ctx.drawImage(qrImg, qx, qy, qrSize, qrSize)
  } else {
    ctx.fillStyle = MUTED
    ctx.textAlign = 'center'
    ctx.font = font(26, 600)
    ctx.fillText('QR not generated', discCx, discCy)
  }

  // Name / Student ID / Class, stacked below the disc, directly on the
  // gradient — light/white type for contrast against the indigo lower half.
  let y = discCy + discR + 78
  ctx.textAlign = 'center'
  ctx.fillStyle = '#ffffff'
  fitText(ctx, d.name || '—', BADGE_D * 0.66, 42, 800)
  ctx.fillText(d.name || '—', cx, y)
  y += 48
  ctx.font = font(30, 700)
  ctx.fillStyle = '#ffd56b'
  ctx.fillText(d.studentCode, cx, y)
  y += 40
  ctx.font = font(26, 600)
  ctx.globalAlpha = 0.85
  ctx.fillStyle = '#ffffff'
  ctx.fillText(d.grade || '—', cx, y)
  ctx.globalAlpha = 1

  ctx.restore() // the outer circle clip
  return withPngDpi(canvas.toDataURL('image/png'), BADGE_DPI)
}

function formatDob(s: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return s || '—'
  const [y, m, d] = s.split('-')
  return `${d}/${m}/${y}`
}

/** Short, human-readable card number derived from the account id. */
export function studentCodeFor(studentId: string): string {
  return `RL-${studentId.slice(0, 6).toUpperCase()}`
}

export function downloadDataUrl(dataUrl: string, fileName: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
}
