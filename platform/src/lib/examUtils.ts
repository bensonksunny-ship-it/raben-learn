import type { ExamQuestionItem } from '../types'

export function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

export function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** Splits a bulk-pasted block of plain questions on blank lines — each block
 *  (which may itself span several lines) becomes one written question. */
export function parseWrittenPaste(raw: string): string[] {
  return raw
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean)
}

export interface ParsedMcq {
  text: string
  options: string[]
  correctAnswer: string
  error?: string
}

const OPTION_LINE = /^[A-Da-d][.)]\s*(.*)$/

/** Parses bulk-pasted MCQ blocks (separated by blank lines). Within a block,
 *  any lines before the first "A) …" style option line are joined as the
 *  question text; the 4 lines after are the options. A trailing `*` on an
 *  option marks it correct — e.g. "B) Paris *". */
export function parseMcqPaste(raw: string): ParsedMcq[] {
  const blocks = raw.split(/\n\s*\n+/).map((b) => b.trim()).filter(Boolean)
  return blocks.map((block) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    const textLines: string[] = []
    const options: string[] = []
    let correctAnswer = ''
    for (const line of lines) {
      const m = OPTION_LINE.exec(line)
      if (!m) { if (options.length === 0) textLines.push(line); continue }
      let opt = m[1]!.trim()
      if (opt.endsWith('*')) {
        opt = opt.slice(0, -1).trim()
        correctAnswer = opt
      }
      options.push(opt)
    }
    const text = textLines.join(' ').trim()
    let error: string | undefined
    if (!text) error = 'Missing question text'
    else if (options.length !== 4) error = `Expected 4 options (A–D), found ${options.length}`
    else if (!correctAnswer) error = 'No option marked correct (add * after it)'
    return { text, options, correctAnswer, error }
  })
}

export function calculateScore(
  questions: ExamQuestionItem[],
  marksBySection: Record<string, number>,
  questionOrder: string[],
  answers: Record<string, string>,
): number {
  const byId = new Map(questions.map((q) => [q.id, q]))
  let score = 0
  for (const qid of questionOrder) {
    const q = byId.get(qid)
    if (!q) continue
    if (answers[qid] && answers[qid] === q.correctAnswer) {
      score += marksBySection[q.sectionId] ?? 0
    }
  }
  return score
}
