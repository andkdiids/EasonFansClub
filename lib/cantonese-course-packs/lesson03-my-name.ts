import { buildV6CoursePack } from './build'
import { V6_CANDIDATE_STATUS, type V6ContentDraft, type V6QuestionDraft } from './types'

const source = 'ORIGINAL_ECFC_CONTENT: Mobile cantonese-beginner-life draft; Jyutping and wording require human review.'

const content: V6ContentDraft[] = [
  { key: 'my-name', section: '01-自我介紹', contentType: 'SENTENCE', title: '我叫小明。', text: '我叫小明。', jyutping: 'ngo5 giu3 siu2 ming4', meaning: '我的名字是小明。', explanation: '介绍自己的名字时可以使用这个句式。', requiresAudio: true, sourceReference: source },
  { key: 'ask-name', section: '01-自我介紹', contentType: 'SENTENCE', title: '你叫咩名呀？', text: '你叫咩名呀？', jyutping: 'nei5 giu3 me1 meng2 aa3', meaning: '你叫什么名字？（自然口语问法）', explanation: '用来询问对方的名字；语气词和场合仍需人工审核。', requiresAudio: true, sourceReference: source },
  { key: 'what', section: '02-詞語', contentType: 'WORD', title: '咩', text: '咩', jyutping: 'me1', meaning: '什么；常见口语用法。', explanation: '在本课问句中，「咩」对应“什么”。', requiresAudio: true, sourceReference: source },
  { key: 'name', section: '02-詞語', contentType: 'WORD', title: '名', text: '名', jyutping: 'meng2', meaning: '名字 / 名称。', explanation: '在「你叫咩名呀？」中指名字；单字读音和语境须核对。', requiresAudio: true, sourceReference: source },
  { key: 'you-then', section: '03-對話延伸', contentType: 'PHRASE', title: '你呢？', text: '你呢？', jyutping: 'nei5 ne1', meaning: '你呢？ / 那你呢？', explanation: '回答后可以用来把问题交还给对方。', requiresAudio: true, sourceReference: source },
]

const questions: V6QuestionDraft[] = [
  { key: 'ask-name-meaning', questionType: 'SINGLE_SELECT', prompt: '「你叫咩名呀？」是什么意思？', options: ['你在哪里？', '你叫什么名字？', '吃饭了吗？', '早上好。'], correct: [1], explanation: '「咩」在这个问句中表示“什么”；释义和语气待人工审核。', prerequisites: ['ask-name', 'what', 'name'], sourceReference: source },
  { key: 'what-meaning', questionType: 'SINGLE_SELECT', prompt: '「咩」在本课问句中对应哪个意思？', options: ['谁', '什么', '哪里', '什么时候'], correct: [1], explanation: '根据「你叫咩名呀？」的上下文理解词义。', prerequisites: ['ask-name', 'what'], sourceReference: source },
  { key: 'name-meaning', questionType: 'SINGLE_SELECT', prompt: '「名」在「你叫咩名呀？」中指什么？', options: ['名字', '地方', '时间', '食物'], correct: [0], explanation: '这里「名」与询问姓名有关；单字读音须人工确认。', prerequisites: ['ask-name', 'name'], sourceReference: source },
  { key: 'order-my-name', questionType: 'SINGLE_SELECT', prompt: '选出正确句子：「我的名字是小明。」', options: ['小明叫我。', '我叫小明。', '你叫小明。', '我小明叫。'], correct: [1], explanation: '选择本课的自我介绍句式。', prerequisites: ['my-name'], sourceReference: source },
  { key: 'answer-introduction', questionType: 'SINGLE_SELECT', prompt: '有人问「你叫咩名呀？」，哪句可以回答自己的名字？', options: ['我叫小明。', '早晨。', '拜拜。', '你叫咩名呀？'], correct: [0], explanation: '用「我叫……」回答自己的名字；示例姓名可替换。', prerequisites: ['my-name', 'ask-name', 'you-then'], sourceReference: source },
]

export const LESSON_03_MY_NAME = buildV6CoursePack(
  { lessonId: 'lesson-03', lessonNumber: 3, title: '我叫……', subtitle: '介绍自己，也问问对方', description: '用「我叫……」介绍自己，用「你叫咩名呀？」询问姓名，再练习「你呢？」。', sortOrder: 3, prerequisiteLessonId: 'lesson-02', status: V6_CANDIDATE_STATUS, reviewStatus: V6_CANDIDATE_STATUS },
  'cantonese-life-03', content, questions, {},
)
