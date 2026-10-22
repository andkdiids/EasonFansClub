const TRAILING_QUESTION_PUNCTUATION = /[?？。！!]+$/u

/**
 * Return a fixed-ellipsis prefix of a stored question. Trailing question
 * punctuation does not affect how much of an otherwise identical prompt is
 * shown. Array.from iterates Unicode code points, preserving emoji pairs.
 */
export function maskSecurityQuestion(question: string) {
  const content = question.replace(TRAILING_QUESTION_PUNCTUATION, '')
  const characters = Array.from(content)
  const contentLength = characters.length
  const prefixLength = contentLength <= 4 ? 1 : contentLength === 5 ? 2 : Math.ceil(contentLength / 2)
  return `${characters.slice(0, Math.min(prefixLength, characters.length)).join('')}……`
}

/**
 * INTENTIONAL_LIMITED_ENUMERATION_TRADEOFF: callers may include a masked hint
 * only after the existing IP limit, eligible-user check, and challenge creation.
 * Keep the public payload narrowly allow-listed.
 */
export function buildSecurityQuestionChallengeResponse(input: {
  challenge: string
  message: string
  genericQuestion: string
  question?: string | null
}) {
  const maskedQuestion = typeof input.question === 'string'
    ? maskSecurityQuestion(input.question)
    : undefined

  return {
    message: input.message,
    challenge: input.challenge,
    questions: [{ question: input.genericQuestion, sortOrder: 1 }],
    ...(maskedQuestion ? { maskedQuestion } : {}),
  }
}
