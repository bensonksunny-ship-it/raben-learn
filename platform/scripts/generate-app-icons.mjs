#!/usr/bin/env node
/**
 * Renders the Raben Learn mark (same shape as `<AppIcon />`, src/components/AppIcon.tsx)
 * to every binary icon file the app ships in `public/` and `index.html`/`vite.config.ts`
 * reference by name. Run after changing the icon's artwork:
 *
 *   node scripts/generate-app-icons.mjs
 *
 * Source of truth for the artwork lives in this file (`iconBody`) rather than being
 * read back out of the React component, so this script has no build step of its own —
 * it's plain Node + the two rasterizing deps below. If you change the component's SVG,
 * mirror the change in `iconBody` too.
 */
import { writeFile, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'
import icoEndec from 'ico-endec'

const here = dirname(fileURLToPath(import.meta.url))
const publicDir = join(here, '..', 'public')

const gradientDefs = `
  <linearGradient id="bg" x1="12%" y1="4%" x2="88%" y2="96%">
    <stop offset="0%" stop-color="#4C3FB4"/><stop offset="100%" stop-color="#1B1440"/>
  </linearGradient>
  <linearGradient id="body" x1="28%" y1="6%" x2="72%" y2="100%">
    <stop offset="0%" stop-color="#8B7CF0"/><stop offset="55%" stop-color="#4A3B9E"/><stop offset="100%" stop-color="#241B52"/>
  </linearGradient>
  <linearGradient id="wing" x1="20%" y1="0%" x2="90%" y2="100%">
    <stop offset="0%" stop-color="#352569"/><stop offset="100%" stop-color="#1F1748"/>
  </linearGradient>
  <linearGradient id="beak" x1="10%" y1="0%" x2="90%" y2="100%">
    <stop offset="0%" stop-color="#FFE08A"/><stop offset="100%" stop-color="#F7A724"/>
  </linearGradient>
  <linearGradient id="pages" x1="0%" y1="0%" x2="100%" y2="100%">
    <stop offset="0%" stop-color="#CFFBF1"/><stop offset="100%" stop-color="#5EEAD4"/>
  </linearGradient>
  <linearGradient id="cover" x1="0%" y1="0%" x2="0%" y2="100%">
    <stop offset="0%" stop-color="#2DD4BF"/><stop offset="100%" stop-color="#0D9488"/>
  </linearGradient>
`

/** The raven + book, everything except the background tile — reused as-is for the
 *  standard icon, and scaled down (see `maskableSvg`) to sit inside the safe zone
 *  Android crops a maskable icon's background to. */
const iconBody = `
  <path d="M46 40 L50 36 L50 50 L46 54 Z" fill="#0B7B70"/>
  <rect x="14" y="40" width="32" height="14" rx="3" fill="url(#cover)"/>
  <path d="M14 40 L46 40 L50 36 L18 36 Z" fill="url(#pages)"/>
  <rect x="17" y="44" width="26" height="1.5" rx="0.75" fill="#FFFFFF" opacity="0.3"/>
  <rect x="17" y="47.5" width="20" height="1.5" rx="0.75" fill="#FFFFFF" opacity="0.2"/>
  <path d="M29 36 L35 36 L35 46 L32 43.5 L29 46 Z" fill="url(#beak)"/>
  <ellipse cx="31" cy="38" rx="12" ry="3" fill="#0B0A1F" opacity="0.22"/>
  <path d="M18 30 Q13 27 14 22 Q19 24 21 28 Z" fill="url(#wing)"/>
  <path d="M32 12 C21 12 15 21 15 30 C15 36 22 39.5 32 39.5 C42 39.5 49 36 49 30 C49 21 43 12 32 12 Z" fill="url(#body)"/>
  <path d="M40 22 C47 21 50 28 46 34 C43 37 38 36 37.5 31 C37 27 37 23 40 22 Z" fill="url(#wing)"/>
  <ellipse cx="24" cy="18" rx="6" ry="4" fill="#FFFFFF" opacity="0.2" transform="rotate(-18 24 18)"/>
  <path d="M30 13 C28 9 31 5.5 35 6.5 C33 8.5 34.5 10.5 32.5 11.8 C31.5 12.5 30.6 12.8 30 13 Z" fill="url(#beak)"/>
  <circle cx="26.5" cy="22" r="3.2" fill="#FFFFFF"/>
  <circle cx="37.5" cy="22" r="3.2" fill="#FFFFFF"/>
  <circle cx="27" cy="22.6" r="1.6" fill="#1B1440"/>
  <circle cx="38" cy="22.6" r="1.6" fill="#1B1440"/>
  <circle cx="25.3" cy="20.8" r="0.55" fill="#FFFFFF"/>
  <circle cx="36.3" cy="20.8" r="0.55" fill="#FFFFFF"/>
  <path d="M27 26.5 Q32 24.5 37 26.5 L32.3 33.5 Q32 34.2 31.7 33.5 Z" fill="url(#beak)"/>
  <path d="M28.6 27.3 Q32 26.3 35.4 27.3" stroke="#D9870F" stroke-width="0.7" stroke-linecap="round" fill="none" opacity="0.5"/>
`

/** Standard mark: inset rounded tile + the artwork at its native scale. Used for the
 *  favicon, the apple touch icon, and the regular (non-maskable) PWA icons. */
function standardSvg() {
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
    <defs>${gradientDefs}</defs>
    <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#bg)"/>
    <ellipse cx="32" cy="13" rx="24" ry="12" fill="#FFFFFF" opacity="0.06"/>
    ${iconBody}
  </svg>`
}

/** Maskable variant: the background fills the full square edge-to-edge (Android, not
 *  this SVG, decides the final shape), and the artwork is scaled down ~0.78x around
 *  the canvas center so nothing meaningful falls outside the ~80% "safe zone" that an
 *  aggressive mask (e.g. a circle) can crop down to. */
function maskableSvg() {
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
    <defs>${gradientDefs}</defs>
    <rect x="0" y="0" width="64" height="64" fill="url(#bg)"/>
    <ellipse cx="32" cy="13" rx="24" ry="12" fill="#FFFFFF" opacity="0.06"/>
    <g transform="translate(32 32) scale(0.78) translate(-32 -32)">${iconBody}</g>
  </svg>`
}

async function renderPng(svg, size) {
  return sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toBuffer()
}

async function main() {
  await mkdir(publicDir, { recursive: true })

  await writeFile(join(publicDir, 'favicon.svg'), standardSvg())

  const favicon16 = await renderPng(standardSvg(), 16)
  const favicon32 = await renderPng(standardSvg(), 32)
  const favicon48 = await renderPng(standardSvg(), 48)
  const icoBuffer = icoEndec.encode([favicon16, favicon32, favicon48])
  await writeFile(join(publicDir, 'favicon.ico'), icoBuffer)

  await writeFile(join(publicDir, 'apple-touch-icon-180x180.png'), await renderPng(standardSvg(), 180))
  await writeFile(join(publicDir, 'pwa-64x64.png'), await renderPng(standardSvg(), 64))
  await writeFile(join(publicDir, 'pwa-192x192.png'), await renderPng(standardSvg(), 192))
  await writeFile(join(publicDir, 'pwa-512x512.png'), await renderPng(standardSvg(), 512))
  await writeFile(join(publicDir, 'maskable-icon-512x512.png'), await renderPng(maskableSvg(), 512))

  console.log('Wrote favicon.ico, favicon.svg, apple-touch-icon-180x180.png, pwa-{64,192,512}.png, maskable-icon-512x512.png to public/')
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
