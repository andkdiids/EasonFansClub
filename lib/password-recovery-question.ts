const TRAILING_PUNCTUATION = /\p{P}+$/u

/**
 * Return a fixed-ellipsis prefix of a stored question. Trailing punctuation is
 * excluded when estimating the prompt's midpoint, while the minimum display
 * rule uses the original code-point length. Array.from preserves surrogate
 * pairs and counts Unicode code points rather than UTF-16 code units.
 */
export function maskSecurityQuestion(question: string) {
  const characters = Array.from(question)
  const contentLength = Array.from(question.replace(TRAILING_PUNCTUATION, '')).length

  // A one-code-point question cannot show one original character and also
  // satisfy the strict-shorter-than-original safety invariant.
  const requestedPrefixLength = characters.length <= 2
    ? 1
    : Math.max(2, contentLength <= 5 ? 2 : Math.ceil(contentLength / 2))
  const prefixLength = Math.min(requestedPrefixLength, Math.max(0, characters.length - 1))

  return `${characters.slice(0, prefixLength).join('')}……`
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
