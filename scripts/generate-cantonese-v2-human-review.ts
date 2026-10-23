import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  CANTONESE_AUDIO_MANIFEST,
  CANTONESE_V2_ANSWER_REVIEW_QUEUE,
  CANTONESE_V2_AUDIO_ID_MAPPING,
  CANTONESE_V2_CANDIDATE_PACK,
  CANTONESE_V2_CONTENT_MAPPING,
  CANTONESE_V2_FOUNDATION,
  CANTONESE_V2_JYUTPING_AMBIGUOUS,
  CANTONESE_V2_LESSONS,
  CANTONESE_V2_QUESTION_MAPPING,
  CANTONESE_V2_SHALLOW_EXPLANATION_QUEUE,
  CANTONESE_V2_SOURCE_REVIEW,
} from '../lib/cantonese-course-packs/cantonese-v2-candidate'
import { V6_COURSE_PACKS } from '../lib/cantonese-course-packs'
import { V6_JYUTPING_CANDIDATES } from '../lib/cantonese-course-packs/jyutping-candidates'
import { V6_LANGUAGE_REVIEW_QUEUE } from '../lib/cantonese-course-packs/review-metadata'

const rows = (values: readonly (string | number)[]) => `| ${values.map((value) => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')).join(' | ')} |`
const table = (headers: readonly string[], data: readonly (readonly (string | number)[])[]) => [rows(headers), rows(headers.map(() => '---')), ...data.map(rows)].join('\n')
const answerFor = (question: { options: { id: string; text: string }[]; correctAnswer: string[] }) =>
  question.correctAnswer.map((id) => question.options.find((option) => option.id === id)?.text ?? id).join('；') || '无（不评分）'
const readingById = new Map(V6_JYUTPING_CANDIDATES.map((item) => [item.contentId, item]))
const shallowById = new Map<string, (typeof CANTONESE_V2_SHALLOW_EXPLANATION_QUEUE)[number]>(CANTONESE_V2_SHALLOW_EXPLANATION_QUEUE.map((item) => [item.questionId, item]))
const answerIssueById = new Map<string, (typeof CANTONESE_V2_ANSWER_REVIEW_QUEUE)[number]>(CANTONESE_V2_ANSWER_REVIEW_QUEUE.map((item) => [item.questionId, item]))
const sourceCounts = Object.fromEntries(['ORIGINAL_ECFC_CONTENT', 'SOURCE_DOCUMENTED', 'SOURCE_UNKNOWN'].map((status) => [
  status,
  CANTONESE_V2_SOURCE_REVIEW.filter((item) => item.sourceStatus === status).length,
]))
const unknownSources = CANTONESE_V2_SOURCE_REVIEW.filter((item) => item.sourceStatus === 'SOURCE_UNKNOWN')
const displayRows = CANTONESE_V2_CANDIDATE_PACK.content.filter((item) => item.displayText)
const candidateQuestionTotal = CANTONESE_V2_CANDIDATE_PACK.questions.length
const questionTypes = ['SINGLE_SELECT', 'MULTI_SELECT', 'TRUE_FALSE', 'LISTENING', 'SPEAKING'] as const
const questionTypeCounts = Object.fromEntries(questionTypes.map((type) => [
  type,
  CANTONESE_V2_CANDIDATE_PACK.questions.filter((item) => item.questionType === type).length,
]))
const sourceUnknownText = unknownSources.length
  ? unknownSources.map((item) => `- ${item.itemId}（${item.lessonId}）：来源未能从候选记录确认；版权审查仍需完成。`).join('\n')
  : '- 没有来源未知条目。'

const lines: string[] = [
  '# 番茄牛腩面不吃辣 · Cantonese V2 人工审核包',
  '',
  '> 本文件对应隔离分支上的内容候选，仅供人工审核。所有候选仍是 `CONTENT_REVIEW_REQUIRED` / `HUMAN_REVIEW_REQUIRED`；没有批准、发布、部署、数据库写入、TTS 生成或 COS 上传。',
  '',
  '## HIGH PRIORITY REVIEW',
  '',
  '先处理歧义题、多音字、来源未知、课程重复和 Foundation 名称不一致。以下建议不修改原答案或原文。',
  '',
  '### 4 个歧义题',
]

