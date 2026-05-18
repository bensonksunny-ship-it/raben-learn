# Syllabus Page UI Upgrade — Design Spec

**Date:** 2026-05-11  
**Audience:** Admin users (teachers managing curriculum)  
**Approach:** Option B — Card-based topic rows with larger text and more breathing room

---

## Goal

Make the admin Syllabus Builder page easier to read and more visually approachable. Currently text sizes are small (0.68–0.9rem in most of the syllabus section) and topic rows feel cramped. No layout restructuring — this is a scale-and-breathe pass within the existing Apple-inspired design system.

---

## Changes (all in `platform/src/index.css`, Syllabus section)

### Session cards
- `.syllabus-session-card` — padding: `0.7rem 0.75rem` → `1rem 1.1rem`
- `.syllabus-session-title` — font-size: `0.9rem` → `1.1rem`; remove `white-space: nowrap` so long titles wrap instead of clipping
- `.syllabus-session-meta` — font-size: `0.78rem` → `0.88rem`
- `.syllabus-session-actions .btn.small` — padding: `0.22rem 0.45rem` → `0.3rem 0.6rem`; font-size: `0.74rem` → `0.82rem`

### Topic timeline rows
- `.topic-timeline` — gap: `0.25rem` → `0.5rem`
- `.topic-timeline-row` — font-size: `0.82rem` → `1rem`; padding: `0.3rem 0.4rem 0.3rem 0` → `0.45rem 0.5rem 0.45rem 0`; grid column widths adjusted to match larger index circle
- `.topic-timeline-index` — width/height: `1.3rem` → `1.75rem`; line-height updated; font-size: `0.7rem` → `0.78rem`
- `.topic-timeline-badge` — font-size: `0.68rem` → `0.8rem`; padding: `0.12rem 0.5rem` → `0.18rem 0.65rem`
- `.topic-timeline-title` — remove `white-space: nowrap` so titles wrap; keep `overflow: hidden` for non-hover state only
- `.topic-timeline-actions` — change `opacity: 0` → `opacity: 0.55` (always visible at low opacity, full on hover); font-size bump on buttons

### Course list
- `.syllabus-item-title` — font-size: `0.98rem` → `1.08rem`
- `.syllabus-item-btn` — padding: `0.5rem 0.4rem` → `0.6rem 0.5rem`

---

## What does NOT change
- Colors, tokens, layout structure (two-column), Apple design system tokens
- All TypeScript/TSX files — zero changes
- Responsive breakpoints — adjusted where needed to match new sizes

---

## Files changed
- `platform/src/index.css` — only file modified
