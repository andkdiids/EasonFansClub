/**
 * Versioned configuration for the configurable topic-activity modules.
 *
 * This module deliberately contains no Prisma or request-layer code.  The
 * value stored on Activity.topicProgram is untrusted JSON, so all consumers
 * should pass it through normalizeTopicActivityV2Program/readTopicActivityV2Program
 * before using it.  Times are returned as ISO instants; timezone-less input
 * is interpreted as Asia/Shanghai, matching the rest of the activity admin.
 */

import { parseActivityDateInput } from '@/lib/activity'

const MAX_TEXT_LENGTH = 20_000
const MAX_TITLE_LENGTH = 512
const MAX_DESCRIPTION_LENGTH = 8_000
const MAX_LIST_SIZE = 100
const MAX_OPTIONS = 50
const MAX_IMAGES = 20
const MAX_POINTS = 2_000_000_000
const MAX_POSTER_EDGE = 4_096

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/
const ASIA_SHANGHAI_TIMEZONE = 'Asia/Shanghai'

export type TopicActivityV2Condition = 'APPROVED_COMMENT' | 'POLL' | 'TEST' | 'ADMIN_REVIEW'
export type TopicActivityV2MedalTrigger = 'PLATFORM' | 'APPROVED_COMMENT' | 'POLL' | 'TEST'
export type TopicActivityV2PollMode = 'SINGLE' | 'MULTI'
export type TopicActivityV2TestMode = 'KNOWLEDGE' | 'PERSONALITY'

export type TopicRewardEntryConfig = {
  id: string
  platformKey: string
  platformName: string
  title: string
  instructions: string
  materialRequirement: string
  minImages: number
  maxImages: number
  points: number
  enabled: boolean
  sortOrder: number
  startsAt: string | null
  endsAt: string | null
  allowResubmit: boolean
}

export type TopicActivityV2PlatformRewards = {
  enabled: boolean
  allowStacking: boolean
  maxPlatforms: number | null
  maxEntries: number | null
}

export type TopicActivityV2FixedReward = {
  enabled: boolean
  type: 'POINTS'
  points: number
  description: string
  condition: TopicActivityV2Condition
  requiresReview: boolean
  startsAt: string | null
  endsAt: string | null
}

export type TopicActivityV2Medal = {
  enabled: boolean
  badgeId: string | null
  description: string
  triggers: TopicActivityV2MedalTrigger[]
  allowLateReview: boolean
}

export type TopicActivityV2PollOption = {
  id: string
  label: string
}

export type TopicActivityV2Poll = {
  enabled: boolean
  id: string
  version: number
  title: string
  description: string
  mode: TopicActivityV2PollMode
  maxChoices: number
  options: TopicActivityV2PollOption[]
  startsAt: string | null
  endsAt: string | null
  allowChange: boolean
  showLiveResults: boolean
  publishAfterClose: boolean
}

export type TopicActivityV2TestOption = {
  id: string
  label: string
  weights?: Record<string, number>
}

export type TopicActivityV2TestQuestion = {
  id: string
  prompt: string
  points: number
  options: TopicActivityV2TestOption[]
  correctOptionId?: string
}

export type TopicActivityV2TestResult = {
  id: string
  title: string
  description: string
  imageUrl?: string
  scoreMin?: number
  scoreMax?: number
}

export type TopicActivityV2Poster = {
  width: number
  height: number
  backgroundUrl: string | null
  showNickname: boolean
  showQrCode: boolean
}

export type TopicActivityV2Test = {
  enabled: boolean
  id: string
  version: number
  title: string
  description: string
  mode: TopicActivityV2TestMode
  allowRetake: boolean
  questions: TopicActivityV2TestQuestion[]
  results: TopicActivityV2TestResult[]
  poster: TopicActivityV2Poster
}

export type TopicActivityV2Program = {
  version: 2
  enabled: boolean
  discussionEnabled: boolean
  showRules: boolean
  showRewards: boolean
  materials: string
  platformRewards: TopicActivityV2PlatformRewards
  fixedReward: TopicActivityV2FixedReward
  medal: TopicActivityV2Medal
  entries: TopicRewardEntryConfig[]
  poll: TopicActivityV2Poll
  test: TopicActivityV2Test
}

