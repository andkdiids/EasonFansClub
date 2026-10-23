import { buildV6CoursePack } from './build'
import { V6_CANDIDATE_STATUS, type V6ContentDraft, type V6QuestionDraft } from './types'

const source = 'ORIGINAL_ECFC_CONTENT: Mobile cantonese-beginner-life draft; Jyutping and wording require human review.'

const content: V6ContentDraft[] = [
  { key: 'is', section: '01-基本判斷', contentType: 'WORD', title: '係', text: '係', jyutping: 'hai6', meaning: '是 / 对；用于判断或确认。', explanation: '在本课基础判断句中表示“是 / 对”。', requiresAudio: true, sourceReference: source },
  { key: 'is-not', section: '01-基本判斷', contentType: 'WORD', title: '唔係', text: '唔係', jyutping: 'm4 hai6', meaning: '不是。', explanation: '在本课判断句中表示“不是”。', requiresAudio: true, sourceReference: source },
  { key: 'is-question', section: '01-基本判斷', contentType: 'WORD', title: '係咪', text: '係咪', jyutping: 'hai6 mai6', meaning: '是不是；常用于是非问句。', explanation: '常放在判断问句中询问“是不是”。', requiresAudio: true, sourceReference: source },
  { key: 'ask-xiaoming', section: '02-完整句子', contentType: 'SENTENCE', title: '你係咪小明呀？', text: '你係咪小明呀？', jyutping: 'nei5 hai6 mai6 siu2 ming4 aa3', meaning: '你是小明吗？', explanation: '用「係咪」询问对方是否为小明。', requiresAudio: true, sourceReference: source },
  { key: 'not-xiaoming', section: '02-完整句子', contentType: 'SENTENCE', title: '我唔係小明。', text: '我唔係小明。', jyutping: 'ngo5 m4 hai6 siu2 ming4', meaning: '我不是小明。', explanation: '用「唔係」表达否定判断。', requiresAudio: true, sourceReference: source },
  { key: 'i-am-xiaoming', section: '02-完整句子', contentType: 'SENTENCE', title: '我係小明。', text: '我係小明。', jyutping: 'ngo5 hai6 siu2 ming4', meaning: '我是小明。', explanation: '用「係」作肯定回答；这是课程示例姓名。', requiresAudio: true, sourceReference: source },
]

const questions: V6QuestionDraft[] = [
  { key: 'not-meaning', questionType: 'SINGLE_SELECT', prompt: '「唔係」是什么意思？', options: ['是', '不是', '谁', '哪里'], correct: [1], explanation: '「唔係」表示否定判断；释义仍需人工审核。', prerequisites: ['is', 'is-not'], sourceReference: source },
  { key: 'match-is-meaning', questionType: 'SINGLE_SELECT', prompt: '「係」最接近哪个意思？', options: ['是 / 对', '不是', '是不是', '再见'], correct: [0], explanation: '根据本课判断句理解；具体用法需要人工审核。', prerequisites: ['is', 'is-not', 'is-question'], sourceReference: source },
  { key: 'match-is-not-meaning', questionType: 'SINGLE_SELECT', prompt: '「唔係」最接近哪个意思？', options: ['是 / 对', '不是', '是不是', '再见'], correct: [1], explanation: '注意否定词「唔」；读音和语法仍需人工确认。', prerequisites: ['is', 'is-not', 'is-question'], sourceReference: source },
  { key: 'match-is-question-meaning', questionType: 'SINGLE_SELECT', prompt: '「係咪」最接近哪个意思？', options: ['是', '不是', '是不是', '再见'], correct: [2], explanation: '「係咪」在本课用于是非问句。', prerequisites: ['is', 'is-not', 'is-question'], sourceReference: source },
  { key: 'order-negative', questionType: 'SINGLE_SELECT', prompt: '选出正确句子：「我不是小明。」', options: ['小明我唔係。', '我唔係小明。', '我係小明。', '你係咪小明呀？'], correct: [1], explanation: '选择本课的否定判断句。', prerequisites: ['is-not', 'not-xiaoming'], sourceReference: source },
  { key: 'affirmative-answer', questionType: 'SINGLE_SELECT', prompt: '听到「你係咪小明呀？」，回答“是”，可以选哪句？', options: ['係，我係小明。', '早晨。', '拜拜。', '你叫咩名呀？'], correct: [0], explanation: '用「係」作肯定回答；完整答句为候选表达。', prerequisites: ['is', 'ask-xiaoming', 'i-am-xiaoming'], sourceReference: source },
]

export const LESSON_04_IS_OR_NOT = buildV6CoursePack(
  { lessonId: 'lesson-04', lessonNumber: 4, title: '係 / 唔係', subtitle: '肯定、否定与确认', description: '区分「係」「唔係」「係咪」，并在完整句中练习肯定和否定判断。', sortOrder: 4, prerequisiteLessonId: 'lesson-03', status: V6_CANDIDATE_STATUS, reviewStatus: V6_CANDIDATE_STATUS },
  'cantonese-life-04', content, questions, {},
)
