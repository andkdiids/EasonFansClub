export type CantoneseAnswerOption = { id: string; text: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

export function parseCantoneseAnswerOptions(value: unknown): CantoneseAnswerOption[] | null {
  if (!Array.isArray(value) || value.length < 2 || value.length > 8) return null
  const result: CantoneseAnswerOption[] = []
  for (const option of value) {
    if (!isRecord(option) || typeof option.id !== 'string' || !/^[a-zA-Z0-9._:-]{1,64}$/.test(option.id)) return null
    const text = typeof option.text === 'string' ? option.text : typeof option.label === 'string' ? option.label : null
    if (!text?.trim() || result.some((item) => item.id === option.id)) return null
    result.push({ id: option.id, text: text.trim() })
  }
  return result
}

export function parseCantoneseAnswerIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) return null
  if (!value.every((item) => typeof item === 'string' && /^[a-zA-Z0-9._:-]{1,64}$/.test(item))) return null
  const ids = value as string[]
  return new Set(ids).size === ids.length ? ids : null
}

export function gradeCantoneseAnswer(input: {
  questionType: string
  options: unknown
  selectedOptionIds: unknown
  correctAnswer: unknown
}): { options: CantoneseAnswerOption[]; selectedOptionIds: string[]; correctOptionIds: string[]; correct: boolean } | null {
  if (!['SINGLE_SELECT', 'MULTI_SELECT', 'TRUE_FALSE', 'LISTENING'].includes(input.questionType)) return null
  const options = parseCantoneseAnswerOptions(input.options)
  const selectedOptionIds = parseCantoneseAnswerIds(input.selectedOptionIds)
  const correctOptionIds = parseCantoneseAnswerIds(input.correctAnswer)
  if (!options || !selectedOptionIds || !correctOptionIds) return null
  const validIds = new Set(options.map((option) => option.id))
  if (selectedOptionIds.some((id) => !validIds.has(id)) || correctOptionIds.some((id) => !validIds.has(id))) return null
  if (input.questionType !== 'MULTI_SELECT' && selectedOptionIds.length !== 1) return null
  return {
    options,
    selectedOptionIds,
    correctOptionIds,
    correct: selectedOptionIds.length === correctOptionIds.length && selectedOptionIds.every((id) => correctOptionIds.includes(id)),
  }
}

export function nextCantoneseQuestionMastery(input: { wrongCount: number; consecutiveCorrect: number }, correct: boolean) {
  const wrongCount = input.wrongCount + (correct ? 0 : 1)
  const consecutiveCorrect = correct ? input.consecutiveCorrect + 1 : 0
  return {
    wrongCount,
    consecutiveCorrect,
    mastery: correct && consecutiveCorrect >= 3 ? 'MASTERED' as const : wrongCount > 0 ? 'LEARNING' as const : 'NEW' as const,
  }
}