export type TopicActivityV2PublicTestOption = Omit<TopicActivityV2TestOption, 'weights'>
export type TopicActivityV2PublicTestQuestion = Omit<TopicActivityV2TestQuestion, 'correctOptionId' | 'options'> & {
  options: TopicActivityV2PublicTestOption[]
}
export type TopicActivityV2PublicTest = Omit<TopicActivityV2Test, 'questions'> & {
  questions: TopicActivityV2PublicTestQuestion[]
}

/** The shared result poster has one fixed output size across preview, PNG and share. */
export const TOPIC_ACTIVITY_V2_POSTER_SIZE = Object.freeze({ width: 1080, height: 1440 })
export type TopicActivityV2PublicProgram = Omit<TopicActivityV2Program, 'test'> & {
  test: TopicActivityV2PublicTest
}

export type TopicActivityV2Normalization =
  | { valid: true; value: TopicActivityV2Program }
  | { valid: false; message: string }

export const DEFAULT_TOPIC_ACTIVITY_V2_PROGRAM: TopicActivityV2Program = Object.freeze({
  version: 2,
  enabled: false,
  discussionEnabled: true,
  showRules: true,
  showRewards: true,
  materials: '',
  platformRewards: {
    enabled: false,
    allowStacking: false,
    maxPlatforms: null,
    maxEntries: null,
  },
  fixedReward: {
    enabled: false,
    type: 'POINTS',
    points: 0,
    description: '',
    condition: 'APPROVED_COMMENT',
    requiresReview: true,
    startsAt: null,
    endsAt: null,
  },
  medal: {
    enabled: false,
    badgeId: null,
    description: '',
    triggers: [],
    allowLateReview: true,
  },
  entries: [],
  poll: {
    enabled: false,
    id: 'poll-v2',
    version: 1,
    title: '',
    description: '',
    mode: 'SINGLE',
    maxChoices: 1,
    options: [],
    startsAt: null,
    endsAt: null,
    allowChange: false,
    showLiveResults: false,
    publishAfterClose: false,
  },
  test: {
    enabled: false,
    id: 'test-v2',
    version: 1,
    title: '',
    description: '',
    mode: 'KNOWLEDGE',
    allowRetake: false,
    questions: [],
    results: [],
    poster: {
      width: TOPIC_ACTIVITY_V2_POSTER_SIZE.width,
      height: TOPIC_ACTIVITY_V2_POSTER_SIZE.height,
      backgroundUrl: null,
      showNickname: false,
      showQrCode: false,
    },
  },
}) as TopicActivityV2Program

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

/** Prefer the new shared poster background; read the first old result image for legacy activities. */
export function topicActivityV2PosterBackground(testValue: unknown): string | null {
  const test = record(testValue)
  const poster = record(test?.poster)
  const shared = typeof poster?.backgroundUrl === 'string' ? poster.backgroundUrl.trim() : ''
  if (shared) return shared
  if (!Array.isArray(test?.results)) return null
  for (const value of test.results) {
    const imageUrl = record(value)?.imageUrl
    if (typeof imageUrl === 'string' && imageUrl.trim()) return imageUrl.trim()
  }
  return null
}

function has(input: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(input, key)
}

function text(input: Record<string, unknown>, key: string, fallback: string, maxLength: number, required = false): string | null {
  const raw = has(input, key) ? input[key] : fallback
  if (typeof raw !== 'string') return required ? null : fallback
  const value = raw.trim()
  if (value.length > maxLength || (required && value.length === 0)) return null
  return value
}

function requiredText(input: Record<string, unknown>, key: string, maxLength: number): string | null {
  return text(input, key, '', maxLength, true)
}

function bool(input: Record<string, unknown>, key: string, fallback: boolean): boolean | null {
  const raw = has(input, key) ? input[key] : fallback
  return typeof raw === 'boolean' ? raw : null
}

function integer(input: Record<string, unknown>, key: string, fallback: number, min: number, max: number): number | null {
  const raw = has(input, key) ? input[key] : fallback
  const value = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() ? Number(raw) : Number.NaN
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null
}

function nullableInteger(input: Record<string, unknown>, key: string, fallback: number | null, min: number, max: number): number | null | undefined {
  if (!has(input, key) || input[key] === null || input[key] === '') return fallback
  const value = typeof input[key] === 'number' ? input[key] : typeof input[key] === 'string' ? Number(input[key]) : Number.NaN
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : undefined
}

function identifier(value: unknown, field: string): string | null {
  void field
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return ID_PATTERN.test(normalized) ? normalized : null
}

