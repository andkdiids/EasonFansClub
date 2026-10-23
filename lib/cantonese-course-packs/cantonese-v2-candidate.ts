import { V6_CANDIDATE_STATUS } from './types'
import { V6_COURSE_PACKS } from './index'
import { V6_JYUTPING_CANDIDATES } from './jyutping-candidates'
import { V6_ANSWER_REVIEW_NOTES, V6_LANGUAGE_REVIEW_QUEUE, V6_SHALLOW_EXPLANATION_NOTES } from './review-metadata'

const contentId = (lesson: string, key: string) => `cantonese.v6.content.${lesson}.${key}`
const questionId = (lesson: string, key: string) => `cantonese.v6.question.${lesson}.${key}`

export const CANTONESE_V2_FOUNDATION = {
  id: 'foundation.nine-tones',
  title: '發音基礎 · 九聲六調',
  order: 0,
  status: V6_CANDIDATE_STATUS,
  sourceStatus: 'ORIGINAL_ECFC_CONTENT',
  beforeBusinessLessons: true,
  currentMobileProductName: '番茄酱牛腩面不吃辣',
  canonicalProductName: '番茄牛腩面不吃辣',
  nameNeedsHumanDecision: true,
  tones: [
    { contentId: 'cantonese.v6.content.foundation.nine-tones.faan1', character: '番', jyutpingCandidate: 'faan1', tone: 1, category: '陰平', audioId: 'foundation.tone.faan1', status: 'HUMAN_REVIEW_REQUIRED' },
    { contentId: 'cantonese.v6.content.foundation.nine-tones.ke2', character: '茄', jyutpingCandidate: 'ke2', tone: 2, category: '陰上', audioId: 'foundation.tone.ke2', status: 'HUMAN_REVIEW_REQUIRED' },
    { contentId: 'cantonese.v6.content.foundation.nine-tones.zoeng3', character: '酱', jyutpingCandidate: 'zoeng3', tone: 3, category: '陰去', audioId: 'foundation.tone.zoeng3', status: 'HUMAN_REVIEW_REQUIRED' },
    { contentId: 'cantonese.v6.content.foundation.nine-tones.ngau4', character: '牛', jyutpingCandidate: 'ngau4', tone: 4, category: '陽平', audioId: 'foundation.tone.ngau4', status: 'HUMAN_REVIEW_REQUIRED' },
    { contentId: 'cantonese.v6.content.foundation.nine-tones.naam5', character: '腩', jyutpingCandidate: 'naam5', tone: 5, category: '陽上', audioId: 'foundation.tone.naam5', status: 'HUMAN_REVIEW_REQUIRED' },
    { contentId: 'cantonese.v6.content.foundation.nine-tones.min6', character: '面', jyutpingCandidate: 'min6', tone: 6, category: '陽去', audioId: 'foundation.tone.min6', status: 'HUMAN_REVIEW_REQUIRED' },
    { contentId: 'cantonese.v6.content.foundation.nine-tones.bat1', character: '不', jyutpingCandidate: 'bat1', tone: 1, category: '陰入', audioId: 'foundation.tone.bat1', enteringTone: true, status: 'HUMAN_REVIEW_REQUIRED' },
    { contentId: 'cantonese.v6.content.foundation.nine-tones.hek3', character: '吃', jyutpingCandidate: 'hek3', tone: 3, category: '中入', audioId: 'foundation.tone.hek3', enteringTone: true, status: 'HUMAN_REVIEW_REQUIRED' },
    { contentId: 'cantonese.v6.content.foundation.nine-tones.laat6', character: '辣', jyutpingCandidate: 'laat6', tone: 6, category: '陽入', audioId: 'foundation.tone.laat6', enteringTone: true, status: 'HUMAN_REVIEW_REQUIRED' },
  ],
  phrase: {
    contentId: 'cantonese.v6.content.foundation.nine-tones.phrase',
    text: '番茄酱牛腩面不吃辣',
    jyutpingCandidate: 'faan1 ke2 zoeng3 ngau4 naam5 min6 bat1 hek3 laat6',
    meaning: '功能名称记忆句；正式产品名用字不含「酱」。',
    audioId: 'foundation.phrase',
    status: V6_CANDIDATE_STATUS,
    sourceStatus: 'ORIGINAL_ECFC_CONTENT',
  },
  questions: [
    { id: 'foundation.nine-tones.quiz.01', questionType: 'SINGLE_SELECT', prompt: '「茄 ke2」是第几声？', options: ['1', '2', '3', '4'], candidateAnswer: '2', explanation: 'ke2 是第二声 · 阴上。', status: V6_CANDIDATE_STATUS },
    { id: 'foundation.nine-tones.quiz.02', questionType: 'SINGLE_SELECT', prompt: '「吃 hek3」属于哪一种入声？', options: ['阴入', '中入', '阳入'], candidateAnswer: '中入', explanation: 'hek3 以 -k 收尾，属于中入；粤拼仍写 3。', status: V6_CANDIDATE_STATUS },
    { id: 'foundation.nine-tones.quiz.03', questionType: 'LISTENING', prompt: '听发音，选出声调。', options: ['3', '4', '5', '6'], candidateAnswer: '4', explanation: '牛 ngau4 是第四声 · 阳平。', audioId: 'foundation.tone.ngau4', readiness: 'BLOCKED_BY_AUDIO', status: V6_CANDIDATE_STATUS },
  ],
  sourceSteps: 16,
} as const

