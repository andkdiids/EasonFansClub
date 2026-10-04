import { buildV6CoursePack } from './build'
import { V6_CANDIDATE_STATUS, type V6ContentDraft, type V6QuestionDraft } from './types'

const SOURCE = 'https://words.hk/zidin/唔該 ; https://words.hk/zidin/唔使客氣 ; https://words.hk/zidin/見 ; https://words.hk/zidin/多謝'

const content: V6ContentDraft[] = [
  { key: 'intro', section: '01-場景介紹', contentType: 'CONCEPT', title: '見面、道謝和道歉', text: '先看對方與場合，再選擇打招呼、道謝或道歉的說法。', meaning: '认识日常寒暄的使用场合', explanation: '本课先练短语，再练熟人、陌生人与服务场景；所有表达及读音均须语言审核。' },
  { key: 'morning', section: '02-關鍵詞', contentType: 'WORD', title: '早晨', text: '早晨', jyutping: 'zou2 san4', meaning: '早上好', explanation: '早上见面时的简短招呼。', requiresAudio: true, requiresSpeaking: true, sourceReference: 'https://words.hk/zidin/早晨' },
  { key: 'hello', section: '02-關鍵詞', contentType: 'WORD', title: '你好', text: '你好', jyutping: 'nei5 hou2', meaning: '你好', explanation: '可作礼貌招呼；不同关系和场合也可能用更自然的短句。', requiresAudio: true, sourceReference: 'https://words.hk/zidin/你好' },
  { key: 'long-time', section: '02-關鍵詞', contentType: 'WORD', title: '好耐冇見', text: '好耐冇見', jyutping: 'hou2 noi6 mou5 gin3', meaning: '好久不见', explanation: '较久未见的熟人再次见面时使用。', requiresAudio: true, requiresSpeaking: true, sourceReference: 'https://words.hk/zidin/見' },
  { key: 'please', section: '02-關鍵詞', contentType: 'WORD', title: '唔該', text: '唔該', jyutping: 'm4 goi1', meaning: '劳驾／谢谢帮忙', explanation: '可用于请求、吸引注意，或感谢别人提供服务。', requiresAudio: true, requiresSpeaking: true, sourceReference: 'https://words.hk/zidin/唔該' },
  { key: 'thanks', section: '02-關鍵詞', contentType: 'WORD', title: '多謝', text: '多謝', jyutping: 'do1 ze6', meaning: '谢谢', explanation: '常用于感谢礼物或明显的好意；和「唔該」的用法要作对比。', requiresAudio: true, requiresSpeaking: true, sourceReference: 'https://words.hk/zidin/多謝' },
  { key: 'youre-welcome', section: '02-關鍵詞', contentType: 'WORD', title: '唔使客氣', text: '唔使客氣', jyutping: 'm4 sai2 haak3 hei3', meaning: '不用客气', explanation: '回应对方的感谢；个别语境也可以表示“不必麻烦”。', requiresAudio: true, sourceReference: 'https://words.hk/zidin/唔使客氣' },
  { key: 'sorry', section: '02-關鍵詞', contentType: 'WORD', title: '對唔住', text: '對唔住', jyutping: 'deoi3 m4 zyu6', meaning: '对不起', explanation: '承认给别人带来麻烦或做错事时使用。', requiresAudio: true, requiresSpeaking: true, sourceReference: 'https://words.hk/zidin/對唔住' },
  { key: 'no-matter', section: '02-關鍵詞', contentType: 'WORD', title: '唔緊要', text: '唔緊要', jyutping: 'm4 gan2 jiu3', meaning: '没关系', explanation: '回应轻微道歉时常用，具体语气和程度须审核。', requiresAudio: true, sourceReference: 'https://words.hk/zidin/唔緊要' },
  { key: 'see-you', section: '02-關鍵詞', contentType: 'WORD', title: '下次見', text: '下次見', jyutping: 'haa6 ci3 gin3', meaning: '下次见', explanation: '告别时约定以后再见。', requiresAudio: true, sourceReference: 'https://words.hk/zidin/見' },
  { key: 'thanks-contrast', section: '03-核心句型', contentType: 'CONTRAST', title: '唔該與多謝', text: '唔該／多謝', meaning: '两种“谢谢”要看情境', explanation: '让座、指路等协助常可说「唔該」；收到礼物常可说「多謝」。不是机械一对一翻译。', requiresAudio: true, sourceReference: SOURCE },
  { key: 'thanks-phrase', section: '03-核心短語', contentType: 'PHRASE', title: '唔該晒', text: '唔該晒', jyutping: 'm4 goi1 saai3', meaning: '非常感谢', explanation: '得到具体帮助后可以用来表达谢意；实际语气和使用范围待审核。', requiresAudio: true, requiresSpeaking: true, sourceReference: 'https://words.hk/zidin/唔該' },
  { key: 'how-lately', section: '03-核心句型', contentType: 'SENTENCE', title: '近排點呀？', text: '近排點呀？', meaning: '最近怎么样？', explanation: '熟人寒暄的开放式问题；语气和读音待核对。', requiresAudio: true, requiresSpeaking: true, sourceReference: 'https://words.hk/zidin/喂' },
  { key: 'im-good', section: '03-核心句型', contentType: 'SENTENCE', title: '我幾好，你呢？', text: '我幾好，你呢？', meaning: '我还不错，你呢？', explanation: '简短回答后把话题交还给对方。', requiresAudio: true, requiresSpeaking: true },
  { key: 'excuse-question', section: '03-核心句型', contentType: 'SENTENCE', title: '唔該，想問你一樣嘢。', text: '唔該，想問你一樣嘢。', meaning: '劳驾，我想问你一件事。', explanation: '向陌生人发问前先礼貌开场。', requiresAudio: true },
  { key: 'gift-thanks', section: '03-核心句型', contentType: 'SENTENCE', title: '多謝你送畀我。', text: '多謝你送畀我。', meaning: '谢谢你送给我。', explanation: '表达对礼物的感谢；「畀」的读音待专业核对。', requiresAudio: true },
  { key: 'bye', section: '03-核心句型', contentType: 'SENTENCE', title: '我走先喇，下次見。', text: '我走先喇，下次見。', meaning: '我先走了，下次见。', explanation: '自然结束短谈；句末语气词须核对使用场景。', requiresAudio: true, requiresSpeaking: true },
  { key: 'd1a', section: '04-真實對話', contentType: 'DIALOGUE', title: '熟人相遇 · A', text: '早晨！好耐冇見。', meaning: '早上好，好久不见。', explanation: '先打招呼，再说明久未见。', requiresAudio: true, dialogueId: 'friends', speaker: 'A' },
  { key: 'd1b', section: '04-真實對話', contentType: 'DIALOGUE', title: '熟人相遇 · B', text: '係呀，近排點呀？', meaning: '是啊，最近怎么样？', explanation: '回应并接一个关心的问题。', requiresAudio: true, dialogueId: 'friends', speaker: 'B' },
  { key: 'd1c', section: '04-真實對話', contentType: 'DIALOGUE', title: '熟人相遇 · A', text: '我幾好，你呢？', meaning: '我还不错，你呢？', explanation: '承接上句并回问。', requiresAudio: true, dialogueId: 'friends', speaker: 'A' },
  { key: 'd1d', section: '04-真實對話', contentType: 'DIALOGUE', title: '熟人相遇 · B', text: '我都幾好。得閒再傾！', meaning: '我也还好，有空再聊。', explanation: '把短谈自然收束；「得閒」的用法待审核。', requiresAudio: true, dialogueId: 'friends', speaker: 'B' },
  { key: 'd2a', section: '04-真實對話', contentType: 'DIALOGUE', title: '請人幫忙 · A', text: '唔該，可唔可以幫我開門？', meaning: '劳驾，可以帮我开门吗？', explanation: '有礼貌地提出请求。', requiresAudio: true, requiresSpeaking: true, dialogueId: 'help', speaker: 'A' },
  { key: 'd2b', section: '04-真實對話', contentType: 'DIALOGUE', title: '請人幫忙 · B', text: '得，冇問題。', meaning: '可以，没问题。', explanation: '简短答应请求。', requiresAudio: true, dialogueId: 'help', speaker: 'B' },
  { key: 'd2c', section: '04-真實對話', contentType: 'DIALOGUE', title: '請人幫忙 · A', text: '唔該晒！', jyutping: 'm4 goi1 saai3', meaning: '十分感谢。', explanation: '感谢对方提供的帮助。', requiresAudio: true, dialogueId: 'help', speaker: 'A', sourceReference: 'https://words.hk/zidin/唔該' },
  { key: 'd2d', section: '04-真實對話', contentType: 'DIALOGUE', title: '請人幫忙 · B', text: '唔使客氣。', meaning: '不用客气。', explanation: '回应感谢。', requiresAudio: true, dialogueId: 'help', speaker: 'B' },
  { key: 'd3a', section: '04-真實對話', contentType: 'DIALOGUE', title: '輕微碰撞 · A', text: '對唔住，我冇留意。', meaning: '对不起，我没留意。', explanation: '承认自己的疏忽。', requiresAudio: true, requiresSpeaking: true, dialogueId: 'apology', speaker: 'A' },
  { key: 'd3b', section: '04-真實對話', contentType: 'DIALOGUE', title: '輕微碰撞 · B', text: '唔緊要，你冇事吖嘛？', meaning: '没关系，你没事吧？', explanation: '回应道歉并确认对方情况。', requiresAudio: true, dialogueId: 'apology', speaker: 'B' },
  { key: 'd3c', section: '04-真實對話', contentType: 'DIALOGUE', title: '輕微碰撞 · A', text: '冇事，多謝你。', meaning: '没事，谢谢你。', explanation: '回应关心；此处道谢词选择待人工审核。', requiresAudio: true, dialogueId: 'apology', speaker: 'A' },
  { key: 'd3d', section: '04-真實對話', contentType: 'DIALOGUE', title: '輕微碰撞 · B', text: '咁就好，拜拜。', meaning: '那就好，再见。', explanation: '结束短对话。', requiresAudio: true, dialogueId: 'apology', speaker: 'B' },
  { key: 'self-compare', section: '06-跟讀', contentType: 'SPEAKING_PRACTICE', title: '自己比較：禮貌開場', text: '唔該，可唔可以幫我開門？', meaning: '练习礼貌请求', explanation: '先听审核通过的标准音，再录自己的声音并 A/B 回听；不评分。', requiresAudio: true, requiresSpeaking: true },
  { key: 'review', section: '08-回顧', contentType: 'SUMMARY', title: '見面與禮貌用語回顧', text: '按场合选开场、感谢与回应。', meaning: '复习', explanation: '「唔該」和「多謝」不能只看中文译词，须结合是否请求帮助、服务或礼物。', sourceReference: SOURCE },
]