function safeAssetPath(value: string): boolean {
  let decoded: string
  try { decoded = decodeURIComponent(value) } catch { return false }
  if (decoded.includes('..') || /[\\?#\x00]/u.test(decoded)) return false
  return /^\/(?:images|uploads)\/[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|gif)$/iu.test(decoded)
    || /^\/(?:cos|cos-files|media)\/(?:content|uploads|site-media|badges|activities|hero|banners|avatars|images)\/[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|gif)$/iu.test(decoded)
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length
}

function normalizeDate(value: unknown, field: string): string | null | undefined {
  void field
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 64) return undefined
  const normalized = value.trim()
  if (!normalized) return null

  // A timezone-less admin datetime is Beijing time.  Do not rely on the
  // machine's local timezone for values containing seconds; explicitly apply
  // +08:00 and reject calendar rollovers such as 2026-02-31.
  const local = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(normalized)
  let parsed: Date | null
  if (local) {
    const year = Number(local[1])
    const month = Number(local[2])
    const day = Number(local[3])
    const hour = Number(local[4])
    const minute = Number(local[5])
    const second = Number(local[6] ?? 0)
    const millisecond = Number((local[7] ?? '').padEnd(3, '0') || 0)
    const timestamp = Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - (8 * 60 * 60 * 1_000)
    const localCheck = new Date(timestamp + (8 * 60 * 60 * 1_000))
    if (localCheck.getUTCFullYear() !== year || localCheck.getUTCMonth() !== month - 1 || localCheck.getUTCDate() !== day || localCheck.getUTCHours() !== hour || localCheck.getUTCMinutes() !== minute || localCheck.getUTCSeconds() !== second || localCheck.getUTCMilliseconds() !== millisecond) return undefined
    parsed = new Date(timestamp)
  } else {
    // Explicit offsets are accepted; date-only and timezone-less non-standard
    // strings are intentionally rejected to keep the timezone contract clear.
    if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized)) return undefined
    parsed = parseActivityDateInput(normalized)
  }
  if (!parsed || Number.isNaN(parsed.getTime())) return undefined
  return parsed.toISOString()
}

function range(start: string | null, end: string | null, field: string): string | null {
  if (start && end && Date.parse(start) > Date.parse(end)) return `${field}开始时间不能晚于结束时间`
  return null
}

function addScopedIds(ids: Set<string>, values: readonly string[], field: string): string | null {
  if (!unique(values)) return `${field}存在重复 ID`
  for (const value of values) {
    if (ids.has(value)) return `${field}中的 ID 与其他配置冲突：${value}`
    ids.add(value)
  }
  return null
}

function normalizeEntry(value: unknown, index: number, ids: Set<string>): TopicRewardEntryConfig | string {
  const input = record(value)
  if (!input) return `entries[${index}]格式不正确`
  const id = identifier(input.id, `entries[${index}].id`)
  if (!id) return `entries[${index}].id格式不正确`
  const idError = addScopedIds(ids, [id], `entries[${index}]`)
  if (idError) return idError
  const platformKey = identifier(input.platformKey, `entries[${index}].platformKey`)
  if (!platformKey || platformKey.length > 64) return `entries[${index}].platformKey格式不正确`
  const platformName = requiredText(input, 'platformName', MAX_TITLE_LENGTH)
  const title = requiredText(input, 'title', MAX_TITLE_LENGTH)
  const instructions = requiredText(input, 'instructions', MAX_DESCRIPTION_LENGTH)
  const materialRequirement = text(input, 'materialRequirement', '', MAX_DESCRIPTION_LENGTH)
  if (!platformName || !title || !instructions || materialRequirement === null) return `entries[${index}]文本字段不完整`
  const minImages = integer(input, 'minImages', 0, 0, MAX_IMAGES)
  const maxImages = integer(input, 'maxImages', 0, 0, MAX_IMAGES)
  const points = integer(input, 'points', 0, 0, MAX_POINTS)
  const enabled = bool(input, 'enabled', true)
  const sortOrder = integer(input, 'sortOrder', index, 0, 1_000_000)
  const allowResubmit = bool(input, 'allowResubmit', false)
  if (minImages === null || maxImages === null || points === null || enabled === null || sortOrder === null || allowResubmit === null) return `entries[${index}]数值或开关格式不正确`
  if (minImages > maxImages) return `entries[${index}]最少图片数不能大于最多图片数`
  if (enabled && points < 1) return `entries[${index}]启用的奖励入口必须设置正整数挂号费`
  const startsAt = normalizeDate(input.startsAt, `entries[${index}].startsAt`)
  const endsAt = normalizeDate(input.endsAt, `entries[${index}].endsAt`)
  if (startsAt === undefined || endsAt === undefined) return `entries[${index}]时间格式不正确`
  const rangeError = range(startsAt, endsAt, `entries[${index}]`)
  if (rangeError) return rangeError
  return { id, platformKey, platformName, title, instructions, materialRequirement, minImages, maxImages, points, enabled, sortOrder, startsAt, endsAt, allowResubmit }
}

