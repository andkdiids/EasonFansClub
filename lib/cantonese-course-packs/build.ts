import {
  V6_CANDIDATE_STATUS,
  type V6ContentDraft,
  type V6CoursePack,
  type V6LessonDefinition,
  type V6QuestionDraft,
  type V6StageId,
} from './types'

const optionIds = ['a', 'b', 'c', 'd'] as const
const editorialSource = 'Offline Codex candidate; naturalness, Jyutping and answer require human Cantonese review.'

export function buildV6CoursePack(
  definition: V6LessonDefinition,
  stageId: V6StageId,
  content: V6ContentDraft[],
  questionDrafts: V6QuestionDraft[],
  dialogueTitles: Record<string, string>,
): V6CoursePack {
  const contentId = (key: string) => `cantonese.v6.content.${definition.lessonId}.${key}`
  const audioId = (key: string) => `cantonese.v6.audio.${definition.lessonId}.${key}`
  const contentByKey = new Map(content.map((item) => [item.key, item]))
  if (contentByKey.size !== content.length) throw new Error(`Duplicate content key in ${definition.lessonId}`)
  const teaching = content.map((item, index) => {
    const needsAudio = Boolean(item.requiresAudio || item.requiresSpeaking)
    return {
      externalId: contentId(item.key), lessonId: definition.lessonId, stageId,
      stepId: `${definition.lessonId}.${item.key}`, title: item.title, body: item.explanation,
      displayText: item.contentType === 'CONCEPT' || item.contentType === 'SUMMARY' ? null : item.text,
      jyutping: item.jyutping || null, tone: null,
      examples: item.contentType === 'CONCEPT' || item.contentType === 'SUMMARY'
        ? [] : [{ text: item.text, ...(item.jyutping ? { jyutping: item.jyutping } : {}) }],
      audioId: needsAudio ? audioId(item.key) : null,
      contentType: item.contentType, sortOrder: index,
      requiresAudio: needsAudio, requiresSpeaking: Boolean(item.requiresSpeaking),
      reviewStatus: V6_CANDIDATE_STATUS,
      translation: item.meaning, explanation: item.explanation, section: item.section,
      usageNote: item.usageNote || null, sourceReference: item.sourceReference || editorialSource,
      jyutpingReviewStatus: needsAudio ? 'JYUTPING_REVIEW_REQUIRED' as const : 'NOT_REQUIRED' as const,
      dialogueId: item.dialogueId || null, speaker: item.speaker || null, version: 1 as const,
    }
  })
  const audio = content.filter((item) => item.requiresAudio || item.requiresSpeaking).map((item) => ({
    externalId: audioId(item.key), text: item.text, jyutping: item.jyutping || '',
    stageId, contentId: contentId(item.key),
    jyutpingReviewStatus: 'JYUTPING_REVIEW_REQUIRED' as const,
    reviewStatus: V6_CANDIDATE_STATUS, assetStatus: 'NOT_GENERATED' as const, version: 1 as const,
  }))
  const questions = questionDrafts.map((item, index) => {
    for (const key of [...item.prerequisites, ...(item.audioFrom ? [item.audioFrom] : []), ...(item.speakingFrom ? [item.speakingFrom] : [])]) {
      if (!contentByKey.has(key)) throw new Error(`Unknown content key ${key} in ${definition.lessonId}`)
    }
    if (item.options.length > optionIds.length) throw new Error(`Too many options: ${item.key}`)
    return {
      externalId: `cantonese.v6.question.${definition.lessonId}.${item.key}`,
      lessonId: definition.lessonId, stageId,
      questionType: item.questionType, prompt: item.prompt,
      options: item.options.map((text, answerIndex) => ({ id: optionIds[answerIndex], text })),
      correctAnswer: item.correct.map((answerIndex) => optionIds[answerIndex]),
      explanation: item.explanation,
      prerequisiteContentIds: item.prerequisites.map(contentId),
      audioId: item.audioFrom ? audioId(item.audioFrom) : null,
      speakingReferenceId: item.speakingFrom ? contentId(item.speakingFrom) : null,
      lyricPrescriptionId: null,
      sourceReference: item.sourceReference || editorialSource,
      sortOrder: index, reviewStatus: V6_CANDIDATE_STATUS, version: 1 as const,
    }
  })
  const dialogues = Object.entries(dialogueTitles).map(([id, title]) => ({
    id, title,
    turnContentIds: content.filter((item) => item.dialogueId === id).map((item) => contentId(item.key)),
  }))
  return { definition, stageId, teaching, questions, audio, dialogues }
}
