/** Offline editorial candidates. None of these records is a reviewed answer. */
export const V6_CANDIDATE_STATUS = 'CONTENT_REVIEW_REQUIRED' as const

// Pack IDs are registry-driven. Adding a lesson pack must not require widening a
// three-lesson union throughout the server.
export type V6LessonId = string
export type V6StageId = string
export type V6ContentType = 'CONCEPT' | 'WORD' | 'PHRASE' | 'SENTENCE' | 'DIALOGUE' | 'CONTRAST' | 'SUMMARY' | 'SPEAKING_PRACTICE'
export type V6QuestionType = 'SINGLE_SELECT' | 'MULTI_SELECT' | 'TRUE_FALSE' | 'LISTENING' | 'SPEAKING'
export type V6JyutpingReviewStatus = 'JYUTPING_REVIEW_REQUIRED' | 'NOT_REQUIRED'

export type V6LessonDefinition = {
  lessonId: V6LessonId
  lessonNumber: number
  title: string
  subtitle: string
  description: string
  sortOrder: number
  prerequisiteLessonId: string
  status: typeof V6_CANDIDATE_STATUS
  reviewStatus: typeof V6_CANDIDATE_STATUS
}

export type V6ContentDraft = {
  key: string
  section: string
  contentType: V6ContentType
  title: string
  text: string
  jyutping?: string
  meaning: string
  explanation: string
  usageNote?: string
  requiresAudio?: boolean
  requiresSpeaking?: boolean
  dialogueId?: string
  speaker?: 'A' | 'B'
  sourceReference?: string
}

export type V6QuestionDraft = {
  key: string
  questionType: V6QuestionType
  prompt: string
  options: string[]
  correct: number[]
  explanation: string
  prerequisites: string[]
  audioFrom?: string
  speakingFrom?: string
  sourceReference?: string
}

export type V6SeedTeaching = {
  externalId: string
  lessonId: V6LessonId
  stageId: V6StageId
  stepId: string
  title: string
  body: string
  displayText: string | null
  jyutping: string | null
  tone: null
  examples: { text: string; jyutping?: string }[]
  audioId: string | null
  contentType: V6ContentType
  sortOrder: number
  requiresAudio: boolean
  requiresSpeaking: boolean
  reviewStatus: typeof V6_CANDIDATE_STATUS
  translation: string
  explanation: string
  section: string
  usageNote: string | null
  sourceReference: string
  jyutpingReviewStatus: V6JyutpingReviewStatus
  dialogueId: string | null
  speaker: 'A' | 'B' | null
  version: 1
}

export type V6SeedQuestion = {
  externalId: string
  lessonId: V6LessonId
  stageId: V6StageId
  questionType: V6QuestionType
  prompt: string
  options: { id: string; text: string }[]
  correctAnswer: string[]
  explanation: string
  prerequisiteContentIds: string[]
  audioId: string | null
  speakingReferenceId: string | null
  lyricPrescriptionId: null
  sourceReference: string
  sortOrder: number
  reviewStatus: typeof V6_CANDIDATE_STATUS
  version: 1
}

export type V6SeedAudio = {
  externalId: string
  text: string
  jyutping: string
  stageId: V6StageId
  contentId: string
  jyutpingReviewStatus: 'JYUTPING_REVIEW_REQUIRED'
  reviewStatus: typeof V6_CANDIDATE_STATUS
  assetStatus: 'NOT_GENERATED'
  version: 1
}

export type V6CoursePackSeedPayload = {
  definitions: V6LessonDefinition[]
  teaching: V6SeedTeaching[]
  questions: V6SeedQuestion[]
  audio: V6SeedAudio[]
}

export type V6Dialogue = { id: string; title: string; turnContentIds: string[] }
export type V6CoursePack = Omit<V6CoursePackSeedPayload, 'definitions'> & {
  definition: V6LessonDefinition
  stageId: V6StageId
  dialogues: V6Dialogue[]
}