function normalizePoll(value: unknown, ids: Set<string>): TopicActivityV2Poll | string {
  const input = record(value) ?? {}
  const enabled = bool(input, 'enabled', DEFAULT_TOPIC_ACTIVITY_V2_PROGRAM.poll.enabled)
  if (enabled === null) return 'poll.enabled格式不正确'
  const id = identifier(has(input, 'id') ? input.id : DEFAULT_TOPIC_ACTIVITY_V2_PROGRAM.poll.id, 'poll.id')
  if (!id || id.length > 64) return 'poll.id格式不正确'
  const idError = addScopedIds(ids, [id], 'poll')
  if (idError) return idError
  const version = integer(input, 'version', 1, 1, 1_000_000)
  const title = text(input, 'title', '', MAX_TITLE_LENGTH)
  const description = text(input, 'description', '', MAX_DESCRIPTION_LENGTH)
  const mode = has(input, 'mode') ? input.mode : DEFAULT_TOPIC_ACTIVITY_V2_PROGRAM.poll.mode
  const maxChoices = integer(input, 'maxChoices', mode === 'MULTI' ? 2 : 1, 1, MAX_OPTIONS)
  if (version === null || title === null || description === null || maxChoices === null || (mode !== 'SINGLE' && mode !== 'MULTI')) return 'poll字段格式不正确'
  const rawOptions = has(input, 'options') ? input.options : []
  if (!Array.isArray(rawOptions) || rawOptions.length > MAX_OPTIONS) return 'poll.options数量不正确'
  const options: TopicActivityV2PollOption[] = []
  const optionIds: string[] = []
  for (let index = 0; index < rawOptions.length; index += 1) {
    const option = record(rawOptions[index])
    if (!option) return `poll.options[${index}]格式不正确`
    const optionId = identifier(option.id, `poll.options[${index}].id`)
    const label = requiredText(option, 'label', MAX_TITLE_LENGTH)
    if (!optionId || !label) return `poll.options[${index}]字段不完整`
    optionIds.push(optionId)
    options.push({ id: optionId, label })
  }
  if (!unique(optionIds)) return 'poll.options存在重复 ID'
  const localOptionError = addScopedIds(ids, optionIds, 'poll.options')
  if (localOptionError) return localOptionError
  if (enabled && options.length < 2) return '启用投票至少需要两个选项'
  if (mode === 'SINGLE' && maxChoices !== 1) return '单选投票的maxChoices必须为1'
  if (mode === 'MULTI' && maxChoices < 2) return '多选投票的maxChoices至少为2'
  if (options.length > 0 && maxChoices > options.length) return 'poll.maxChoices不能超过选项数量'
  const startsAt = normalizeDate(input.startsAt, 'poll.startsAt')
  const endsAt = normalizeDate(input.endsAt, 'poll.endsAt')
  if (startsAt === undefined || endsAt === undefined) return 'poll时间格式不正确'
  const rangeError = range(startsAt, endsAt, 'poll')
  if (rangeError) return rangeError
  const allowChange = bool(input, 'allowChange', false)
  const showLiveResults = bool(input, 'showLiveResults', false)
  const publishAfterClose = bool(input, 'publishAfterClose', false)
  if (allowChange === null || showLiveResults === null || publishAfterClose === null) return 'poll开关格式不正确'
  return { enabled, id, version, title, description, mode, maxChoices, options, startsAt, endsAt, allowChange, showLiveResults, publishAfterClose }
}

