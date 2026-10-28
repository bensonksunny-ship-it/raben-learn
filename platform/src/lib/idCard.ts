import QRCode from 'qrcode'

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

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not load image'))
    img.src = src
  })
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
  ctx.fillText('Raben Learn', 320, 190)
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
  ctx.fillText(text, W / 2, H - 55)
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
    const qrCanvas = document.createElement('canvas')
    await QRCode.toCanvas(qrCanvas, d.scanUrl, { width: qs, margin: 1, errorCorrectionLevel: 'M' })
    ctx.drawImage(qrCanvas, qx, qy, qs, qs)
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

  drawFooter(ctx, 'If found, please return to Raben Learn')
  return canvas.toDataURL('image/jpeg', 0.92)
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
