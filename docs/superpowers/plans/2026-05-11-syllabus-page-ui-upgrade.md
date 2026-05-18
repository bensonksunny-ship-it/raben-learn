# Syllabus Page UI Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scale up text sizes and padding in the admin Syllabus Builder page so it reads clearly and feels more approachable.

**Architecture:** All changes are confined to the `/* Syllabus Builder */` and `/* Sessions list */` / `/* Topic timeline */` blocks in `platform/src/index.css`. Zero TSX changes. Each task targets a distinct visual region so changes are easy to verify independently.

**Tech Stack:** CSS (custom properties from existing design system), Vite dev server for live preview

---

## Files

- Modify: `platform/src/index.css` — syllabus, session card, topic timeline, and course list CSS blocks

---

### Task 1: Bump session card size and session title

**Files:**
- Modify: `platform/src/index.css`

- [ ] **Step 1: Start the dev server**

```bash
cd "/Users/bensonksunny/Desktop/Raben learn/platform" && npm run dev
```

Open the app in the browser, log in as admin, navigate to **Syllabus Builder**, and select a course so sessions are visible. Keep this tab open throughout all tasks.

- [ ] **Step 2: Update session card padding and title size**

In `platform/src/index.css`, find and replace the `.syllabus-session-card` and `.syllabus-session-title` rules:

```css
/* Before */
.syllabus-session-card { padding: 0.7rem 0.75rem; }
.syllabus-session-title { display: inline-block; font-size: 0.9rem; font-weight: 700; letter-spacing: -0.01em; max-width: 52ch; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.syllabus-session-meta { margin-left: 0.5rem; font-size: 0.78rem; }
.syllabus-session-actions .btn.small { padding: 0.22rem 0.45rem; font-size: 0.74rem; border-radius: 6px; }

/* After */
.syllabus-session-card { padding: 1rem 1.1rem; }
.syllabus-session-title { display: inline-block; font-size: 1.1rem; font-weight: 700; letter-spacing: -0.01em; max-width: 52ch; }
.syllabus-session-meta { margin-left: 0.5rem; font-size: 0.88rem; }
.syllabus-session-actions .btn.small { padding: 0.3rem 0.6rem; font-size: 0.82rem; border-radius: 6px; }
```

- [ ] **Step 3: Verify in browser**

Session cards should have more vertical space. Session titles should be noticeably larger and no longer clip long names with ellipsis. The topic count meta text should be slightly larger.

- [ ] **Step 4: Commit**

```bash
cd "/Users/bensonksunny/Desktop/Raben learn"
git add platform/src/index.css
git commit -m "style: larger session card titles and more padding in Syllabus Builder"
```

---

### Task 2: Upgrade topic timeline rows

**Files:**
- Modify: `platform/src/index.css`

- [ ] **Step 1: Update topic timeline row sizes**

In `platform/src/index.css`, find the topic timeline block and replace these rules:

```css
/* Before */
.topic-timeline {
  list-style: none;
  margin: 0.35rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  position: relative;
}
.topic-timeline-row {
  display: grid;
  grid-template-columns: 1.3rem auto 1fr auto;
  align-items: center;
  gap: 0.55rem;
  padding: 0.3rem 0.4rem 0.3rem 0;
  font-size: 0.82rem;
  border-radius: 6px;
  position: relative;
}
.topic-timeline-index {
  text-align: center;
  font-variant-numeric: tabular-nums;
  z-index: 1;
  background: var(--surface-soft);
  width: 1.3rem;
  height: 1.3rem;
  line-height: 1.3rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  font-size: 0.7rem;
}
.topic-timeline-badge {
  font-size: 0.68rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.12rem 0.5rem;
  border-radius: 999px;
  white-space: nowrap;
}
.topic-timeline-title {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text);
}
.topic-timeline-actions {
  display: flex;
  gap: 0.25rem;
  opacity: 0;
  transition: opacity 0.15s;
}
.topic-timeline-actions .btn.small { padding: 0.18rem 0.45rem; font-size: 0.72rem; border-radius: 6px; }

/* After */
.topic-timeline {
  list-style: none;
  margin: 0.35rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  position: relative;
}
.topic-timeline-row {
  display: grid;
  grid-template-columns: 1.75rem auto 1fr auto;
  align-items: center;
  gap: 0.65rem;
  padding: 0.45rem 0.5rem 0.45rem 0;
  font-size: 1rem;
  border-radius: 8px;
  position: relative;
}
.topic-timeline-index {
  text-align: center;
  font-variant-numeric: tabular-nums;
  z-index: 1;
  background: var(--surface-soft);
  width: 1.75rem;
  height: 1.75rem;
  line-height: 1.75rem;
  border-radius: 999px;
  border: 1px solid var(--border);
  font-size: 0.78rem;
}
.topic-timeline-badge {
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 0.18rem 0.65rem;
  border-radius: 999px;
  white-space: nowrap;
}
.topic-timeline-title {
  min-width: 0;
  color: var(--text);
}
.topic-timeline-actions {
  display: flex;
  gap: 0.25rem;
  opacity: 0.55;
  transition: opacity 0.15s;
}
.topic-timeline-actions .btn.small { padding: 0.25rem 0.55rem; font-size: 0.8rem; border-radius: 6px; }
```

- [ ] **Step 2: Verify in browser**

Each topic row should now be clearly readable at ~1rem. The numbered circle is larger. The Concept/Exercise pill badge is bigger and easier to read. Action buttons (Edit, Delete, Toggle) are now faintly visible without hovering.

- [ ] **Step 3: Commit**

```bash
cd "/Users/bensonksunny/Desktop/Raben learn"
git add platform/src/index.css
git commit -m "style: larger topic timeline rows, badges, and always-visible action buttons"
```

---

### Task 3: Bump course list item size

**Files:**
- Modify: `platform/src/index.css`

- [ ] **Step 1: Update course list item styles**

In `platform/src/index.css`, find and replace:

```css
/* Before */
.syllabus-item-btn { flex: 1; background: none; border: none; cursor: pointer; text-align: left; padding: 0.5rem 0.4rem; display: flex; flex-direction: column; border-radius: 8px; }
.syllabus-item-title { font-weight: 650; font-size: 0.98rem; letter-spacing: -0.01em; }

/* After */
.syllabus-item-btn { flex: 1; background: none; border: none; cursor: pointer; text-align: left; padding: 0.6rem 0.5rem; display: flex; flex-direction: column; border-radius: 8px; }
.syllabus-item-title { font-weight: 650; font-size: 1.08rem; letter-spacing: -0.01em; }
```

- [ ] **Step 2: Verify in browser**

Course names in the left column should be slightly larger and each item should have a touch more vertical padding.

- [ ] **Step 3: Fix mobile responsive rule for topic timeline**

In the `@media (max-width: 720px)` block, find the `.topic-timeline-row` grid override and update the first column width to match the new index size:

```css
/* Before */
.topic-timeline-row {
  grid-template-columns: 1.3rem auto 1fr;
  ...
}

/* After */
.topic-timeline-row {
  grid-template-columns: 1.75rem auto 1fr;
  ...
}
```

- [ ] **Step 4: Verify mobile layout** (resize browser window to ~680px wide)

Topic rows should still align correctly on smaller screens.

- [ ] **Step 5: Commit**

```bash
cd "/Users/bensonksunny/Desktop/Raben learn"
git add platform/src/index.css
git commit -m "style: larger course list items and fix mobile topic grid column width"
```
