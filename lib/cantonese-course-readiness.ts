type ReviewStatus = 'DRAFT' | 'CONTENT_REVIEW_REQUIRED' | 'APPROVED' | 'REJECTED'

type TeachingRow = {
  externalId: string
  lessonId: string
  status: ReviewStatus
  requiresAudio: boolean
  requiresSpeaking: boolean
  audioId: string | null
}

type QuestionRow = {
  externalId: string
  lessonId: string
  status: ReviewStatus
}

export type CantoneseCourseReadiness = {
  lessonId: string
  status: 'READY' | 'CONTENT_NOT_READY'
  contentCount: number
  approvedContentCount: number
  requiredAudioCount: number
  readyAudioCount: number
  questionCount: number
  approvedQuestionCount: number
  assessmentAvailability: 'READY' | 'REVIEW_PENDING'
}

export function resolveCantoneseCourseReadiness(input: {
  lessonIds?: readonly string[]
  teaching: TeachingRow[]
  questions: QuestionRow[]
  readyAudioIds: ReadonlySet<string>
  visibleQuestionIds: ReadonlySet<string>
}): CantoneseCourseReadiness[] {
  const lessonIds = input.lessonIds ?? [...new Set([...input.teaching, ...input.questions].map((row) => row.lessonId))].sort()
  return lessonIds.map((lessonId) => {
    // Rejected drafts are not intended for this lesson's eventual release.
    const teaching = input.teaching.filter((row) => row.lessonId === lessonId && row.status !== 'REJECTED')
    const questions = input.questions.filter((row) => row.lessonId === lessonId && row.status !== 'REJECTED')
    const approvedContentCount = teaching.filter((row) => row.status === 'APPROVED').length
    const requiredAudio = teaching.filter((row) => row.requiresAudio || row.requiresSpeaking)
    const readyAudioCount = requiredAudio.filter((row) => row.audioId && input.readyAudioIds.has(row.audioId)).length
    const approvedQuestionCount = questions.filter((row) => row.status === 'APPROVED' && input.visibleQuestionIds.has(row.externalId)).length

    return {
      lessonId,
      status: teaching.length > 0 && approvedContentCount === teaching.length && readyAudioCount === requiredAudio.length
        ? 'READY' : 'CONTENT_NOT_READY',
      contentCount: teaching.length,
      approvedContentCount,
      requiredAudioCount: requiredAudio.length,
      readyAudioCount,
      questionCount: questions.length,
      approvedQuestionCount,
      assessmentAvailability: questions.length > 0 && approvedQuestionCount === questions.length
        ? 'READY' : 'REVIEW_PENDING',
    }
  })
}