const lessonObjectives: Record<string, string> = {
  'lesson-01': '认识你好、早晨和拜拜，并在简单场景中辨认文字与粤拼。',
  'lesson-02': '辨认我、你、佢和你哋，并将常用人称与粤拼对应。',
  'lesson-03': '介绍自己的名字，询问对方姓名，并用「你呢？」继续对话。',
  'lesson-04': '区分「係」「唔係」「係咪」，并练习肯定和否定判断。',
  'lesson-05': '在见面、道谢、道歉和请求帮助等日常场景中选择合适表达。',
  'lesson-06': '询问地点和路线，听清方向后用短句复述确认。',
  'lesson-07': '练习堂食外卖、点餐、饮品要求、确认辣度和结账表达。',
}

export const CANTONESE_V2_LESSONS = V6_COURSE_PACKS.map((pack) => ({
  lessonId: pack.definition.lessonId,
  title: pack.definition.title,
  objective: lessonObjectives[pack.definition.lessonId],
  order: pack.definition.lessonNumber,
  prerequisite: pack.definition.prerequisiteLessonId,
  recommendedFoundationId: pack.definition.lessonId === 'lesson-01' ? 'foundation.nine-tones' : null,
  contentIds: pack.teaching.map((item) => item.externalId),
  questionIds: pack.questions.map((item) => item.externalId),
  audioRequirements: {
    audioSlots: pack.audio.length,
    listeningQuestionIds: pack.questions.filter((item) => item.questionType === 'LISTENING').map((item) => item.externalId),
    speakingQuestionIds: pack.questions.filter((item) => item.questionType === 'SPEAKING').map((item) => item.externalId),
    listeningReadiness: 'BLOCKED_BY_AUDIO' as const,
  },
  status: V6_CANDIDATE_STATUS,
  reviewStatus: V6_CANDIDATE_STATUS,
}))

const overlapByMobileId: Record<string, { classification: 'DUPLICATE' | 'PARTIAL_OVERLAP' | 'UNIQUE'; existingServerIds: string[]; recommendation: 'MERGE' | 'MOVE' | 'KEEP' }> = {
  greeting_hello: { classification: 'DUPLICATE', existingServerIds: [contentId('lesson-05', 'hello')], recommendation: 'MERGE' },
  greeting_morning: { classification: 'DUPLICATE', existingServerIds: [contentId('lesson-05', 'morning')], recommendation: 'MERGE' },
  greeting_bye: { classification: 'PARTIAL_OVERLAP', existingServerIds: [contentId('lesson-05', 'd3d'), contentId('lesson-05', 'bye')], recommendation: 'KEEP' },
}

