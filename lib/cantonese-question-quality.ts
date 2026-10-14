type QuestionQualityInput = {
  questionType: string
  options: unknown
  correctAnswer: unknown
  audioId?: string | null
  speakingReferenceId?: string | null
}

type Option = { id: string; text: string }

function optionsOf(value: unknown): Option[] | null {
  if (!Array.isArray(value)) return null
  const options: Option[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const record = item as Record<string, unknown>
    if (typeof record.id !== 'string' || !record.id.trim() || typeof record.text !== 'string' || !record.text.trim()) return null
    options.push({ id: record.id, text: record.text })
  }
  return new Set(options.map((option) => option.id)).size === options.length ? options : null
}

function answersOf(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string' && item.trim())) return null
  return [...value] as string[]
}

/** Integrity gate for the stable, supported V6 objective/speaking question types. */
export function validateCantoneseQuestionQuality(input: QuestionQualityInput): string | null {
  const supported = new Set(['SINGLE_SELECT', 'MULTI_SELECT', 'TRUE_FALSE', 'LISTENING', 'SPEAKING'])
  if (!supported.has(input.questionType)) return null
  const options = optionsOf(input.options)
  const answers = answersOf(input.correctAnswer)
  if (!options || !answers) return 'INVALID_OPTIONS_OR_ANSWER'
  if (new Set(answers).size !== answers.length) return 'DUPLICATE_ANSWER'
  if (answers.some((answer) => !options.some((option) => option.id === answer))) return 'ANSWER_NOT_IN_OPTIONS'

  if (input.questionType === 'SPEAKING') {
    return options.length === 0 && answers.length === 0 && Boolean(input.audioId && input.speakingReferenceId)
      ? null : 'SPEAKING_MUST_BE_UNSCORED'
  }
  if (options.length < 2) return 'TOO_FEW_OPTIONS'
  if (input.questionType === 'MULTI_SELECT') {
    if (answers.length < 2) return 'MULTI_SELECT_REQUIRES_TWO_ANSWERS'
    if (answers.length >= options.length) return 'MULTI_SELECT_CANNOT_MARK_ALL_OPTIONS_CORRECT'
  } else if (answers.length !== 1) return 'SINGLE_ANSWER_REQUIRED'
  if (input.questionType === 'TRUE_FALSE' && options.length !== 2) return 'TRUE_FALSE_REQUIRES_TWO_OPTIONS'
  if (input.questionType === 'LISTENING' && !input.audioId) return 'LISTENING_AUDIO_REQUIRED'
  return null
}
