import { parseActivityDateInput, type ActivityTypeValue } from '@/lib/activity'
import { sanitizeText } from '@/lib/security'

export type TopicActivityConfig = {
  pinToPlaza: boolean
  participationRule: string | null
  rewardGrantMode: 'IMMEDIATE' | 'SCHEDULED'
  rewardGrantAt: Date | null
  rewardPoints: number | null
  rewardBadgeIds: string[]
}

type ExistingConfig = Partial<TopicActivityConfig> | null | undefined

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function read(input: Record<string, unknown>, key: keyof TopicActivityConfig, existing: ExistingConfig) {
  return Object.prototype.hasOwnProperty.call(input, key) ? input[key] : existing?.[key]
}

export function normalizeTopicActivityConfig(inputValue: unknown, type: ActivityTypeValue, existing?: ExistingConfig): { valid: true; value: TopicActivityConfig } | { valid: false; message: string } {
  const input = asRecord(inputValue)
  const pinValue = read(input, 'pinToPlaza', existing)
  const pinToPlaza = pinValue === undefined ? type === 'TOPIC_ACTIVITY' : pinValue === true || pinValue === 'true' || pinValue === 1

  if (type !== 'TOPIC_ACTIVITY') {
    return { valid: true, value: { pinToPlaza, participationRule: null, rewardGrantMode: 'IMMEDIATE', rewardGrantAt: null, rewardPoints: null, rewardBadgeIds: [] } }
  }

  const participationRule = sanitizeText(read(input, 'participationRule', existing), 2_000) || null
  const rawMode = read(input, 'rewardGrantMode', existing) ?? 'IMMEDIATE'
  if (rawMode !== 'IMMEDIATE' && rawMode !== 'SCHEDULED') return { valid: false, message: '奖励发放方式不正确' }

  const rawGrantAt = read(input, 'rewardGrantAt', existing)
  let rewardGrantAt: Date | null = null
  if (rawGrantAt !== undefined && rawGrantAt !== null && rawGrantAt !== '') {
    rewardGrantAt = parseActivityDateInput(rawGrantAt)
    if (!rewardGrantAt) return { valid: false, message: '统一发奖时间格式不正确，请使用北京时间 YYYY-MM-DD HH:mm' }
  }
  if (rawMode === 'SCHEDULED' && !rewardGrantAt) return { valid: false, message: '定时发放必须设置统一发奖时间' }
  if (rawMode === 'IMMEDIATE') rewardGrantAt = null

  const rawPoints = read(input, 'rewardPoints', existing)
  let rewardPoints: number | null = null
  if (rawPoints !== undefined && rawPoints !== null && rawPoints !== '') {
    rewardPoints = typeof rawPoints === 'number' ? rawPoints : Number(rawPoints)
    if (!Number.isSafeInteger(rewardPoints) || rewardPoints < 1 || rewardPoints > 2_000_000_000) return { valid: false, message: '挂号费奖励必须是正整数' }
  }

  const rawBadges = read(input, 'rewardBadgeIds', existing)
  if (rawBadges !== undefined && rawBadges !== null && !Array.isArray(rawBadges)) return { valid: false, message: '奖励勋章格式不正确' }
  const rewardBadgeIds = [...new Set((Array.isArray(rawBadges) ? rawBadges : []).filter((id): id is string => typeof id === 'string').map((id) => id.trim()).filter((id) => id.length > 0))]
  if (rewardBadgeIds.length > 10 || rewardBadgeIds.some((id) => id.length > 191)) return { valid: false, message: '最多选择 10 枚奖励勋章' }

  return { valid: true, value: { pinToPlaza, participationRule, rewardGrantMode: rawMode, rewardGrantAt, rewardPoints, rewardBadgeIds } }
}