for (const item of CANTONESE_V2_ANSWER_REVIEW_QUEUE) {
  lines.push('', `#### ${item.questionId}`, `- Lesson：${item.lessonId}`, `- 题干：${item.prompt}`, `- 选项：${item.options.join(' / ')}`, `- 当前答案：${item.currentAnswer.join(' / ')}`, `- 当前解释：${item.currentExplanation}`, `- 歧义：${item.whyAmbiguous}`, `- 建议：${item.recommendedFix}`, '- 状态：HUMAN_REVIEW_REQUIRED')
}

lines.push('', '### 多音字与读音分歧', '', table(
  ['ITEM_ID', 'LESSON', 'TEXT', 'JYUTPING_CANDIDATE', 'REASON', 'STATUS'],
  CANTONESE_V2_JYUTPING_AMBIGUOUS.map((item) => [item.itemId, item.lessonId, item.text ?? '', item.candidate, item.reason, item.status]),
), '', '### 重复、来源和品牌名称问题', '')

for (const item of V6_LANGUAGE_REVIEW_QUEUE) {
  lines.push(`- **${item.itemId}**（${item.lessonId}）：${item.issue} 建议：${item.suggestedText} [${item.confidence}; HUMAN_REVIEW_REQUIRED]`)
}

lines.push('', '#### 来源未知条目', '', sourceUnknownText, '', '### 风险分布', '', '风险表示审核优先级，不代表批准状态。所有内容仍须正式审核。')

const allReviewIds = new Set(CANTONESE_V2_SOURCE_REVIEW.map((item) => item.itemId))
const highRiskIds = new Set<string>([
  ...unknownSources.map((item) => item.itemId),
  ...CANTONESE_V2_ANSWER_REVIEW_QUEUE.map((item) => item.questionId),
  ...CANTONESE_V2_JYUTPING_AMBIGUOUS.map((item) => item.itemId),
  ...V6_LANGUAGE_REVIEW_QUEUE.map((item) => item.itemId),
])
const mediumRiskIds = new Set<string>([
  ...V6_JYUTPING_CANDIDATES.map((item) => item.contentId),
  ...CANTONESE_V2_SHALLOW_EXPLANATION_QUEUE.map((item) => item.questionId),
  ...CANTONESE_V2_FOUNDATION.tones.map((item) => item.contentId),
  CANTONESE_V2_FOUNDATION.phrase.contentId,
  ...CANTONESE_V2_FOUNDATION.questions.map((item) => item.id),
])
for (const id of highRiskIds) mediumRiskIds.delete(id)
const riskCounts = {
  HIGH: [...highRiskIds].filter((id) => allReviewIds.has(id)).length,
  MEDIUM: [...mediumRiskIds].filter((id) => allReviewIds.has(id)).length,
  LOW: [...allReviewIds].filter((id) => !highRiskIds.has(id) && !mediumRiskIds.has(id)).length,
}
lines.push(table(['HIGH RISK', 'REVIEW', 'LOW RISK'], [[riskCounts.HIGH, riskCounts.MEDIUM, riskCounts.LOW]]), '', '## Course Question Summary', '', `QUESTION_TOTAL=${candidateQuestionTotal}; ` + questionTypes.map((type) => `${type}=${questionTypeCounts[type]}`).join('; ') + '.', '')

