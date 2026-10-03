export const CANTONESE_LESSON_IDS = [
  'lesson-01', 'lesson-02', 'lesson-03', 'lesson-04', 'lesson-05', 'lesson-06',
] as const

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
  lessonId: (typeof CANTONESE_LESSON_IDS)[number]
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
  teaching: TeachingRow[]
  questions: QuestionRow[]
  readyAudioIds: ReadonlySet<string>
  visibleQuestionIds: ReadonlySet<string>
}): CantoneseCourseReadiness[] {
  return CANTONESE_LESSON_IDS.map((lessonId) => {
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
