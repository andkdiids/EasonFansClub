import { buildV6CoursePack } from './build'
import { V6_CANDIDATE_STATUS, type V6ContentDraft, type V6QuestionDraft } from './types'

const source = 'ORIGINAL_ECFC_CONTENT: Mobile cantonese-beginner-life draft; Jyutping and wording require human review.'

const content: V6ContentDraft[] = [
  { key: 'hello', section: '01-問候', contentType: 'WORD', title: '你好', text: '你好', jyutping: 'nei5 hou2', meaning: '你好；日常见面的问候语。', explanation: '认识一句日常见面时可以使用的问候语。', requiresAudio: true, sourceReference: source },
  { key: 'morning', section: '01-問候', contentType: 'WORD', title: '早晨', text: '早晨', jyutping: 'zou2 san4', meaning: '早上好 / 早安。', explanation: '早上见面时可以使用的简短问候。', requiresAudio: true, sourceReference: source },
  { key: 'bye', section: '02-告別', contentType: 'WORD', title: '拜拜', text: '拜拜', jyutping: 'baai1 baai3', meaning: '再见；口语告别。', explanation: '分别时使用的口语告别语。', requiresAudio: true, sourceReference: source },
]

const questions: V6QuestionDraft[] = [
  { key: 'morning-meaning', questionType: 'SINGLE_SELECT', prompt: '「早晨」是什么意思？', options: ['早上好', '晚安', '谢谢', '再见'], correct: [0], explanation: '「早晨」是早上见面时的问候；此释义仍待人工审核。', prerequisites: ['morning'], sourceReference: source },
  { key: 'greeting-situation', questionType: 'SINGLE_SELECT', prompt: '早上见到朋友，哪句最合适？', options: ['早晨', '拜拜', '我叫小明。', '唔係'], correct: [0], explanation: '按题目中的早上见面情境选择问候语。', prerequisites: ['hello', 'morning', 'bye'], sourceReference: source },
  { key: 'match-hello-jyutping', questionType: 'SINGLE_SELECT', prompt: '「你好」对应哪组粤拼？', options: ['nei5 hou2', 'nei5 dei6', 'baai1 baai3', 'zou2 san4'], correct: [0], explanation: '逐项核对文字与粤拼；读音尚未人工确认。', prerequisites: ['hello', 'morning', 'bye'], sourceReference: source },
  { key: 'match-morning-jyutping', questionType: 'SINGLE_SELECT', prompt: '「早晨」对应哪组粤拼？', options: ['hou2 noi6 mou5 gin3', 'zou2 san4', 'nei5 hou2', 'baai1 baai3'], correct: [1], explanation: '逐项核对文字与粤拼；读音尚未人工确认。', prerequisites: ['hello', 'morning', 'bye'], sourceReference: source },
  { key: 'match-bye-jyutping', questionType: 'SINGLE_SELECT', prompt: '「拜拜」对应哪组粤拼？', options: ['nei5 hou2', 'zou2 san4', 'baai1 baai3', 'ngo5 nei5'], correct: [2], explanation: '逐项核对文字与粤拼；读音尚未人工确认。', prerequisites: ['hello', 'morning', 'bye'], sourceReference: source },
  { key: 'order-hello', questionType: 'SINGLE_SELECT', prompt: '选出正确写法：「你好」', options: ['好你', '你好', '你我', '早好'], correct: [1], explanation: '选择课程中的目标问候语书写。', prerequisites: ['hello'], sourceReference: source },
]

export const LESSON_01_HELLO = buildV6CoursePack(
  { lessonId: 'lesson-01', lessonNumber: 1, title: '你好', subtitle: '初次见面，从简单问候开始', description: '认识你好、早晨和拜拜，并在简单场景中辨认文字与粤拼。', sortOrder: 1, prerequisiteLessonId: null, status: V6_CANDIDATE_STATUS, reviewStatus: V6_CANDIDATE_STATUS },
  'cantonese-life-01', content, questions, {},
)
