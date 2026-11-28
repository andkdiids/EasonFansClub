import { SHUN_COMMUNITY_DROP_RULES, SHUN_GIFT_WEIGHTS, SHUN_ITEM_CATALOG, type ShunItemCode } from './shun-item-rules'

const descriptions: Record<ShunItemCode, string> = {
  EXTRA_ATTEMPT: '增加一次今天的主动顺取机会。',
  FRIEND_GIFT: '随机送给一位通讯录好友一份礼物，你也将收到一份随机回礼。',
  EXTRA_SUSPECT: '下一次成功顺取的抓捕名单多一位候选人。',
  REVENGE: '抓捕成功后，对真实顺取者反击一次。',
  TARGET_FRIEND: '指定一位通讯录好友进行顺取。',
  DOUBLE_AMOUNT: '下一次成功顺取金额翻倍，最多 14 挂号费。',
  RETRY_CAPTURE: '重试一次失败的抓捕，原额追回。',
}

/**
 * V4.2.1：每位用户每日最多收到 1 次好友赠礼。
 *
 * 旧版本配置里写的是 2。校验仍然接受 0..2（否则线上旧配置会整体校验失败，
 * 百宝箱与奖励链路会一起停摆），但读出的规则一律归一化到新上限，
 * 避免「代码已上线、配置还没增量更新」之间出现旧上限仍然生效的窗口。
 */
export const SHUN_GIFT_DAILY_RECEIVE_LIMIT = 1

export const defaultShunItemRules = {
  dailyMain: true,
  weekly: { 3: true, 5: true, 7: true },
  community: true,
  drops: SHUN_COMMUNITY_DROP_RULES,
  dailyMax: 2,
  giftsReceived: SHUN_GIFT_DAILY_RECEIVE_LIMIT,
  extraAttempts: 2,
  commentMinChars: 10,
  gifts: SHUN_GIFT_WEIGHTS,
}

export const defaultShunItemDefinitions = (Object.keys(SHUN_ITEM_CATALOG) as ShunItemCode[]).map((code) => ({
  code, ...SHUN_ITEM_CATALOG[code], description: descriptions[code], enabled: true, icon: code,
}))

type ItemRules = {
  dailyMain: boolean
  weekly: Record<3 | 5 | 7, boolean>
  community: boolean
  drops: Record<keyof typeof SHUN_COMMUNITY_DROP_RULES, { chance: number; dailyChecks: number }>
  dailyMax: number
  giftsReceived: number
  extraAttempts: number
  commentMinChars: number
  gifts: Record<keyof typeof SHUN_GIFT_WEIGHTS, number>
}
type Definition = Omit<(typeof defaultShunItemDefinitions)[number], 'name' | 'rarity' | 'weight' | 'icon'> & {
  name: string; rarity: string; weight: number; icon: string
}
export type ShunItemDraft = { enabled: boolean; definitions: Definition[]; rules: ItemRules }

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function integer(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

export function validateShunItemDraft(input: unknown): ShunItemDraft | null {
  const draft = object(input)
  if (typeof draft.enabled !== 'boolean' || !Array.isArray(draft.definitions)
    || draft.definitions.length !== defaultShunItemDefinitions.length) return null
  const definitions: Definition[] = []
  for (const defaults of defaultShunItemDefinitions) {
    const item = object(draft.definitions.find((row: unknown) => object(row).code === defaults.code))
    if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 64
      || typeof item.description !== 'string' || !item.description.trim() || item.description.length > 512
      || typeof item.icon !== 'string' || !Object.hasOwn(SHUN_ITEM_CATALOG, item.icon)
      || typeof item.rarity !== 'string' || !['普通', '稀有', '珍藏', '隐藏'].includes(item.rarity)
      || typeof item.enabled !== 'boolean' || !integer(item.weight, 0, 100)) return null
    if (defaults.code === 'TARGET_FRIEND' && item.name.trim() !== '任我顺') return null
    definitions.push({
      code: defaults.code, name: item.name.trim(), description: defaults.code === 'FRIEND_GIFT' ? defaults.description : item.description.trim(),
      icon: item.icon, rarity: item.rarity, enabled: item.enabled, weight: item.weight,
    })
  }
  if (definitions.reduce((total, item) => total + (item.enabled ? item.weight : 0), 0) !== 100) return null

  const rules = object(draft.rules)
  const weekly = object(rules.weekly)
  const drops = object(rules.drops)
  const gifts = object(rules.gifts)
  if (typeof rules.dailyMain !== 'boolean' || typeof rules.community !== 'boolean'
    || ![3, 5, 7].every((milestone) => typeof weekly[milestone] === 'boolean')
    || !integer(rules.dailyMax, 1, 2) || !integer(rules.giftsReceived, 0, 2)
    || !integer(rules.extraAttempts, 0, 2) || !integer(rules.commentMinChars, 10, 200)) return null
  if (!Object.entries(SHUN_COMMUNITY_DROP_RULES).every(([event, defaults]) => {
    const rule = object(drops[event])
    return integer(rule.chance, 0, 100) && integer(rule.dailyChecks, 0, defaults.dailyChecks)
  })) return null
  const giftCodes = Object.keys(SHUN_GIFT_WEIGHTS)
  if (Object.keys(gifts).length !== giftCodes.length || !giftCodes.every((code) => integer(gifts[code], 0, 100))
    || giftCodes.reduce((total, code) => total + Number(gifts[code]), 0) !== 100) return null
  if (definitions.some((item) => item.code === 'FRIEND_GIFT' && item.enabled) && giftCodes.some((code) =>
    Number(gifts[code]) > 0 && !definitions.some((item) => item.code === code && item.enabled && ['普通', '稀有'].includes(item.rarity)))) return null
  return {
    enabled: draft.enabled,
    definitions,
    // 归一化每日收礼上限：旧配置写 2 也按 1 生效（见 SHUN_GIFT_DAILY_RECEIVE_LIMIT）。
    rules: { ...(rules as ItemRules), giftsReceived: Math.min(rules.giftsReceived as number, SHUN_GIFT_DAILY_RECEIVE_LIMIT) },
  }
}

export function shunItemsFeatureEnabled() {
  return process.env.SHUN_ITEMS_ENABLED === 'true'
}