lines.push('## Foundation · 发音基础', '', `- ID：${CANTONESE_V2_FOUNDATION.id}；顺序：业务 Lesson 之前；状态：${CANTONESE_V2_FOUNDATION.status}。`, '- 规划：建议作为 Lesson 01 前置发音基础，不占用 Lesson 编号。', '- 契约限制：当前 Server prerequisite 只接受前一业务 lesson；为避免改 schema，lesson-01 的 Server prerequisite 保持 null。Foundation 完成门禁尚未被 Server 契约表达。', `- Mobile 当前功能名：${CANTONESE_V2_FOUNDATION.currentMobileProductName}；正式名称：${CANTONESE_V2_FOUNDATION.canonicalProductName}。名称差异待人工确认，不修改 Mobile。`, '', '### 九个声调示例', '', table(
  ['字', '粤拼候选', '声调类别', 'AUDIO_ID', 'STATUS'],
  CANTONESE_V2_FOUNDATION.tones.map((item) => [item.character, item.jyutpingCandidate, `${item.tone} · ${item.category}`, item.audioId, item.status]),
), '', `- Foundation 示例短句：${CANTONESE_V2_FOUNDATION.phrase.text}；粤拼候选：${CANTONESE_V2_FOUNDATION.phrase.jyutpingCandidate}；音频 ID：${CANTONESE_V2_FOUNDATION.phrase.audioId}；状态：${CANTONESE_V2_FOUNDATION.phrase.status}。`, '- 现有 Foundation 共 16 步，最后 3 步为测验；第三题需要真实音频，目前 BLOCKED_BY_AUDIO。', '', '### Foundation 测验候选', '')

for (const question of CANTONESE_V2_FOUNDATION.questions) {
  lines.push(`- **${question.id}**（${question.questionType}）：${question.prompt}；选项：${question.options.join(' / ')}；候选答案：${question.candidateAnswer}；${question.explanation}；${'readiness' in question ? question.readiness : 'CONTENT_REVIEW_REQUIRED'}。`)
}

lines.push('', '## Lesson 01–07', '', 'Lesson 05–07 保留原 ID；Lesson 01–04 使用新的 Server 候选 ID。每课目标、内容、问题和音频需求如下。', '')

for (const lesson of CANTONESE_V2_LESSONS) {
  const pack = V6_COURSE_PACKS.find((item) => item.definition.lessonId === lesson.lessonId)!
  const content = pack.teaching.filter((item) => item.displayText)
  const grouped = ['WORD', 'PHRASE', 'GRAMMAR', 'SENTENCE', 'DIALOGUE', 'CONTRAST', 'SPEAKING_PRACTICE'] as const
  lines.push(`### Lesson ${String(lesson.order).padStart(2, '0')} · ${lesson.title}`, '', `- 教学目标：${lesson.objective}`, `- ID：${lesson.lessonId}；顺序：${lesson.order}；前置：${lesson.prerequisite}；状态：${lesson.status}`, `- 题目数：${pack.questions.length}；音频槽位：${pack.audio.length}；LISTENING：${lesson.audioRequirements.listeningQuestionIds.length}（BLOCKED_BY_AUDIO）；SPEAKING：${lesson.audioRequirements.speakingQuestionIds.length}（不评分）。`)
  for (const type of grouped) {
    const selected = content.filter((item) => item.contentType === type)
    if (!selected.length) continue
    lines.push('', `#### ${type === 'WORD' ? '词汇' : type === 'SENTENCE' || type === 'PHRASE' ? '句子 / 短语' : type === 'DIALOGUE' ? '对话' : type === 'GRAMMAR' ? '语法词项' : type === 'CONTRAST' ? '对比项' : '跟读材料'}`, '', table(
      ['粤语', '粤拼候选', '普通话释义', '状态', '来源'],
      selected.map((item) => [item.displayText ?? '', item.jyutping ?? '缺候选', item.translation, item.reviewStatus, item.sourceReference]),
    ))
  }
  lines.push('', '#### 题目', '')
  for (const question of pack.questions) {
    const issue = answerIssueById.get(question.externalId)
    const shallow = shallowById.get(question.externalId)
    lines.push(`- **${question.externalId}**（${question.questionType}）`, `  - 题干：${question.prompt}`, `  - 选项：${question.options.map((option) => `${option.id}. ${option.text}`).join('；') || '无（口语练习不评分）'}`, `  - 当前答案：${answerFor(question)}`, `  - 当前解释：${question.explanation}`, `  - 审核问题：${issue?.whyAmbiguous ?? (shallow ? `解释偏浅；建议：${shallow.suggestedExplanation}` : '常规语言、读音与题意审核。')}`, `  - 状态：${question.reviewStatus}${question.questionType === 'LISTENING' ? '；BLOCKED_BY_AUDIO' : question.questionType === 'SPEAKING' ? '；UNSCORED_NON_GRADEABLE' : ''}`)
  }
  lines.push('', '#### 音频', '', `需要 ${pack.audio.length} 个音频槽位；当前全部待文本及粤拼审核，未生成音频。`, '')
}

