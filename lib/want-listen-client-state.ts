export type WantListenQuestionPhase =
  | 'QUESTION_LOADING'
  | 'QUESTION_READY'
  | 'ANSWER_SUBMITTING'
  | 'ANSWER_SUBMITTED'
  | 'NEXT_LOADING'

type QuestionStateLike = { result: unknown | null } | null

export function getWantListenQuestionPhase(input: {
  status: string
  question: QuestionStateLike
  answering: boolean
  nexting: boolean
}): WantListenQuestionPhase {
  if (input.status !== 'IN_PROGRESS') return input.question?.result ? 'ANSWER_SUBMITTED' : 'QUESTION_LOADING'
  if (!input.question) return 'QUESTION_LOADING'
  if (input.nexting) return 'NEXT_LOADING'
  if (input.answering) return 'ANSWER_SUBMITTING'
  if (input.question.result) return 'ANSWER_SUBMITTED'
  return 'QUESTION_READY'
}

/** The server-returned result is the sole completion source for the current question. */
export function canGoToNextQuestion(status: string, question: QuestionStateLike) {
  return status === 'IN_PROGRESS' && Boolean(question?.result)
}