const mobileKnowledge = [
  ['greeting_hello', 'lesson-01', 'hello'], ['greeting_morning', 'lesson-01', 'morning'], ['greeting_bye', 'lesson-01', 'bye'],
  ['pronoun_i', 'lesson-02', 'i'], ['pronoun_you', 'lesson-02', 'you'], ['pronoun_he', 'lesson-02', 'he'], ['pronoun_you_plural', 'lesson-02', 'you-plural'],
  ['phrase_my_name', 'lesson-03', 'my-name'], ['phrase_ask_name', 'lesson-03', 'ask-name'], ['word_what', 'lesson-03', 'what'], ['word_name', 'lesson-03', 'name'], ['phrase_you-then', 'lesson-03', 'you-then'],
  ['grammar_is', 'lesson-04', 'is'], ['grammar_is_not', 'lesson-04', 'is-not'], ['grammar_is_question', 'lesson-04', 'is-question'], ['phrase_is_xiaoming', 'lesson-04', 'ask-xiaoming'], ['phrase_not_xiaoming', 'lesson-04', 'not-xiaoming'], ['phrase_i_am_xiaoming', 'lesson-04', 'i-am-xiaoming'],
] as const

export const CANTONESE_V2_CONTENT_MAPPING = mobileKnowledge.map(([oldMobileId, lesson, key]) => ({
  oldMobileId,
  newServerId: contentId(lesson, key),
  classification: overlapByMobileId[oldMobileId]?.classification ?? 'UNIQUE',
  overlappingServerIds: overlapByMobileId[oldMobileId]?.existingServerIds ?? [],
  recommendation: overlapByMobileId[oldMobileId]?.recommendation ?? 'KEEP',
  status: 'CONTENT_REVIEW_REQUIRED' as const,
}))

const mobileAudioIds: Record<string, string> = {
  greeting_hello: 'life.greeting.hello', greeting_morning: 'life.greeting.morning', greeting_bye: 'life.greeting.bye',
  pronoun_i: 'life.pronoun.i', pronoun_you: 'life.pronoun.you', pronoun_he: 'life.pronoun.he', pronoun_you_plural: 'life.pronoun.you-plural',
  phrase_my_name: 'life.introduction.my-name', phrase_ask_name: 'life.introduction.ask-name', word_what: 'life.introduction.what', word_name: 'life.introduction.name', 'phrase_you-then': 'life.introduction.you-then',
  grammar_is: 'life.confirmation.is', grammar_is_not: 'life.confirmation.is-not', grammar_is_question: 'life.confirmation.is-question', phrase_is_xiaoming: 'life.confirmation.ask-xiaoming', phrase_not_xiaoming: 'life.confirmation.not-xiaoming', phrase_i_am_xiaoming: 'life.confirmation.i-am-xiaoming',
}

export const CANTONESE_V2_AUDIO_ID_MAPPING = mobileKnowledge.map(([oldMobileId, lesson, key]) => ({
  oldMobileAudioId: mobileAudioIds[oldMobileId],
  newServerAudioId: `cantonese.v6.audio.${lesson}.${key}`,
  contentId: contentId(lesson, key),
  status: 'CONTENT_REVIEW_REQUIRED' as const,
}))

type ExerciseMapping = { oldMobileExerciseId: string; contentIds: string[]; questionIds: string[]; mappingType: 'INTRO_CONTENT' | 'QUESTION_SET' | 'UNIT_REVIEW_REUSE' }
const intro = (id: string, lesson: string, key: string): ExerciseMapping => ({ oldMobileExerciseId: id, contentIds: [contentId(lesson, key)], questionIds: [], mappingType: 'INTRO_CONTENT' })
const qmap = (id: string, lesson: string, keys: string[]): ExerciseMapping => ({ oldMobileExerciseId: id, contentIds: [], questionIds: keys.map((key) => questionId(lesson, key)), mappingType: 'QUESTION_SET' })
const reviewMap = (id: string, lesson: string, keys: string[]): ExerciseMapping => ({ ...qmap(id, lesson, keys), mappingType: 'UNIT_REVIEW_REUSE' })