lines.push('## Mobile 迁移与去重', '', 'Mobile lesson-05-review 决定作为 **UNIT_REVIEW**：复用 Lesson 01–04 的题目，不创建或覆盖 Server lesson-05。', '', '### 内容 ID 映射', '', table(
  ['OLD_MOBILE_ID', 'NEW_SERVER_ID', '重叠分类', '已存在的 Server ID', '建议'],
  CANTONESE_V2_CONTENT_MAPPING.map((item) => [item.oldMobileId, item.newServerId, item.classification, item.overlappingServerIds.join(', ') || '—', item.recommendation]),
), '', 'DUPLICATE 项建议将首次教学集中在 Lesson 01；Lesson 05 对话作为情境复现保留。所有既有 Server ID 暂留，等待审核决定。拜拜仅与 Lesson 05 的告别对话部分重叠。', '', '### Mobile 音频 ID 映射', '', table(
  ['OLD_MOBILE_AUDIO_ID', 'NEW_SERVER_AUDIO_ID', 'CONTENT_ID', 'STATUS'],
  CANTONESE_V2_AUDIO_ID_MAPPING.map((item) => [item.oldMobileAudioId, item.newServerAudioId, item.contentId, item.status]),
), '', '### 36 个 Mobile Exercise 映射', '', table(
  ['OLD_MOBILE_EXERCISE_ID', 'CONTENT_IDS', 'QUESTION_IDS', 'MAPPING'],
  CANTONESE_V2_QUESTION_MAPPING.map((item) => [item.oldMobileExerciseId, item.contentIds.join(', ') || '—', item.questionIds.join(', ') || '—', item.mappingType]),
), '', 'MATCH 以逐项粤拼 / 释义选择题表达；ORDER 以现有 SINGLE_SELECT 题型表达。Lesson 05 Review 复用已有问题，不增加重复内容。', '', '## Jyutping 审核', '', `- 旧 Server 缺失项：${V6_JYUTPING_CANDIDATES.length} 条，均已写入候选字段并标记 HUMAN_REVIEW_REQUIRED。`, '- 旧 Server 已存在但未审核的粤拼：18 条；保留原值，不代表已确认。', '- 新迁入 Mobile 01–04 的 18 个知识项已有本地粤拼，但仍是未审核候选。', '- Foundation 9 个声调粤拼和 1 个整句粤拼均待审核。', '- 候选按粤语文本逐项填写，不从普通话释义或英文生成；不能视作已审核读音。', '', table(
  ['ITEM_ID', 'LESSON', '粤语文本', 'JYUTPING_CANDIDATE', 'CONFIDENCE', 'STATUS'],
  V6_JYUTPING_CANDIDATES.map((item) => {
    const source = V6_COURSE_PACKS.flatMap((pack) => pack.teaching).find((row) => row.externalId === item.contentId)
    return [item.contentId, source?.lessonId ?? '', source?.displayText ?? '', item.candidate, item.confidence, item.status]
  }),
), '', '### 全部 18 条已有粤拼（仍未审核）', '')

const existingJyutping = V6_COURSE_PACKS.filter((pack) => ['lesson-05', 'lesson-06', 'lesson-07'].includes(pack.definition.lessonId))
  .flatMap((pack) => pack.teaching.filter((item) => item.displayText && item.jyutping && !readingById.has(item.externalId)))
lines.push(table(['ITEM_ID', 'LESSON', 'TEXT', 'CURRENT_JYUTPING', 'STATUS'], existingJyutping.map((item) => [item.externalId, item.lessonId, item.displayText ?? '', item.jyutping ?? '', item.jyutpingReviewStatus])))

