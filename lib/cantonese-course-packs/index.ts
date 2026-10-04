import { LESSON_05_GREETINGS } from './lesson05-greetings'
import { LESSON_06_DIRECTIONS } from './lesson06-directions'
import { LESSON_07_ORDERING } from './lesson07-ordering'
import type { V6CoursePack, V6CoursePackSeedPayload, V6LessonId } from './types'

export { LESSON_05_GREETINGS, LESSON_06_DIRECTIONS, LESSON_07_ORDERING }
export type { V6CoursePack, V6CoursePackSeedPayload, V6LessonId } from './types'

export const V6_COURSE_PACKS: readonly V6CoursePack[] = [
  LESSON_05_GREETINGS,
  LESSON_06_DIRECTIONS,
  LESSON_07_ORDERING,
]

/** One explicit lesson at a time. Never ships content into an approved pool. */
export function buildV6CoursePackSeedPayload(lessonId: V6LessonId): V6CoursePackSeedPayload {
  const pack = V6_COURSE_PACKS.find((item) => item.definition.lessonId === lessonId)
  if (!pack) throw new Error(`Unknown V6 lesson: ${lessonId}`)
  return {
    definitions: [pack.definition],
    teaching: pack.teaching,
    questions: pack.questions,
    audio: pack.audio,
  }
}

export function findV6CoursePack(lessonId: string): V6CoursePack | null {
  return V6_COURSE_PACKS.find((item) => item.definition.lessonId === lessonId) || null
}

export function previewV6CoursePack(lessonId: V6LessonId) {
  const pack = V6_COURSE_PACKS.find((item) => item.definition.lessonId === lessonId)
  if (!pack) throw new Error(`Unknown V6 lesson: ${lessonId}`)
  return {
    lessonId,
    title: pack.definition.title,
    teaching: pack.teaching.length,
    questions: pack.questions.length,
    audio: pack.audio.length,
    speaking: pack.teaching.filter((item) => item.requiresSpeaking).length,
    listening: pack.questions.filter((item) => item.questionType === 'LISTENING').length,
    dialogues: pack.dialogues.length,
    reviewStatus: pack.definition.status,
  }
}