export const CANTONESE_V2_QUESTION_MAPPING: readonly ExerciseMapping[] = [
  intro('l1-intro-hello', 'lesson-01', 'hello'), intro('l1-intro-morning', 'lesson-01', 'morning'),
  qmap('l1-choice-morning', 'lesson-01', ['morning-meaning']), qmap('l1-match-greetings', 'lesson-01', ['match-hello-jyutping', 'match-morning-jyutping', 'match-bye-jyutping']),
  qmap('l1-order-hello', 'lesson-01', ['order-hello']), intro('l1-intro-bye', 'lesson-01', 'bye'), qmap('l1-choice-greeting', 'lesson-01', ['greeting-situation']),
  intro('l2-intro-i', 'lesson-02', 'i'), intro('l2-intro-you', 'lesson-02', 'you'), intro('l2-intro-he', 'lesson-02', 'he'),
  qmap('l2-choice-he', 'lesson-02', ['pronoun-he']), qmap('l2-match-pronouns', 'lesson-02', ['match-i-jyutping', 'match-you-jyutping', 'match-he-jyutping']),
  intro('l2-intro-you-plural', 'lesson-02', 'you-plural'), qmap('l2-choice-you-plural', 'lesson-02', ['you-plural-meaning']),
  intro('l3-intro-name', 'lesson-03', 'my-name'), intro('l3-intro-ask-name', 'lesson-03', 'ask-name'),
  qmap('l3-choice-ask-name', 'lesson-03', ['ask-name-meaning']), qmap('l3-match-words', 'lesson-03', ['what-meaning', 'name-meaning']),
  qmap('l3-order-name', 'lesson-03', ['order-my-name']), qmap('l3-choice-response', 'lesson-03', ['answer-introduction']), intro('l3-intro-you-then', 'lesson-03', 'you-then'),
  intro('l4-intro-is', 'lesson-04', 'is'), intro('l4-intro-not', 'lesson-04', 'is-not'), intro('l4-intro-is-question', 'lesson-04', 'is-question'),
  qmap('l4-choice-not', 'lesson-04', ['not-meaning']), qmap('l4-match-forms', 'lesson-04', ['match-is-meaning', 'match-is-not-meaning', 'match-is-question-meaning']),
  qmap('l4-order-sentence', 'lesson-04', ['order-negative']), qmap('l4-choice-question', 'lesson-04', ['affirmative-answer']),
  reviewMap('l5-choice-morning', 'lesson-01', ['morning-meaning']),
  reviewMap('l5-match-greetings', 'lesson-01', ['match-hello-jyutping', 'match-morning-jyutping', 'match-bye-jyutping']),
  reviewMap('l5-order-hello', 'lesson-01', ['order-hello']), reviewMap('l5-choice-pronoun', 'lesson-02', ['pronoun-he']),
  reviewMap('l5-match-pronouns', 'lesson-02', ['match-i-jyutping', 'match-you-jyutping', 'match-he-jyutping']),
  reviewMap('l5-order-name', 'lesson-03', ['order-my-name']), reviewMap('l5-choice-is-question', 'lesson-04', ['match-is-question-meaning']),
  reviewMap('l5-choice-answer', 'lesson-04', ['affirmative-answer']),
]

const allTeaching = V6_COURSE_PACKS.flatMap((pack) => pack.teaching)
const teachingById = new Map(allTeaching.map((item) => [item.externalId, item]))
const questionById = new Map(V6_COURSE_PACKS.flatMap((pack) => pack.questions.map((item) => [item.externalId, item] as const)))

export const CANTONESE_V2_JYUTPING_AMBIGUOUS = V6_JYUTPING_CANDIDATES.flatMap((item) => {
  if (!item.ambiguousReason) return []
  const teaching = teachingById.get(item.contentId)
  return teaching ? [{ itemId: item.contentId, lessonId: teaching.lessonId, text: teaching.displayText, candidate: item.candidate, reason: item.ambiguousReason, status: 'HUMAN_REVIEW_REQUIRED' as const }] : []
})

export const CANTONESE_V2_ANSWER_REVIEW_QUEUE = V6_ANSWER_REVIEW_NOTES.map((note) => {
  const question = questionById.get(note.questionId)
  if (!question) throw new Error(`Missing answer-review question ${note.questionId}`)
  return {
    ...note,
    prompt: question.prompt,
    options: question.options.map((item) => item.text),
    currentAnswer: question.correctAnswer.map((id) => question.options.find((item) => item.id === id)?.text ?? id),
    currentExplanation: question.explanation,
    status: 'HUMAN_REVIEW_REQUIRED' as const,
  }
})