lines.push('', '## 4 个答案审核项', '', table(
  ['QUESTION_ID', 'LESSON', 'PROMPT', 'OPTIONS', 'CURRENT_ANSWER', 'WHY_AMBIGUOUS', 'RECOMMENDED_FIX'],
  CANTONESE_V2_ANSWER_REVIEW_QUEUE.map((item) => [item.questionId, item.lessonId, item.prompt, item.options.join(' / '), item.currentAnswer.join(' / '), item.whyAmbiguous, item.recommendedFix]),
), '', '当前答案保留原样，没有自动修正。', '', '## 7 个解释偏浅项', '', table(
  ['QUESTION_ID', 'CURRENT_EXPLANATION', 'SUGGESTED_EXPLANATION', 'STATUS'],
  CANTONESE_V2_SHALLOW_EXPLANATION_QUEUE.map((item) => [item.questionId, item.currentExplanation, item.suggestedExplanation, item.status]),
), '', '## Audio Manifest', '', `总槽位：${CANTONESE_AUDIO_MANIFEST.length}；真实音频：0；待文本审核：${CANTONESE_AUDIO_MANIFEST.filter((item) => item.status === 'PENDING_TEXT_APPROVAL').length}；待粤拼审核：${CANTONESE_AUDIO_MANIFEST.filter((item) => item.jyutpingStatus === 'PENDING_JYUTPING_APPROVAL').length}。所有 Listening 题均 BLOCKED_BY_AUDIO。`, '', table(
  ['audioId', 'lessonId', 'contentId', 'text', 'jyutping', 'type', 'voiceRequirement', 'status'],
  CANTONESE_AUDIO_MANIFEST.map((item) => [item.audioId, item.lessonId, item.contentId, item.text, item.jyutping, item.type, item.voiceRequirement, item.status]),
), '', '## Source Review', '', `SOURCE_DOCUMENTED=${sourceCounts.SOURCE_DOCUMENTED}; SOURCE_UNKNOWN=${sourceCounts.SOURCE_UNKNOWN}; ORIGINAL_ECFC_CONTENT=${sourceCounts.ORIGINAL_ECFC_CONTENT}.`, '有外部词典来源的记录仍须版权 / 授权核查；来源未知的项目不作版权安全声明。', '', '## DISPLAY_TEXT / EXAMPLE_SENTENCE', '', `DISPLAY_TEXT=${displayRows.length}; EXAMPLE_SENTENCE=0。旧 pack 中重复显示文本的 98 个 examples 已停止作为例句输出；本轮没有新增例句。`, '内容空缺：独立的、经过审核的情境例句仍未提供。已有对话保持 DIALOGUE 类型，不重复计入 example 字段。', '', '## Script Policy', '', '界面说明和普通话释义可用简体中文；粤语目标词句保留实际书写形式，不做机械繁简转换。逐项文字和读音仍由人工审核。', '', '## Runtime / Review Readiness', '', '- Course / lesson detail / question payload：沿用 `V6CoursePackSeedPayload`，以 `lessonId` 单课读取；Lesson 01–07 顺序连续。', '- Answer：使用既有受支持类型；公开 Course API 已移除 `correctAnswer`，答题由现有受保护 answer endpoint 处理。', '- Progress / mistake / review：候选使用稳定 lesson/question/content IDs；Speaking 维持不评分，不进入错题或复习。', '- Audio：现有 manifest ID 结构保留；无真实音频时 Listening 不能进入可学习题集。', '- Schema / Migration：未改 Prisma schema 或 migration；需要人工批准及后续独立发布流程。', '', '## Change Notes', '', '- `LANGUAGE_TEXT_MODIFIED=NONE`。候选 01–04 的目标文字来自现有 Mobile 草稿；对 Foundation 名称只记录了审核建议，没有直接改原词。', '- `EXAMPLE_SENTENCE_COUNT=0`。', '- `SERVER_APPROVED_COURSES=0`；此候选不会自动改变该状态。', '', '---', '', '本审核文件由 `scripts/generate-cantonese-v2-human-review.ts` 从隔离候选 pack 生成。', '',
)

const output = resolve(process.cwd(), 'docs/cantonese-v2-human-review.md')
writeFileSync(output, `${lines.join('\n').replace(/\n+$/, '')}\n`, 'utf8')
process.stdout.write(`Generated ${output}\n`)
