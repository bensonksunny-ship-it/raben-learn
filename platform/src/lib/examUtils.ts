import type { ExamQuestion, QuestionSnapshot } from '../types'

export function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j]!, a[i]!]
  }
  return a
}

/**
 * Picks `count` questions weighted by inverse usageCount so less-used questions
 * are more likely to be selected. Falls back to full shuffled list if bank is small.
 */
export function pickQuestions(questions: ExamQuestion[], count: number): ExamQuestion[] {
  if (questions.length <= count) return shuffleArray(questions)
  const maxUsage = Math.max(...questions.map((q) => q.usageCount), 1)
  const pool = [...questions]
  const selected: ExamQuestion[] = []
  for (let i = 0; i < count; i++) {
    const weights = pool.map((q) => maxUsage - q.usageCount + 1)
    const total = weights.reduce((s, w) => s + w, 0)
    let rand = Math.random() * total
    let idx = 0
    while (idx < pool.length - 1 && rand > weights[idx]!) {
      rand -= weights[idx]!
      idx++
    }
    selected.push(pool.splice(idx, 1)[0]!)
  }
  return selected
}

/** Wraps each question with shuffled option order for display. */
export function makeSnapshots(questions: ExamQuestion[]): QuestionSnapshot[] {
  return questions.map((q) => ({ ...q, shuffledOptions: shuffleArray(q.options) }))
}

export function calculateScore(
  questions: QuestionSnapshot[],
  answers: Record<string, string>,
): { score: number; topicBreakdown: Record<string, { correct: number; total: number }> } {
  let score = 0
  const topicBreakdown: Record<string, { correct: number; total: number }> = {}
  for (const q of questions) {
    const topic = q.topic.trim() || 'General'
    if (!topicBreakdown[topic]) topicBreakdown[topic] = { correct: 0, total: 0 }
    topicBreakdown[topic]!.total++
    if (answers[q.id] === q.correctAnswer) {
      score += q.marks
      topicBreakdown[topic]!.correct++
    }
  }
  return { score, topicBreakdown }
}

export function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
