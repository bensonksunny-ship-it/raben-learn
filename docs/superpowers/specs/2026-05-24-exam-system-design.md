# Exam System Design

## Goal

Build a complete MCQ-based exam system inside the existing Raben Learn platform. Exams live inside courses; both admin and mentor roles manage them; students take them in a distraction-free fullscreen experience.

## Architecture

Three independent sub-projects, built in sequence:

1. **Foundation** — Firestore model + Admin/Mentor question bank & exam management
2. **Exam Runner** — Student fullscreen exam experience
3. **Results & Analytics** — Score page, topic breakdown, mentor results view

Tech stack: React + existing plain CSS design system + Framer Motion (new dependency for question transitions). No Tailwind — keeps the existing styling consistent.

---

## Sub-Project 1: Foundation

### Firestore Data Model

```
courses/{courseId}/
  exam                          (single document, id = "config")
    duration: number            minutes, e.g. 30
    totalMarks: number          default 20
    questionsPerExam: number    default 20
    isActive: boolean           false until admin/mentor activates
    createdBy: string           uid

  questionBank/{questionId}
    question: string
    options: string[4]
    correctAnswer: string       must match one of options exactly
    explanation: string
    difficulty: "easy" | "medium" | "hard"
    topic: string               matches session/topic name for grouping
    marks: number               default 1
    usageCount: number          incremented each time question is selected

examAttempts/{attemptId}
  studentId: string
  courseId: string
  startedAt: Timestamp
  submittedAt: Timestamp | null
  timeSpentSeconds: number
  questions: QuestionSnapshot[] shuffled copy stored at attempt creation
  answers: Record<questionId, string>
  score: number
  totalMarks: number
  topicBreakdown: Record<topic, { correct: number; total: number }>
```

Storing `questions` as a snapshot on the attempt preserves the exact question set the student saw, regardless of later question bank edits.

`examAttempts` is a top-level collection (not nested under courses) so it can be queried by `studentId` across courses efficiently.

### New Files

```
src/
  pages/
    exam/
      ExamInstructions.tsx   pre-exam info + start button
      ExamRunner.tsx         fullscreen exam UI
      ExamResults.tsx        score + review + topic breakdown
    admin/
      ExamManager.tsx        question bank CRUD + exam settings + results table
  lib/
    examUtils.ts             shuffle, scoring, topicBreakdown helpers
  types.ts                   add ExamConfig, ExamQuestion, ExamAttempt types
```

### Admin/Mentor Exam Management

**Location:** Inside the existing `SyllabusPage` — when a course is selected, a new "📝 Exam" tab appears alongside the sessions list. No new top-level nav item required.

**Question Bank tab:**
- List all questions for the course (card or table view)
- Filter by topic and difficulty
- Add question form: question, 4 options, correct answer, explanation, difficulty, topic
- Inline edit and delete
- Shows usage count per question (how many times it has been drawn in an exam)

**Settings tab:**
- Duration (minutes)
- Questions per exam (default 20)
- Total marks (default 20)
- Active toggle — students cannot see or start the exam until this is on

**Results tab:**
- Table: student name, score/totalMarks, date, time spent
- Click row → full answer sheet overlay showing each question, student answer, correct answer, ✅/❌, explanation

**Access control:** Rendered only when `profile.roles` includes `admin` or `mentor`.

---

## Sub-Project 2: Exam Runner

### Routes

```
/exam/:courseId/instructions   ExamInstructions
/exam/:courseId/run            ExamRunner
/exam/:courseId/results/:attemptId   ExamResults
```

All three routes are inside the existing `AppShell` (authenticated, with bottom nav).

### ExamInstructions

Shows:
- Course name
- Duration, total marks, number of questions
- Rules: one attempt only; answers saved automatically; timer auto-submits
- "Start Exam" button

On "Start Exam":
1. Draw `questionsPerExam` questions randomly from question bank (weighted toward less-used questions via `usageCount`)
2. Shuffle question order
3. Shuffle each question's options (store shuffled snapshot)
4. Create `examAttempts` doc with `submittedAt: null`
5. Navigate to `/exam/:courseId/run`

If student already has a completed attempt → redirect to results page directly.
If student has an incomplete attempt (browser crash etc.) → resume from where they left off.

### ExamRunner