function normalizeWeights(value: unknown, resultIds: ReadonlySet<string>, field: string): Record<string, number> | string {
  const input = record(value)
  if (!input) return `${field}必须是对象`
  const output: Record<string, number> = {}
  for (const [resultId, rawWeight] of Object.entries(input)) {
    if (!resultIds.has(resultId)) return `${field}引用不存在的结果：${resultId}`
    const weight = typeof rawWeight === 'number' ? rawWeight : typeof rawWeight === 'string' ? Number(rawWeight) : Number.NaN
    if (!Number.isFinite(weight) || weight < 0 || weight > MAX_POINTS) return `${field}.${resultId}权重不正确`
    output[resultId] = weight
  }
  if (Object.keys(output).length === 0) return `${field}至少需要一个结果权重`
  return output
}

function normalizeTest(value: unknown, ids: Set<string>): TopicActivityV2Test | string {
  const input = record(value) ?? {}
  const enabled = bool(input, 'enabled', DEFAULT_TOPIC_ACTIVITY_V2_PROGRAM.test.enabled)
  if (enabled === null) return 'test.enabled格式不正确'
  const id = identifier(has(input, 'id') ? input.id : DEFAULT_TOPIC_ACTIVITY_V2_PROGRAM.test.id, 'test.id')
  if (!id || id.length > 64) return 'test.id格式不正确'
  const idError = addScopedIds(ids, [id], 'test')
  if (idError) return idError
  const version = integer(input, 'version', 1, 1, 1_000_000)
  const title = text(input, 'title', '', MAX_TITLE_LENGTH)
  const description = text(input, 'description', '', MAX_DESCRIPTION_LENGTH)
  const mode = has(input, 'mode') ? input.mode : DEFAULT_TOPIC_ACTIVITY_V2_PROGRAM.test.mode
  const allowRetake = bool(input, 'allowRetake', false)
  if (version === null || title === null || description === null || allowRetake === null || (mode !== 'KNOWLEDGE' && mode !== 'PERSONALITY')) return 'test字段格式不正确'

  const rawResults = has(input, 'results') ? input.results : []
  if (!Array.isArray(rawResults) || rawResults.length > MAX_LIST_SIZE) return 'test.results数量不正确'
  const results: TopicActivityV2TestResult[] = []
  const resultIds: string[] = []
  for (let index = 0; index < rawResults.length; index += 1) {
    const result = record(rawResults[index])
    if (!result) return `test.results[${index}]格式不正确`
    const resultId = identifier(result.id, `test.results[${index}].id`)
    const resultTitle = requiredText(result, 'title', MAX_TITLE_LENGTH)
    const resultDescription = requiredText(result, 'description', MAX_DESCRIPTION_LENGTH)
    if (!resultId || resultId.length > 64 || !resultTitle || !resultDescription) return `test.results[${index}]字段不完整`
    const imageUrl = has(result, 'imageUrl') && result.imageUrl !== undefined && result.imageUrl !== null ? text(result, 'imageUrl', '', 2_048, true) : undefined
    if (imageUrl === null) return `test.results[${index}].imageUrl格式不正确`
    if (imageUrl && !safeAssetPath(imageUrl)) return `test.results[${index}].imageUrl只能使用同源路径`
    const scoreMin = nullableInteger(result, 'scoreMin', null, 0, MAX_POINTS)
    const scoreMax = nullableInteger(result, 'scoreMax', null, 0, MAX_POINTS)
    if (scoreMin === undefined || scoreMax === undefined) return `test.results[${index}]分数区间格式不正确`
    if (scoreMin !== null && scoreMax !== null && scoreMin > scoreMax) return `test.results[${index}]分数区间无效`
    resultIds.push(resultId)
    results.push({ id: resultId, title: resultTitle, description: resultDescription, ...(imageUrl === undefined ? {} : { imageUrl }), ...(scoreMin === null ? {} : { scoreMin }), ...(scoreMax === null ? {} : { scoreMax }) })
  }
  if (!unique(resultIds)) return 'test.results存在重复 ID'
  const resultIdError = addScopedIds(ids, resultIds, 'test.results')
  if (resultIdError) return resultIdError
  if (enabled && results.length === 0) return '启用测试至少需要一个结果'
  const resultIdSet = new Set(resultIds)

  const rawQuestions = has(input, 'questions') ? input.questions : []
  if (!Array.isArray(rawQuestions) || rawQuestions.length > MAX_LIST_SIZE) return 'test.questions数量不正确'
  const questions: TopicActivityV2TestQuestion[] = []
  const questionIds: string[] = []
  let totalPoints = 0
  for (let index = 0; index < rawQuestions.length; index += 1) {
    const question = record(rawQuestions[index])
    if (!question) return `test.questions[${index}]格式不正确`
    const questionId = identifier(question.id, `test.questions[${index}].id`)
    const prompt = requiredText(question, 'prompt', MAX_DESCRIPTION_LENGTH)
    const points = integer(question, 'points', 0, 0, MAX_POINTS)
    if (!questionId || !prompt || points === null) return `test.questions[${index}]字段不完整`
    const rawOptions = has(question, 'options') ? question.options : []
    if (!Array.isArray(rawOptions) || rawOptions.length < 2 || rawOptions.length > MAX_OPTIONS) return `test.questions[${index}].options数量不正确`
    const options: TopicActivityV2TestOption[] = []
    const optionIds: string[] = []
    for (let optionIndex = 0; optionIndex < rawOptions.length; optionIndex += 1) {
      const option = record(rawOptions[optionIndex])
      if (!option) return `test.questions[${index}].options[${optionIndex}]格式不正确`
      const optionId = identifier(option.id, `test.questions[${index}].options[${optionIndex}].id`)
      const label = requiredText(option, 'label', MAX_TITLE_LENGTH)
      if (!optionId || !label) return `test.questions[${index}].options[${optionIndex}]字段不完整`
      optionIds.push(optionId)
      const hasWeights = has(option, 'weights') && option.weights !== undefined && option.weights !== null
      if (mode === 'PERSONALITY') {
        if (!hasWeights) return `test.questions[${index}].options[${optionIndex}]缺少权重`
        const weights = normalizeWeights(option.weights, resultIdSet, `test.questions[${index}].options[${optionIndex}].weights`)
        if (typeof weights === 'string') return weights
        options.push({ id: optionId, label, weights })
      } else {
        if (hasWeights) return `KNOWLEDGE题目不允许配置权重：test.questions[${index}].options[${optionIndex}]`
        options.push({ id: optionId, label })
      }
    }
    if (!unique(optionIds)) return `test.questions[${index}]存在重复选项 ID`
    const optionIdError = addScopedIds(ids, optionIds, `test.questions[${index}].options`)
    if (optionIdError) return optionIdError
    const correctOptionId = question.correctOptionId
    if (mode === 'KNOWLEDGE') {
      if (typeof correctOptionId !== 'string' || !optionIds.includes(correctOptionId)) return `test.questions[${index}].correctOptionId无效`
      questions.push({ id: questionId, prompt, points, options, correctOptionId })
    } else {
      if (correctOptionId !== undefined && correctOptionId !== null && correctOptionId !== '') return `PERSONALITY题目不能设置标准答案：test.questions[${index}]`
      questions.push({ id: questionId, prompt, points, options })
    }
    questionIds.push(questionId)
    totalPoints += points
    if (totalPoints > MAX_POINTS) return 'test题目总分过大'
  }
  if (!unique(questionIds)) return 'test.questions存在重复 ID'
  const questionIdError = addScopedIds(ids, questionIds, 'test.questions')
  if (questionIdError) return questionIdError
  if (enabled && questions.length === 0) return '启用测试至少需要一道题目'

  if (mode === 'KNOWLEDGE' && enabled) {
    const intervals = results.map((result, index) => {
      if (result.scoreMin === undefined || result.scoreMax === undefined) return null
      return { index, min: result.scoreMin, max: result.scoreMax }
    })
    if (intervals.some((interval) => interval === null)) return 'KNOWLEDGE测试的每个结果必须配置完整分数区间'
    const sorted = intervals as { index: number; min: number; max: number }[]
    sorted.sort((left, right) => left.min - right.min || left.max - right.max)
    if (sorted.length === 0 || sorted[0].min !== 0 || sorted[sorted.length - 1].max !== totalPoints) return '测试结果分数区间必须完整覆盖0到总分'
    for (let index = 1; index < sorted.length; index += 1) {
      if (sorted[index].min !== sorted[index - 1].max + 1) return '测试结果分数区间必须连续且不可重叠'
    }
  }

  const posterInput = record(input.poster) ?? {}
  const width = integer(posterInput, 'width', DEFAULT_TOPIC_ACTIVITY_V2_PROGRAM.test.poster.width, 256, MAX_POSTER_EDGE)
  const height = integer(posterInput, 'height', DEFAULT_TOPIC_ACTIVITY_V2_PROGRAM.test.poster.height, 256, MAX_POSTER_EDGE)
  const backgroundRaw = has(posterInput, 'backgroundUrl') ? posterInput.backgroundUrl : DEFAULT_TOPIC_ACTIVITY_V2_PROGRAM.test.poster.backgroundUrl
  const backgroundUrl = backgroundRaw === null || backgroundRaw === '' ? null : text(posterInput, 'backgroundUrl', '', 2_048, true)
  const showNickname = bool(posterInput, 'showNickname', false)
  const showQrCode = bool(posterInput, 'showQrCode', false)
  if (width === null || height === null || backgroundUrl === undefined || showNickname === null || showQrCode === null) {
    if (backgroundUrl === null && backgroundRaw !== null && backgroundRaw !== '') return 'test.poster.backgroundUrl格式不正确'
    return 'test.poster格式不正确'
  }
  if (backgroundUrl && !safeAssetPath(backgroundUrl)) return 'test.poster.backgroundUrl只能使用同源路径'
  const startsAt = normalizeDate(input.startsAt, 'test.startsAt')
  const endsAt = normalizeDate(input.endsAt, 'test.endsAt')
  if (startsAt === undefined || endsAt === undefined) return 'test时间格式不正确'
  const rangeError = range(startsAt, endsAt, 'test')
  if (rangeError) return rangeError
  // Accept legacy stored dimensions for backwards compatibility, but normalize output to V5 3:4.
  return { enabled, id, version, title, description, mode, allowRetake, questions, results, poster: {
    width: TOPIC_ACTIVITY_V2_POSTER_SIZE.width, height: TOPIC_ACTIVITY_V2_POSTER_SIZE.height, backgroundUrl, showNickname, showQrCode,
  } }
}