export const CANTONESE_V2_SHALLOW_EXPLANATION_QUEUE = V6_SHALLOW_EXPLANATION_NOTES.map((note) => {
  const question = questionById.get(note.questionId)
  if (!question) throw new Error(`Missing shallow-explanation question ${note.questionId}`)
  return { ...note, currentExplanation: question.explanation, status: 'HUMAN_REVIEW_REQUIRED' as const }
})

function sourceStatus(sourceReference: string): 'ORIGINAL_ECFC_CONTENT' | 'SOURCE_DOCUMENTED' | 'SOURCE_UNKNOWN' {
  if (sourceReference.startsWith('ORIGINAL_ECFC_CONTENT:')) return 'ORIGINAL_ECFC_CONTENT'
  if (/^https?:\/\//.test(sourceReference)) return 'SOURCE_DOCUMENTED'
  return 'SOURCE_UNKNOWN'
}

const sourceReviewRow = (itemId: string, lessonId: string, sourceReference: string) => ({
  itemId,
  lessonId,
  sourceReference,
  sourceStatus: sourceStatus(sourceReference),
  copyrightReviewRequired: sourceStatus(sourceReference) !== 'ORIGINAL_ECFC_CONTENT',
})

export const CANTONESE_V2_SOURCE_REVIEW = [
  ...allTeaching.map((item) => sourceReviewRow(item.externalId, item.lessonId, item.sourceReference)),
  ...V6_COURSE_PACKS.flatMap((pack) => pack.questions.map((item) => sourceReviewRow(item.externalId, item.lessonId, item.sourceReference))),
  ...CANTONESE_V2_FOUNDATION.tones.map((tone) => sourceReviewRow(tone.contentId, CANTONESE_V2_FOUNDATION.id, 'ORIGINAL_ECFC_CONTENT: Mobile foundation tone draft')),
  sourceReviewRow(CANTONESE_V2_FOUNDATION.phrase.contentId, CANTONESE_V2_FOUNDATION.id, 'ORIGINAL_ECFC_CONTENT: Mobile foundation phrase draft'),
  ...CANTONESE_V2_FOUNDATION.questions.map((item) => sourceReviewRow(item.id, CANTONESE_V2_FOUNDATION.id, 'ORIGINAL_ECFC_CONTENT: Mobile foundation quiz draft')),
]

const audioManifestFromLessons = V6_COURSE_PACKS.flatMap((pack) => pack.audio.map((audio) => {
  const teaching = teachingById.get(audio.contentId)
  return {
    audioId: audio.externalId,
    lessonId: pack.definition.lessonId,
    contentId: audio.contentId,
    text: audio.text,
    jyutping: audio.jyutping,
    type: teaching?.contentType ?? 'UNKNOWN',
    voiceRequirement: '真人母语粤语录音或已授权的原生粤语音频',
    status: 'PENDING_TEXT_APPROVAL' as const,
    jyutpingStatus: 'PENDING_JYUTPING_APPROVAL' as const,
    realAudio: false as const,
  }
}))

const foundationAudioManifest = [
  ...CANTONESE_V2_FOUNDATION.tones.map((tone) => ({
    audioId: tone.audioId, lessonId: CANTONESE_V2_FOUNDATION.id, contentId: tone.contentId,
    text: tone.character, jyutping: tone.jyutpingCandidate, type: 'FOUNDATION_TONE',
    voiceRequirement: '真人母语粤语录音或已授权的原生粤语音频',
    status: 'PENDING_TEXT_APPROVAL' as const, jyutpingStatus: 'PENDING_JYUTPING_APPROVAL' as const, realAudio: false as const,
  })),
  {
    audioId: CANTONESE_V2_FOUNDATION.phrase.audioId, lessonId: CANTONESE_V2_FOUNDATION.id,
    contentId: CANTONESE_V2_FOUNDATION.phrase.contentId, text: CANTONESE_V2_FOUNDATION.phrase.text,
    jyutping: CANTONESE_V2_FOUNDATION.phrase.jyutpingCandidate, type: 'FOUNDATION_PHRASE',
    voiceRequirement: '真人母语粤语录音或已授权的原生粤语音频',
    status: 'PENDING_TEXT_APPROVAL' as const, jyutpingStatus: 'PENDING_JYUTPING_APPROVAL' as const, realAudio: false as const,
  },
]

export const CANTONESE_AUDIO_MANIFEST = [...audioManifestFromLessons, ...foundationAudioManifest]

export const CANTONESE_V2_CANDIDATE_PACK = {
  id: 'cantonese-v2-life-candidate',
  featureName: '番茄牛腩面不吃辣',
  courseId: 'cantonese.v2.life',
  courseTitle: '粤语入门',
  courseType: 'LIFE_CANTONESE',
  status: V6_CANDIDATE_STATUS,
  reviewStatus: V6_CANDIDATE_STATUS,
  foundation: CANTONESE_V2_FOUNDATION,
  lessons: CANTONESE_V2_LESSONS,
  mobileLesson05ReviewDecision: {
    decision: 'UNIT_REVIEW',
    scope: '复用 lesson-01 至 lesson-04 已有候选题目，不创建新的 Server lesson-05，也不覆盖 Server lesson-05。',
    status: 'CONTENT_REVIEW_REQUIRED',
  },
  courseUnifiedStatus: 'PARTIAL',
  scriptPolicy: '课程界面说明和中文释义可用简体中文；粤语目标词句保留现有书写，不做机械繁简转换。',
  content: allTeaching,
  questions: V6_COURSE_PACKS.flatMap((pack) => pack.questions),
  contentMapping: CANTONESE_V2_CONTENT_MAPPING,
  audioIdMapping: CANTONESE_V2_AUDIO_ID_MAPPING,
  questionMapping: CANTONESE_V2_QUESTION_MAPPING,
  jyutpingCandidates: V6_JYUTPING_CANDIDATES,
  jyutpingAmbiguous: CANTONESE_V2_JYUTPING_AMBIGUOUS,
  languageReviewQueue: V6_LANGUAGE_REVIEW_QUEUE,
  answerReviewQueue: CANTONESE_V2_ANSWER_REVIEW_QUEUE,
  shallowExplanationQueue: CANTONESE_V2_SHALLOW_EXPLANATION_QUEUE,
  audioManifest: CANTONESE_AUDIO_MANIFEST,
  sourceReview: CANTONESE_V2_SOURCE_REVIEW,
  exampleInventory: {
    displayTextCount: allTeaching.filter((item) => item.displayText !== null).length,
    exampleSentenceCount: allTeaching.reduce((total, item) => total + item.examples.length, 0),
    note: 'DISPLAY_TEXT remains separate. No duplicate display text is counted as an example sentence.',
  },
  readiness: {
    listening: 'BLOCKED_BY_AUDIO',
    speaking: 'UNSCORED_NON_GRADEABLE',
    foundationServerGate: 'NOT_REPRESENTED_BY_CURRENT_SCHEMA',
    migrationRequired: false,
    prismaSchemaChange: false,
  },
} as const

export const CANTONESE_V2_CANDIDATE_COUNTS = {
  lessonTotal: CANTONESE_V2_LESSONS.length,
  teachingTotal: CANTONESE_V2_CANDIDATE_PACK.content.length,
  displayTextTotal: CANTONESE_V2_CANDIDATE_PACK.exampleInventory.displayTextCount,
  questionTotal: CANTONESE_V2_CANDIDATE_PACK.questions.length,
  audioManifestTotal: CANTONESE_AUDIO_MANIFEST.length,
  mobileContentMappings: CANTONESE_V2_CONTENT_MAPPING.length,
  mobileAudioIdMappings: CANTONESE_V2_AUDIO_ID_MAPPING.length,
  mobileExerciseMappings: CANTONESE_V2_QUESTION_MAPPING.length,
  jyutpingCandidates: V6_JYUTPING_CANDIDATES.length,
  jyutpingAlreadyPresent: 18,
  answerReviewItems: CANTONESE_V2_ANSWER_REVIEW_QUEUE.length,
  shallowExplanationItems: CANTONESE_V2_SHALLOW_EXPLANATION_QUEUE.length,
  listeningBlocked: CANTONESE_V2_CANDIDATE_PACK.questions.filter((item) => item.questionType === 'LISTENING').length + CANTONESE_V2_FOUNDATION.questions.filter((item) => item.questionType === 'LISTENING').length,
  realAudio: 0,
} as const
