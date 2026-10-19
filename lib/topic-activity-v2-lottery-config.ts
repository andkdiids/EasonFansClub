import { parseActivityDateInput } from '@/lib/activity'
import { publicImageUrl } from '@/lib/images'
import { storedActivityImageUrl } from '@/lib/activity-image-url'
import type { TopicActivityV2Program } from '@/lib/topic-activity-v2-config'

export type TopicLotteryPrizeConfig = { id: string; name: string; description: string; imageUrl: string | null; quantity: number; sortOrder: number }
export type TopicLotteryConfig = {
  version: 1; enabled: boolean; title: string; description: string; mode: 'AUTO' | 'MANUAL';
  drawAt: string | null; eligibilityDeadline: string | null; addressDeadline: string | null;
  publishWinners: boolean; retentionDays: number; sourceEntryIds: string[]; prizes: TopicLotteryPrizeConfig[];
}
export class TopicLotteryError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) { super(message); this.name = 'TopicLotteryError' }
}
export function topicLotterySourceRulesLocked(input: Readonly<{
  state: string
  hasFairnessLock: boolean
  hasSourceEvidence: boolean
  hasEligibility: boolean
  hasLotteryEntry: boolean
  hasDrawSnapshot: boolean
}>) {
  return input.state === 'DRAWN' || input.hasFairnessLock || input.hasSourceEvidence
    || input.hasEligibility || input.hasLotteryEntry || input.hasDrawSnapshot
}
export function assertTopicLotterySourceProgramRulesUnchanged(previous: TopicActivityV2Program, next: TopicActivityV2Program, sourceEntryIds: readonly string[]) {
  const rules = (program: TopicActivityV2Program) => ({
    enabled: program.enabled && program.platformRewards.enabled,
    sources: sourceEntryIds.map((entryId) => {
      const entry = program.entries.find((item) => item.id === entryId)
      return entry ? { id: entry.id, platformKey: entry.platformKey, enabled: entry.enabled, minImages: entry.minImages,
        maxImages: entry.maxImages, startsAt: entry.startsAt, endsAt: entry.endsAt, allowResubmit: entry.allowResubmit } : null
    }),
  })
  if (JSON.stringify(rules(previous)) !== JSON.stringify(rules(next))) {
    throw new TopicLotteryError('LOTTERY_SOURCE_RULES_LOCKED', '已有截图参与，不能更改抽奖来源、截图要求或关闭资格入口')
  }
}
export const defaultTopicLotteryConfig = (): TopicLotteryConfig => ({ version: 1, enabled: false, title: '幸运抽奖', description: '', mode: 'MANUAL',
  drawAt: null, eligibilityDeadline: null, addressDeadline: null, publishWinners: false, retentionDays: 90, sourceEntryIds: [], prizes: [] })
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
function invalid(message: string): never { throw new TopicLotteryError('LOTTERY_CONFIG_INVALID', message, 400) }
function text(value: unknown, fallback: string, maximum: number) {
  if (value === undefined) return fallback
  if (typeof value !== 'string' || value.length > maximum) invalid('文字长度或格式无效')
  return value.trim()
}
function flag(value: unknown, fallback: boolean) {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') invalid('开关格式无效')
  return value
}
function integer(value: unknown, fallback: number, minimum: number, maximum: number) {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) invalid('数量或排序超出有效范围')
  return value
}
function date(value: unknown) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string') invalid('时间格式无效')
  const parsed = parseActivityDateInput(value)
  if (!parsed || !Number.isFinite(parsed.getTime())) invalid('时间格式无效')
  return parsed.toISOString()
}
function stableId(value: unknown) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,95}$/u.test(value)) invalid('奖品或入口编号无效')
  return value
}
export function normalizeTopicLotteryPrizeImageReference(value: unknown) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 2048 || /[?#\\\x00]/u.test(value)) invalid('请选择公开奖品图片，不得使用私人凭证或签名链接')

  // The existing upload endpoint returns a permanent public media URL. Store
  // its stable COS object path instead of the host-specific URL so the same
  // reference can be resolved for admin and anonymous public views.
  const storedActivityUrl = storedActivityImageUrl(value)
  if (storedActivityUrl) {
    const parsed = new URL(storedActivityUrl)
    if (parsed.search || parsed.hash) invalid('奖品图片不得使用带参数的临时链接')
    return `/cos${parsed.pathname}`
  }

  let decoded: string
  try { decoded = decodeURIComponent(value) } catch { return invalid('图片路径无效') }
  if (decoded.includes('..') || /[?#\\\x00]/u.test(decoded)) invalid('图片路径无效')
  if (!/^\/(?:images|uploads)\/[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|gif)$/iu.test(decoded)
    && !/^\/(?:cos|cos-files|media)\/(?:content|uploads|site-media|activities|images)\/[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|gif)$/iu.test(decoded)) invalid('请选择项目公开图片')
  return value
}

export function topicLotteryPrizeImageReferenceForRead(value: unknown) {
  try { return normalizeTopicLotteryPrizeImageReference(value) } catch { return null }
}

export function resolveTopicLotteryPrizeImageSrc(value: unknown) {
  const reference = topicLotteryPrizeImageReferenceForRead(value)
  return reference ? publicImageUrl(reference) : null
}

export function normalizeTopicLotteryConfigForRead(value: unknown): TopicLotteryConfig {
  const input = record(value)
  if (!Array.isArray(input.prizes)) return normalizeTopicLotteryConfig(value)
  const prizes = input.prizes.map((prize) => {
    if (!prize || typeof prize !== 'object' || Array.isArray(prize)) return prize
    const row = prize as Record<string, unknown>
    return { ...row, imageUrl: topicLotteryPrizeImageReferenceForRead(row.imageUrl) }
  })
  return normalizeTopicLotteryConfig({ ...input, prizes })
}
export function normalizeTopicLotteryConfig(value: unknown): TopicLotteryConfig {
  const input = record(value), defaults = defaultTopicLotteryConfig()
  if (input.version !== undefined && input.version !== 1) invalid('抽奖配置版本不受支持')
  const mode = input.mode ?? defaults.mode
  if (mode !== 'AUTO' && mode !== 'MANUAL') invalid('开奖方式无效')
  if (input.sourceEntryIds !== undefined && !Array.isArray(input.sourceEntryIds)) invalid('资格来源格式无效')
  const sourceEntryIds = ((input.sourceEntryIds ?? []) as unknown[]).map(stableId)
  if (sourceEntryIds.length > 100 || new Set(sourceEntryIds).size !== sourceEntryIds.length) invalid('资格来源重复或过多')
  if (input.prizes !== undefined && !Array.isArray(input.prizes)) invalid('奖品格式无效')
  const prizes = ((input.prizes ?? []) as unknown[]).map((value, index) => {
    const row = record(value)
    return { id: stableId(row.id), name: text(row.name, '', 200), description: text(row.description, '', 2000), imageUrl: normalizeTopicLotteryPrizeImageReference(row.imageUrl),
      quantity: integer(row.quantity, 1, 1, 1000), sortOrder: integer(row.sortOrder, index, 0, 10_000) }
  })
  if (prizes.length > 100 || new Set(prizes.map((item) => item.id)).size !== prizes.length) invalid('奖品重复或过多')
  if (prizes.reduce((sum, item) => sum + item.quantity, 0) > 1000) invalid('单次抽奖最多配置 1000 件奖品')
  const config: TopicLotteryConfig = { version: 1, enabled: flag(input.enabled, false), title: text(input.title, defaults.title, 200), description: text(input.description, '', 8000), mode,
    drawAt: date(input.drawAt), eligibilityDeadline: date(input.eligibilityDeadline), addressDeadline: date(input.addressDeadline),
    publishWinners: flag(input.publishWinners, false), retentionDays: integer(input.retentionDays, 90, 1, 365), sourceEntryIds, prizes }
  if (config.enabled) {
    if (!config.title || !sourceEntryIds.length || !prizes.length || prizes.some((prize) => !prize.name)) invalid('请填写标题、资格来源和完整奖品')
    if (!config.drawAt || !config.eligibilityDeadline || !config.addressDeadline) invalid('请设置资格截止、开奖和收件截止时间')
    if (config.eligibilityDeadline > config.drawAt || config.addressDeadline <= config.drawAt) invalid('资格截止不得晚于开奖，收件截止必须晚于开奖')
  }
  return config
}

/**
 * Existing entrants lock eligibility and the stock of prizes already in the
 * pool, but not their presentation or the addition of new prize slots.
 * Once a draw snapshot exists, the complete config is immutable so winner
 * views cannot drift from the persisted draw snapshot.
 */
export function assertTopicLotteryConfigUpdateAllowed(
  current: TopicLotteryConfig,
  next: TopicLotteryConfig,
  locks: Readonly<{ participantsLocked: boolean; drawFrozen: boolean }>,
) {
  const reject = (code: string, message: string): never => { throw new TopicLotteryError(code, message) }
  if (locks.drawFrozen) {
    if (JSON.stringify(current) !== JSON.stringify(next)) reject('LOTTERY_DRAW_FROZEN', '开奖名单与奖品快照已冻结，不能再修改抽奖配置')
    return
  }
  if (!locks.participantsLocked) return

  const rules = (config: TopicLotteryConfig) => ({
    enabled: config.enabled,
    mode: config.mode,
    drawAt: config.drawAt,
    eligibilityDeadline: config.eligibilityDeadline,
    addressDeadline: config.addressDeadline,
    retentionDays: config.retentionDays,
    sourceEntryIds: config.sourceEntryIds,
  })
  if (JSON.stringify(rules(current)) !== JSON.stringify(rules(next))) {
    reject('LOTTERY_RULES_LOCKED', '已有参与资格，不能修改资格来源、开奖规则或个人资料保留期限')
  }

  const nextById = new Map(next.prizes.map((prize) => [prize.id, prize]))
  const currentById = new Map(current.prizes.map((prize) => [prize.id, prize]))
  const highestExistingSortOrder = current.prizes.reduce((highest, prize) => Math.max(highest, prize.sortOrder), -1)
  for (const prize of current.prizes) {
    const updated = nextById.get(prize.id)
    if (!updated) throw new TopicLotteryError('LOTTERY_RULES_LOCKED', '已有参与资格后不能移除已在奖池中的奖品')
    if (updated.quantity !== prize.quantity || updated.sortOrder !== prize.sortOrder) {
      reject('LOTTERY_RULES_LOCKED', '已有奖品的数量与顺序已锁定；可编辑展示信息或增加新奖品')
    }
  }
  for (const prize of next.prizes) {
    if (!currentById.has(prize.id) && prize.sortOrder <= highestExistingSortOrder) {
      reject('LOTTERY_RULES_LOCKED', '新增奖品必须排在现有奖品之后')
    }
  }
}