function normalizeFixedReward(value: unknown): TopicActivityV2FixedReward | string {
  const input = record(value) ?? {}
  const enabled = bool(input, 'enabled', false)
  const type = has(input, 'type') ? input.type : 'POINTS'
  const points = integer(input, 'points', 0, 0, MAX_POINTS)
  const description = text(input, 'description', '', MAX_DESCRIPTION_LENGTH)
  const condition = has(input, 'condition') ? input.condition : 'APPROVED_COMMENT'
  const requiresReview = bool(input, 'requiresReview', true)
  if (enabled === null || type !== 'POINTS' || points === null || description === null || requiresReview === null || !['APPROVED_COMMENT', 'POLL', 'TEST', 'ADMIN_REVIEW'].includes(String(condition))) return 'fixedReward字段格式不正确'
  if (enabled && points < 1) return '启用固定奖励时积分必须为正整数'
  const startsAt = normalizeDate(input.startsAt, 'fixedReward.startsAt')
  const endsAt = normalizeDate(input.endsAt, 'fixedReward.endsAt')
  if (startsAt === undefined || endsAt === undefined) return 'fixedReward时间格式不正确'
  const rangeError = range(startsAt, endsAt, 'fixedReward')
  if (rangeError) return rangeError
  return { enabled, type: 'POINTS', points, description, condition: condition as TopicActivityV2Condition, requiresReview, startsAt, endsAt }
}