**Layout — Desktop:**
```
┌─────────────────────────────────────────────┬──────────────────┐
│  Course Name      Q 5 / 20    ⏱ 24:13       │  Question Palette │
├─────────────────────────────────────────────│  ① ② ③ ④ ⑤       │
│                                             │  ⑥ ⑦ ⑧ ⑨ ⑩       │
│  Question 5 of 20                           │  ⑪ ⑫ ⑬ ⑭ ⑮       │
│  ┌─────────────────────────────────────┐    │  ⑯ ⑰ ⑱ ⑲ ⑳       │
│  │  Question text here                 │    │                  │
│  └─────────────────────────────────────┘    │  Gray  = unseen  │
│                                             │  Blue  = answered│
│  ○  Option A                                │  Orange = current│
│  ○  Option B                                │                  │
│  ○  Option C                                │  [Submit Exam]   │
│  ○  Option D                                │                  │
│                                             │                  │
│       [← Previous]        [Next →]          │                  │
└─────────────────────────────────────────────┴──────────────────┘
```

**Layout — Mobile:**
- Palette hidden; accessible via "📊 Questions" button that opens a bottom drawer
- Full-width question card and options
- Sticky bottom bar: Prev / Next / Questions

**Behaviour:**
- Framer Motion `AnimatePresence` slide transition between questions (slide left on Next, slide right on Prev)
- Selecting an option saves immediately: `updateDoc(attemptRef, { [`answers.${questionId}`]: selectedOption })`
- Timer counts down from `duration` in minutes; turns red when ≤ 5 minutes remain
- Auto-submit fires when timer reaches zero (same logic as manual submit)
- Keyboard: ArrowLeft = Prev, ArrowRight = Next, 1-4 = select option A-D

**Submit flow:**
1. Confirm dialog: "Are you sure? You cannot change answers after submitting."
2. Calculate score and topicBreakdown client-side
3. `updateDoc` attempt: `submittedAt`, `score`, `topicBreakdown`, `timeSpentSeconds`
4. Increment `usageCount` on each question used
5. Navigate to results

---

## Sub-Project 3: Results & Analytics

### ExamResults

**Score card:**
- Large score display: "16 / 20"
- Percentage and pass/fail label (pass = ≥ 50% by default)
- Time taken
- Encouraging message: ≥80% "Excellent!", 60-79% "Good job!", 40-59% "Keep practising!", <40% "Don't give up!"

**Topic breakdown:**
- Per-topic bar: "Algebra — 3/5 correct"
- Highlights strongest and weakest topics

**Answer review:**
- Each question listed: question text, student's answer, correct answer, explanation
- ✅ if correct, ❌ if wrong
- Color-coded option highlighting (green = correct, red = wrong student answer)

### Admin/Mentor Results view (in ExamManager)

- Table of all attempts for the course
- Columns: Student, Score, %, Time Spent, Date
- Sortable by score descending
- Click to expand full answer sheet

---

## Student Entry Point

On the existing `StudentCourseView` (`/student/courses/:courseId`):
- If exam is active and no attempt exists → show "📝 Take Exam" button
- If attempt is complete → show score badge "You scored 16/20" + "Review" link
- If attempt is in progress (no `submittedAt`) → show "Resume Exam" button

---

## Types to Add (types.ts)

```typescript
export interface ExamConfig {
  duration: number
  totalMarks: number
  questionsPerExam: number
  isActive: boolean
  createdBy: string
}

export interface ExamQuestion {
  id: string
  question: string
  options: string[]
  correctAnswer: string
  explanation: string
  difficulty: 'easy' | 'medium' | 'hard'
  topic: string
  marks: number
  usageCount: number
}

export interface QuestionSnapshot extends ExamQuestion {
  shuffledOptions: string[]  // options in the order shown to the student
}

export interface ExamAttempt {
  id: string
  studentId: string
  courseId: string
  startedAt: string
  submittedAt: string | null
  timeSpentSeconds: number
  questions: QuestionSnapshot[]
  answers: Record<string, string>  // questionId → chosen option
  score: number
  totalMarks: number
  topicBreakdown: Record<string, { correct: number; total: number }>
}
```

---

## Implementation Phases

**Phase 1 (Foundation):** Types + examUtils + ExamManager (question bank CRUD + settings) + Exam tab in SyllabusPage. Admins and mentors can build question banks and configure exams before students can take them.

**Phase 2 (Runner):** Install Framer Motion. ExamInstructions + ExamRunner + submit logic. Students can take exams.

**Phase 3 (Results):** ExamResults page + Results tab in ExamManager + entry point in StudentCourseView.

---

## What Is Explicitly Out of Scope

- Tailwind CSS (existing plain CSS system used throughout)
- Multiple attempts per student (one attempt enforced)
- Timed per-question limits
- Video proctoring
- Importing question banks from CSV/Excel (can be added later)
