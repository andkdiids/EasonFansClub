import { buildV6CoursePack } from './build'
import { V6_CANDIDATE_STATUS, type V6ContentDraft, type V6QuestionDraft } from './types'

const source = 'ORIGINAL_ECFC_CONTENT: Mobile cantonese-beginner-life draft; Jyutping and wording require human review.'

const content: V6ContentDraft[] = [
  { key: 'i', section: '01-人稱', contentType: 'WORD', title: '我', text: '我', jyutping: 'ngo5', meaning: '说话的人自己。', explanation: '指说话的人自己。', requiresAudio: true, sourceReference: source },
  { key: 'you', section: '01-人稱', contentType: 'WORD', title: '你', text: '你', jyutping: 'nei5', meaning: '正在交谈的对方。', explanation: '面对交谈对象时使用。', requiresAudio: true, sourceReference: source },
  { key: 'he', section: '01-人稱', contentType: 'WORD', title: '佢', text: '佢', jyutping: 'keoi5', meaning: '他 / 她；粤语书写不区分这两个“他”。', explanation: '粤语口语中用「佢」指第三人，不区分汉语书写里的“他”和“她”。', requiresAudio: true, sourceReference: source },
  { key: 'you-plural', section: '02-複數', contentType: 'WORD', title: '你哋', text: '你哋', jyutping: 'nei5 dei6', meaning: '你们。', explanation: '「你哋」表示复数的交谈对象。', requiresAudio: true, sourceReference: source },
]

const questions: V6QuestionDraft[] = [
  { key: 'pronoun-he', questionType: 'SINGLE_SELECT', prompt: '「佢」通常指谁？', options: ['我自己', '正在听的人', '他 / 她', '我们'], correct: [2], explanation: '粤语「佢」不区分中文书写里的“他”和“她”。', prerequisites: ['i', 'you', 'he'], sourceReference: source },
  { key: 'match-i-jyutping', questionType: 'SINGLE_SELECT', prompt: '「我」对应哪组粤拼？', options: ['ngo5', 'nei5', 'keoi5', 'nei5 dei6'], correct: [0], explanation: '逐项核对人称与粤拼；读音尚未人工确认。', prerequisites: ['i', 'you', 'he', 'you-plural'], sourceReference: source },
  { key: 'match-you-jyutping', questionType: 'SINGLE_SELECT', prompt: '「你」对应哪组粤拼？', options: ['ngo5', 'nei5', 'keoi5', 'nei5 dei6'], correct: [1], explanation: '逐项核对人称与粤拼；读音尚未人工确认。', prerequisites: ['i', 'you', 'he', 'you-plural'], sourceReference: source },
  { key: 'match-he-jyutping', questionType: 'SINGLE_SELECT', prompt: '「佢」对应哪组粤拼？', options: ['ngo5', 'nei5', 'keoi5', 'nei5 dei6'], correct: [2], explanation: '逐项核对人称与粤拼；读音尚未人工确认。', prerequisites: ['i', 'you', 'he', 'you-plural'], sourceReference: source },
  { key: 'you-plural-meaning', questionType: 'SINGLE_SELECT', prompt: '「你哋」是什么意思？', options: ['你', '你们', '他们', '我'], correct: [1], explanation: '「哋」与人称搭配时可表示复数；具体讲解待人工审核。', prerequisites: ['you', 'you-plural'], sourceReference: source },
]

export const LESSON_02_PRONOUNS = buildV6CoursePack(
  { lessonId: 'lesson-02', lessonNumber: 2, title: '我、你、佢', subtitle: '认识对话中的人称', description: '辨认我、你、佢和你哋，并将常用人称与粤拼对应。', sortOrder: 2, prerequisiteLessonId: 'lesson-01', status: V6_CANDIDATE_STATUS, reviewStatus: V6_CANDIDATE_STATUS },
  'cantonese-life-02', content, questions, {},
)