function normalizeProgram(value: unknown): TopicActivityV2Normalization {
  const input = record(value) ?? {}
  const rawVersion = has(input, 'version') ? input.version : 2
  if (rawVersion !== 2) return { valid: false, message: 'topicProgram.version必须为2' }
  const enabled = bool(input, 'enabled', false)
  const discussionEnabled = bool(input, 'discussionEnabled', true)
  const showRules = bool(input, 'showRules', true)
  const showRewards = bool(input, 'showRewards', true)
  const materials = text(input, 'materials', '', MAX_TEXT_LENGTH)
  if (enabled === null || discussionEnabled === null || showRules === null || showRewards === null || materials === null) return { valid: false, message: 'topicProgram基础字段格式不正确' }

  const platformInput = record(input.platformRewards) ?? {}
  const platformEnabled = bool(platformInput, 'enabled', false)
  const allowStacking = bool(platformInput, 'allowStacking', false)
  const maxPlatforms = nullableInteger(platformInput, 'maxPlatforms', null, 1, MAX_LIST_SIZE)
  const maxEntries = nullableInteger(platformInput, 'maxEntries', null, 1, MAX_LIST_SIZE)
  if (platformEnabled === null || allowStacking === null || maxPlatforms === undefined || maxEntries === undefined) return { valid: false, message: 'platformRewards格式不正确' }

  const fixedReward = normalizeFixedReward(input.fixedReward)
  if (typeof fixedReward === 'string') return { valid: false, message: fixedReward }
  const medalInput = record(input.medal) ?? {}
  const medalEnabled = bool(medalInput, 'enabled', false)
  const badgeIdRaw = has(medalInput, 'badgeId') ? medalInput.badgeId : null
  const badgeId = badgeIdRaw === null || badgeIdRaw === '' ? null : identifier(badgeIdRaw, 'medal.badgeId')
  const medalDescription = text(medalInput, 'description', '', MAX_DESCRIPTION_LENGTH)
  const allowLateReview = bool(medalInput, 'allowLateReview', DEFAULT_TOPIC_ACTIVITY_V2_PROGRAM.medal.allowLateReview)
  const rawTriggers = has(medalInput, 'triggers') ? medalInput.triggers : []
  if (medalEnabled === null || (badgeIdRaw !== null && badgeIdRaw !== '' && !badgeId) || medalDescription === null || allowLateReview === null || !Array.isArray(rawTriggers) || rawTriggers.length > 4) return { valid: false, message: 'medal格式不正确' }
  const triggers = rawTriggers.filter((trigger): trigger is TopicActivityV2MedalTrigger => trigger === 'PLATFORM' || trigger === 'APPROVED_COMMENT' || trigger === 'POLL' || trigger === 'TEST')
  if (triggers.length !== rawTriggers.length || !unique(triggers)) return { valid: false, message: 'medal.triggers格式不正确' }
  if (medalEnabled && (!badgeId || triggers.length === 0)) return { valid: false, message: '启用勋章时必须设置badgeId和至少一个触发条件' }

  const ids = new Set<string>()
  const rawEntries = has(input, 'entries') ? input.entries : []
  if (!Array.isArray(rawEntries) || rawEntries.length > MAX_LIST_SIZE) return { valid: false, message: 'entries数量不正确' }
  const entries: TopicRewardEntryConfig[] = []
  for (let index = 0; index < rawEntries.length; index += 1) {
    const entry = normalizeEntry(rawEntries[index], index, ids)
    if (typeof entry === 'string') return { valid: false, message: entry }
    entries.push(entry)
  }

  const poll = normalizePoll(input.poll, ids)
  if (typeof poll === 'string') return { valid: false, message: poll }
  const test = normalizeTest(input.test, ids)
  if (typeof test === 'string') return { valid: false, message: test }
  if (badgeId) {
    const badgeError = addScopedIds(ids, [badgeId], 'medal')
    if (badgeError) return { valid: false, message: badgeError }
  }
  return { valid: true, value: { version: 2, enabled, discussionEnabled, showRules, showRewards, materials, platformRewards: { enabled: platformEnabled, allowStacking, maxPlatforms, maxEntries }, fixedReward, medal: { enabled: medalEnabled, badgeId, description: medalDescription, triggers, allowLateReview }, entries, poll, test } }
}