const questions: V6QuestionDraft[] = [
  { key: 'greet-morning', questionType: 'SINGLE_SELECT', prompt: '早上遇到熟人，想明确说“早上好”，选哪句？', options: ['早晨！', '好耐冇見！', '近排點呀？', '下次見！'], correct: [0], explanation: '几句都可能用于寒暄，但只有「早晨」明确是早上招呼。', prerequisites: ['morning', 'long-time', 'how-lately', 'see-you'] },
  { key: 'long-time', questionType: 'SINGLE_SELECT', prompt: '很久没见的朋友再见面，哪句直接点出“好久不见”？', options: ['好耐冇見。', '近排點呀？', '我幾好，你呢？', '下次見。'], correct: [0], explanation: '几句都可出现在同一段寒暄中，但「好耐冇見」直接说明久未相见。', prerequisites: ['long-time', 'how-lately', 'im-good', 'see-you'] },
  { key: 'ask-help', questionType: 'SINGLE_SELECT', prompt: '想请人帮忙开门，哪句较有礼貌？', options: ['唔該，可唔可以幫我開門？', '你幫我開門啦。', '多謝你幫我開門。', '對唔住，我冇留意。'], correct: [0], explanation: '第一句在请求尚未完成时使用；「多謝」是事后的感谢。', prerequisites: ['please', 'd2a', 'thanks', 'sorry'] },
  { key: 'gift', questionType: 'SINGLE_SELECT', prompt: '朋友送你礼物，本课建议优先选哪个道谢词？', options: ['多謝', '唔緊要', '對唔住', '下次見'], correct: [0], explanation: '感谢明显的赠礼可用「多謝」；最终用法仍须审核。', prerequisites: ['thanks', 'thanks-contrast'] },
  { key: 'service', questionType: 'SINGLE_SELECT', prompt: '别人帮你推开门后，本课对话用哪句道谢？', options: ['唔該晒！', '唔使客氣。', '對唔住。', '我冇留意。'], correct: [0], explanation: '「唔該晒」感谢帮助；「唔使客氣」由对方回应。', prerequisites: ['please', 'd2c', 'youre-welcome', 'sorry'] },
  { key: 'sorry-response', questionType: 'SINGLE_SELECT', prompt: '有人轻轻碰到你并道歉，可怎样回应？', options: ['唔緊要。', '多謝你送畀我。', '我走先喇。', '可唔可以幫我開門？'], correct: [0], explanation: '「唔緊要」可回应轻微道歉。', prerequisites: ['no-matter', 'd3b'] },
  { key: 'reply-how', questionType: 'SINGLE_SELECT', prompt: '对方问「近排點呀？」，哪句是自然接话？', options: ['我幾好，你呢？', '好耐冇見，你呢？', '多謝你送畀我。', '我走先喇，下次見。'], correct: [0], explanation: '先回答自己的近况，再回问对方；其余分别是重新寒暄、收礼道谢和告别。', prerequisites: ['how-lately', 'im-good', 'long-time', 'gift-thanks', 'bye'] },
  { key: 'bye-context', questionType: 'SINGLE_SELECT', prompt: '准备结束短谈时，哪句更贴合？', options: ['我走先喇，下次見。', '可唔可以幫我開門？', '對唔住，我冇留意。', '你冇事吖嘛？'], correct: [0], explanation: '「我走先喇，下次見」用于告别。', prerequisites: ['bye'] },
  { key: 'thanks-multi', questionType: 'MULTI_SELECT', prompt: '哪些情境适合用本课的「唔該」或「多謝」？（多选）', options: ['别人帮忙开门后说「唔該」', '收到礼物后说「多謝」', '碰撞别人后说「下次見」', '问路前用「唔該」礼貌开场'], correct: [0, 1, 3], explanation: '帮助和礼物场景是在道谢；问路前的「唔該」是礼貌开场，不是感谢。', prerequisites: ['thanks-contrast', 'excuse-question'] },
  { key: 'apology-multi', questionType: 'MULTI_SELECT', prompt: '轻微碰撞的对话中，哪些表达可以自然出现？（多选）', options: ['道歉者说「對唔住」', '对方说「唔緊要」', '道歉者说「走冰」', '对方关心「你冇事吖嘛？」'], correct: [0, 1, 3], explanation: '道歉、体谅和关心可按对话角色依次衔接。', prerequisites: ['sorry', 'no-matter', 'd3a', 'd3b'] },
  { key: 'thanks-false', questionType: 'TRUE_FALSE', prompt: '「唔該」和「多謝」在所有场景都可以无差别交换。', options: ['正确', '错误'], correct: [1], explanation: '两词侧重的场合不同，不能机械互换。', prerequisites: ['thanks-contrast'] },
  { key: 'review-true', questionType: 'TRUE_FALSE', prompt: '课程对话里，「唔使客氣」可用于回应别人道谢。', options: ['正确', '错误'], correct: [0], explanation: '本课帮助对话即这样使用。', prerequisites: ['youre-welcome', 'd2d'] },
  { key: 'listen-morning', questionType: 'LISTENING', prompt: '听标准音，选择听到的招呼。', options: ['早晨', '多謝', '對唔住', '唔緊要'], correct: [0], explanation: '音频与「早晨」候选资产绑定；未 READY 不可审核通过。', prerequisites: ['morning'], audioFrom: 'morning' },
  { key: 'listen-thanks', questionType: 'LISTENING', prompt: '听标准音，选择听到的道谢语。', options: ['唔該晒', '下次見', '好耐冇見', '唔使客氣'], correct: [0], explanation: '音频与「唔該晒」候选资产绑定。', prerequisites: ['d2c'], audioFrom: 'd2c' },
  { key: 'listen-apology', questionType: 'LISTENING', prompt: '听标准音，选择听到的回应。', options: ['唔緊要，你冇事吖嘛？', '我幾好，你呢？', '得，冇問題。', '我走先喇。'], correct: [0], explanation: '音频与道歉对话 B 的原句绑定。', prerequisites: ['d3b'], audioFrom: 'd3b' },
  { key: 'speak-morning', questionType: 'SPEAKING', prompt: '情景：早上遇到熟人。听标准音，录下「早晨」并自行比较。', options: [], correct: [], explanation: '本题只做本机 A/B 回听，不给 AI 分数。', prerequisites: ['morning'], audioFrom: 'morning', speakingFrom: 'morning' },
  { key: 'speak-help', questionType: 'SPEAKING', prompt: '情景：请别人帮你开门。听标准音，录下礼貌请求并自行比较。', options: [], correct: [], explanation: '对照课程的完整请求句，自主回听。', prerequisites: ['d2a'], audioFrom: 'd2a', speakingFrom: 'd2a' },
  { key: 'challenge-open', questionType: 'SINGLE_SELECT', prompt: '情景挑战：陌生人帮你开了门，下一句怎样自然衔接？', options: ['唔該晒！', '好耐冇見！', '我冇留意。', '你冇事吖嘛？'], correct: [0], explanation: '对帮助致谢，接着可听到「唔使客氣」。', prerequisites: ['d2a', 'd2b', 'd2c', 'd2d'] },
]

export const LESSON_05_GREETINGS = buildV6CoursePack(
  { lessonId: 'lesson-05', lessonNumber: 5, title: '打招呼與基本交流', subtitle: '從開場、道謝到自然告別', description: '以短詞、日常寒暄與三段短對話練習基本交流。', sortOrder: 5, prerequisiteLessonId: 'lesson-04', status: V6_CANDIDATE_STATUS, reviewStatus: V6_CANDIDATE_STATUS },
  'greetings-basic', content, questions,
  { friends: '熟人相遇', help: '請人幫忙', apology: '輕微碰撞與道歉' },
)
