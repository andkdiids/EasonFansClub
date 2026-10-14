import { parseActivityDateInput } from '@/lib/activity'

export type TopicLotteryPrizeConfig = { id: string; name: string; description: string; imageUrl: string | null; quantity: number; sortOrder: number }
export type TopicLotteryConfig = {
  version: 1; enabled: boolean; title: string; description: string; mode: 'AUTO' | 'MANUAL';
  drawAt: string | null; eligibilityDeadline: string | null; addressDeadline: string | null;
  publishWinners: boolean; retentionDays: number; sourceEntryIds: string[]; prizes: TopicLotteryPrizeConfig[];
}
export class TopicLotteryError extends Error {
  constructor(readonly code: string, message: string, readonly status = 409) { super(message); this.name = 'TopicLotteryError' }
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
function image(value: unknown) {
  if (value === undefined || value === null || value === '') return null
  if (typeof value !== 'string' || value.length > 2048 || /[?#\\\x00]/u.test(value)) invalid('请选择公开奖品图片，不得使用私人凭证或签名链接')
  let decoded: string
  try { decoded = decodeURIComponent(value) } catch { return invalid('图片路径无效') }
  if (decoded.includes('..') || /[?#\\\x00]/u.test(decoded)) invalid('图片路径无效')
  if (!/^\/(?:images|uploads)\/[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|gif)$/iu.test(decoded)
    && !/^\/(?:cos|cos-files|media)\/(?:content|uploads|site-media|activities|images)\/[A-Za-z0-9_./-]+\.(?:png|jpe?g|webp|gif)$/iu.test(decoded)) invalid('请选择项目公开图片')
  return value
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
    return { id: stableId(row.id), name: text(row.name, '', 200), description: text(row.description, '', 2000), imageUrl: image(row.imageUrl),
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