export function createDefaultTopicActivityV2Program(): TopicActivityV2Program {
  return JSON.parse(JSON.stringify(DEFAULT_TOPIC_ACTIVITY_V2_PROGRAM)) as TopicActivityV2Program
}

export function normalizeTopicActivityV2Program(value: unknown): TopicActivityV2Normalization {
  return normalizeProgram(value)
}

export function readTopicActivityV2Program(value: unknown): TopicActivityV2Program | null {
  if (value === null || value === undefined) return null
  const result = normalizeTopicActivityV2Program(value)
  return result.valid ? result.value : null
}

export function publicTopicActivityV2Program(config: TopicActivityV2Program): TopicActivityV2PublicProgram {
  return {
    version: config.version,
    enabled: config.enabled,
    discussionEnabled: config.discussionEnabled,
    showRules: config.showRules,
    showRewards: config.showRewards,
    materials: config.materials,
    platformRewards: { ...config.platformRewards },
    fixedReward: { ...config.fixedReward },
    medal: { ...config.medal, triggers: [...config.medal.triggers] },
    entries: config.entries.map((entry) => ({ ...entry })),
    poll: { ...config.poll, options: config.poll.options.map((option) => ({ ...option })) },
    test: {
      ...config.test,
      questions: config.test.questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        points: question.points,
        options: question.options.map((option) => ({ id: option.id, label: option.label })),
      })),
      results: config.test.results.map((result) => ({ ...result })),
      poster: { ...config.test.poster },
    },
  }
}

export { ASIA_SHANGHAI_TIMEZONE }
