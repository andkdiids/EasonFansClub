import type { Prisma } from '@prisma/client'

export const BADGE_EVALUATION_EVENTS = [
  'POST_CREATED',
  'POST_APPROVED',
  'POST_FEATURED',
  'CHECKIN_CREATED',
  'USER_LOGIN',
  'FRIENDSHIP_CREATED',
  'FOLLOW_CREATED',
  'GUESS_SONG_SESSION_FINISHED',
  'DUEL_FINISHED',
  'WANT_LISTEN_SESSION_FINISHED',
  'RATING_CREATED',
  'CONCERT_ATTENDANCE_CREATED',
] as const

export type BadgeEvaluationEvent = typeof BADGE_EVALUATION_EVENTS[number]

const BADGE_RULE_THRESHOLD_LIMITS = { min: 1, max: 1_000_000_000 } as const
const ADMIN_BADGE_RULE_OPERATORS = ['GTE'] as const

/** All values reserved by the database/engine. The first admin release exposes only GTE. */
export const BADGE_RULE_OPERATORS = ['GTE', 'LTE', 'EQ'] as const
export const BADGE_RULE_INPUT_OPERATORS = ADMIN_BADGE_RULE_OPERATORS
export type BadgeRuleOperatorValue = typeof BADGE_RULE_OPERATORS[number]

export type BadgeRuleRegistryEntry = {
  label: string
  dataDescription: string
  metricLoader: string
  supportedOperators: readonly string[]
  events: readonly BadgeEvaluationEvent[]
  threshold: typeof BADGE_RULE_THRESHOLD_LIMITS | null
  defaultAcquisitionDescription: (threshold: number | null) => string
  adminSelectable?: boolean
  seriesCompletion?: boolean
  group: '社区' | '挂号' | '账号' | '娱乐天空' | 'EasMusic / 演唱会' | '歌·颂' | '系统'
  unit?: string
  targetKind?: 'CONCERT' | 'TOUR'
  /** Whether the rule can be recomputed against a bounded historical window. */
  supportsHistoricalBackfill: boolean
  /** Human-readable evidence source shown to administrators. */
  historicalBasis: string
}

function displayThreshold(threshold: number) {
  return Number.isSafeInteger(threshold) && threshold >= BADGE_RULE_THRESHOLD_LIMITS.min && threshold <= BADGE_RULE_THRESHOLD_LIMITS.max
    ? threshold
    : BADGE_RULE_THRESHOLD_LIMITS.min
}

/**
 * Single source of truth for the first-version rule catalog.
 * The metricLoader key is bound to the actual Prisma loaders in badge-rule-engine.ts;
 * keeping the registry itself data-only lets the admin client reuse labels safely.
 */
export const BADGE_RULE_REGISTRY = {
  POST_COUNT: {
    group: '社区', unit: '篇',
    label: '累计发帖数',
    dataDescription: '有效且已通过审核的帖子数量',
    metricLoader: 'POST_COUNT',
    supportedOperators: ADMIN_BADGE_RULE_OPERATORS,
    events: ['POST_CREATED', 'POST_APPROVED'],
    threshold: BADGE_RULE_THRESHOLD_LIMITS,
    supportsHistoricalBackfill: true,
    historicalBasis: '按限定期内有效帖子的 createdAt 重算',
    defaultAcquisitionDescription: (threshold: number | null) => `累计发布 ${displayThreshold(threshold || 1)} 篇帖子后获得`,
  },
  FEATURED_POST_COUNT: {
    group: '社区', unit: '篇',
    label: '累计精华帖数',
    dataDescription: '有效且被设置为精华的帖子数量',
    metricLoader: 'FEATURED_POST_COUNT',
    supportedOperators: ADMIN_BADGE_RULE_OPERATORS,
    events: ['POST_APPROVED', 'POST_FEATURED'],
    threshold: BADGE_RULE_THRESHOLD_LIMITS,
    supportsHistoricalBackfill: false,
    historicalBasis: '帖子没有可靠的历史精华时间，不能证明限定期内何时成为精华',
    defaultAcquisitionDescription: (threshold: number | null) => `累计获得 ${displayThreshold(threshold || 1)} 篇精华帖后获得`,
  },
  CHECKIN_TOTAL_DAYS: {
    group: '挂号', unit: '天',
    label: '累计挂号天数',
    dataDescription: '按上海时区去重后的挂号日期数量',
    metricLoader: 'CHECKIN_TOTAL_DAYS',
    supportedOperators: ADMIN_BADGE_RULE_OPERATORS,
    events: ['CHECKIN_CREATED'],
    threshold: BADGE_RULE_THRESHOLD_LIMITS,
    supportsHistoricalBackfill: true,
    historicalBasis: '按限定期内上海时区去重后的签到日期重算',
    defaultAcquisitionDescription: (threshold: number | null) => `累计挂号 ${displayThreshold(threshold || 1)} 天后获得`,
  },
  CHECKIN_STREAK: {
    group: '挂号', unit: '天',
    label: '连续挂号天数',
    dataDescription: '复用现有上海时区连续挂号算法的当前连续天数',
    metricLoader: 'CHECKIN_STREAK',
    supportedOperators: ADMIN_BADGE_RULE_OPERATORS,
    events: ['CHECKIN_CREATED'],
    threshold: BADGE_RULE_THRESHOLD_LIMITS,
    supportsHistoricalBackfill: true,
    historicalBasis: '按限定窗口内的签到日期重算最长连续天数',
    defaultAcquisitionDescription: (threshold: number | null) => `连续挂号 ${displayThreshold(threshold || 1)} 天后获得`,
  },
  ACCOUNT_AGE_DAYS: {
    group: '账号', unit: '天',
    label: '注册天数',
    dataDescription: '从正式注册时间到当前时间经过的完整上海时区自然日',
    metricLoader: 'ACCOUNT_AGE_DAYS',
    supportedOperators: ADMIN_BADGE_RULE_OPERATORS,
    events: ['USER_LOGIN'],
    threshold: BADGE_RULE_THRESHOLD_LIMITS,
    supportsHistoricalBackfill: true,
    historicalBasis: '按用户注册时间与限定期结束日重算账号年龄',
    defaultAcquisitionDescription: (threshold: number | null) => `注册满 ${displayThreshold(threshold || 1)} 天后获得`,
  },
  FRIEND_COUNT: {
    group: '社区', unit: '人',
    label: '好友数',
    dataDescription: '已建立的双向好友关系数量',
    metricLoader: 'FRIEND_COUNT',
    supportedOperators: ADMIN_BADGE_RULE_OPERATORS,
    events: ['FRIENDSHIP_CREATED'],
    threshold: BADGE_RULE_THRESHOLD_LIMITS,
    supportsHistoricalBackfill: false,
    historicalBasis: '关系删除后没有历史快照，无法可靠还原限定期结束时的好友数',
    defaultAcquisitionDescription: (threshold: number | null) => `好友达到 ${displayThreshold(threshold || 1)} 位后获得`,
  },
  FOLLOWER_COUNT: {
    group: '社区', unit: '人',
    label: '粉丝数',
    dataDescription: '现有 canonical Follow 关注关系中的粉丝数量',
    metricLoader: 'FOLLOWER_COUNT',
    supportedOperators: ADMIN_BADGE_RULE_OPERATORS,
    events: ['FOLLOW_CREATED'],
    threshold: BADGE_RULE_THRESHOLD_LIMITS,
    supportsHistoricalBackfill: false,
    historicalBasis: '关系删除后没有历史快照，无法可靠还原限定期结束时的粉丝数',
    defaultAcquisitionDescription: (threshold: number | null) => `粉丝达到 ${displayThreshold(threshold || 1)} 位后获得`,
  },
  GUESS_SONG_MAX_STREAK: {
    group: '娱乐天空', unit: '题',
    label: '听听最高连击',
    dataDescription: '有效且已完成的听听对局记录中的最高连击',
    metricLoader: 'GUESS_SONG_MAX_STREAK',
    supportedOperators: ADMIN_BADGE_RULE_OPERATORS,
    events: ['GUESS_SONG_SESSION_FINISHED'],
    threshold: BADGE_RULE_THRESHOLD_LIMITS,
    supportsHistoricalBackfill: true,
    historicalBasis: '按限定期内已完成且有效的听听对局重算最高连击',
    defaultAcquisitionDescription: (threshold: number | null) => `听听最高连击达到 ${displayThreshold(threshold || 1)} 题后获得`,
  },
  DUEL_WIN_COUNT: {
    group: '娱乐天空', unit: '场',
    label: '1v1 对决胜场',
    dataDescription: '有效完成的听听 1v1 对决统计中的胜场数',
    metricLoader: 'DUEL_WIN_COUNT',
    supportedOperators: ADMIN_BADGE_RULE_OPERATORS,
    events: ['DUEL_FINISHED'],
    threshold: BADGE_RULE_THRESHOLD_LIMITS,
    supportsHistoricalBackfill: false,
    historicalBasis: '现有胜场统计没有逐场时间，无法可靠重建限定期胜场数',
    defaultAcquisitionDescription: (threshold: number | null) => `累计赢得 ${displayThreshold(threshold || 1)} 场听听 1v1 对决后获得`,
  },
  WANT_LISTEN_MAX_STREAK: {
    group: '娱乐天空', unit: '题',
    label: '想听最高连击',
    dataDescription: '复用想听统计表中的最高连击',
    metricLoader: 'WANT_LISTEN_MAX_STREAK',
    supportedOperators: ADMIN_BADGE_RULE_OPERATORS,
    events: ['WANT_LISTEN_SESSION_FINISHED'],
    threshold: BADGE_RULE_THRESHOLD_LIMITS,
    supportsHistoricalBackfill: false,
    historicalBasis: '现有最高连击统计没有历史快照，无法可靠重建限定期最高连击',
    defaultAcquisitionDescription: (threshold: number | null) => `想听最高连击达到 ${displayThreshold(threshold || 1)} 题后获得`,
  },
  CONCERT_ATTENDANCE_COUNT: {
    group: 'EasMusic / 演唱会', unit: '场',
    label: '演唱会观看场次',
    dataDescription: '我的现场中现存的观演记录数量',
    metricLoader: 'CONCERT_ATTENDANCE_COUNT',
    supportedOperators: ADMIN_BADGE_RULE_OPERATORS,
    events: ['CONCERT_ATTENDANCE_CREATED'],
    threshold: BADGE_RULE_THRESHOLD_LIMITS,
    supportsHistoricalBackfill: true,
    historicalBasis: '按限定期内 UserMusicConcert.createdAt 重算观演记录',
    defaultAcquisitionDescription: (threshold: number | null) => `累计观看 ${displayThreshold(threshold || 1)} 场演唱会后获得`,
  },
  CONCERT_SHOW_ATTENDED: {
    group: 'EasMusic / 演唱会',
    label: '观看指定演唱会',
    dataDescription: '我的现场中存在所选具体场次的观演记录',
    metricLoader: 'CONCERT_SHOW_ATTENDED',
    supportedOperators: ADMIN_BADGE_RULE_OPERATORS,
    events: ['CONCERT_ATTENDANCE_CREATED'],
    threshold: null,
    targetKind: 'CONCERT',
    supportsHistoricalBackfill: true,
    historicalBasis: '按限定期内添加的指定场次观演记录重算',
    defaultAcquisitionDescription: () => '观看指定演唱会后获得',
  },
  CONCERT_TOUR_ATTENDED: {
    group: 'EasMusic / 演唱会',
    label: '观看指定巡演',
    dataDescription: '我的现场中存在所选巡演任意一场的观演记录',
    metricLoader: 'CONCERT_TOUR_ATTENDED',
    supportedOperators: ADMIN_BADGE_RULE_OPERATORS,
    events: ['CONCERT_ATTENDANCE_CREATED'],
    threshold: null,
    targetKind: 'TOUR',
    supportsHistoricalBackfill: true,
    historicalBasis: '按限定期内添加的指定巡演观演记录重算',
    defaultAcquisitionDescription: () => '观看指定巡演任意一场后获得',
  },
  RATING_COUNT: {
    group: '歌·颂', unit: '次',
    label: '歌·颂评分次数',
    dataDescription: '歌·颂中已提交的歌曲与专辑评分数量',
    metricLoader: 'RATING_COUNT',
    supportedOperators: ADMIN_BADGE_RULE_OPERATORS,
    events: ['RATING_CREATED'],
    threshold: BADGE_RULE_THRESHOLD_LIMITS,
    supportsHistoricalBackfill: true,
    historicalBasis: '按限定期内 Rating.createdAt 重算评分次数',
    defaultAcquisitionDescription: (threshold: number | null) => `累计完成 ${displayThreshold(threshold || 1)} 次歌·颂评分后获得`,
  },
  BADGE_SERIES_COMPLETE: {
    group: '系统',
    label: '系列全收集',
    dataDescription: '拥有指定系列内全部计入完成度的勋章，不使用数值阈值',
    metricLoader: 'BADGE_SERIES_COMPLETE',
    supportedOperators: ['GTE'],
    events: [],
    threshold: null,
    adminSelectable: false,
    seriesCompletion: true,
    supportsHistoricalBackfill: false,
    historicalBasis: '没有可靠的系列首次完成时间，不能用当前完成状态倒推历史资格',
    defaultAcquisitionDescription: () => '集齐指定系列全部勋章后获得',
  },
} as const satisfies Record<string, BadgeRuleRegistryEntry>

export type SupportedBadgeRuleType = keyof typeof BADGE_RULE_REGISTRY
export const BADGE_RULE_TYPES_WITH_SPECIAL = Object.keys(BADGE_RULE_REGISTRY) as SupportedBadgeRuleType[]
/** Numeric/event rules exposed to the existing event registry and admin catalog. */
export const BADGE_RULE_TYPES = BADGE_RULE_TYPES_WITH_SPECIAL
  .filter((ruleType) => !('seriesCompletion' in BADGE_RULE_REGISTRY[ruleType]))
export const BADGE_ADMIN_RULE_TYPES = BADGE_RULE_TYPES.filter((ruleType) => !('adminSelectable' in BADGE_RULE_REGISTRY[ruleType]) || BADGE_RULE_REGISTRY[ruleType].adminSelectable !== false)

export const BADGE_RULE_TYPE_LABELS = Object.fromEntries(
  BADGE_RULE_TYPES_WITH_SPECIAL.map((ruleType) => [ruleType, BADGE_RULE_REGISTRY[ruleType].label]),
) as Record<SupportedBadgeRuleType, string>

export const BADGE_RULE_TYPE_DESCRIPTIONS = Object.fromEntries(
  BADGE_RULE_TYPES_WITH_SPECIAL.map((ruleType) => [ruleType, BADGE_RULE_REGISTRY[ruleType].dataDescription]),
) as Record<SupportedBadgeRuleType, string>

export type ParsedBadgeRule = {
  ruleType: SupportedBadgeRuleType
  operator: BadgeRuleOperatorValue
  threshold: number | null
  secondaryThreshold: number | null
  configJson: Prisma.InputJsonValue | null
  isEnabled: boolean
}

function parsePositiveInteger(value: unknown, label: string, limits = BADGE_RULE_THRESHOLD_LIMITS) {
  const parsed = typeof value === 'number' && Number.isInteger(value)
    ? value
    : typeof value === 'string' && /^\d+$/.test(value.trim())
      ? Number(value.trim())
      : Number.NaN
  if (!Number.isSafeInteger(parsed) || parsed < limits.min || parsed > limits.max) return { error: `${label}必须是 ${limits.min} 到 ${limits.max} 的整数` as const }
  return { value: parsed }
}

/** Normalize and validate the only rule shape exposed by the admin API. */
export function parseBadgeRuleInput(value: unknown): { rule?: ParsedBadgeRule | null; error?: string } {
  if (value === undefined) return {}
  if (value === null) return { rule: null }
  if (typeof value !== 'object' || Array.isArray(value)) return { error: '自动获取规则格式无效' }
  const body = value as Record<string, unknown>
  const ruleTypeValue = typeof body.ruleType === 'string' ? body.ruleType.toUpperCase() : ''
  const definition = (BADGE_RULE_REGISTRY as Record<string, BadgeRuleRegistryEntry>)[ruleTypeValue]
  if (!definition) return { error: '自动获取规则类型无效' }

  const operator = body.operator === undefined
    ? 'GTE'
    : typeof body.operator === 'string'
      ? body.operator.toUpperCase()
      : ''
  if (!(BADGE_RULE_OPERATORS as readonly string[]).includes(operator)) return { error: '自动获取规则操作符无效' }
  if (!definition.supportedOperators.includes(operator)) return { error: '当前版本后台仅支持达到（≥）操作符' }

  if (definition.seriesCompletion) {
    const rawConfig = body.configJson
    if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) return { error: '系列完成规则必须指定系列' }
    const seriesId = (rawConfig as Record<string, unknown>).seriesId
    if (typeof seriesId !== 'string' || !/^[A-Za-z0-9_-]{1,191}$/.test(seriesId.trim())) return { error: '系列完成规则的系列标识无效' }
    if (body.threshold !== undefined && body.threshold !== null && body.threshold !== '') return { error: '系列完成规则不需要数值阈值' }
    if (body.secondaryThreshold !== undefined && body.secondaryThreshold !== null && body.secondaryThreshold !== '') return { error: '系列完成规则不需要次级阈值' }
    if (body.isEnabled !== undefined && typeof body.isEnabled !== 'boolean') return { error: '自动规则启用标记无效' }
    return {
      rule: {
        ruleType: ruleTypeValue as SupportedBadgeRuleType,
        operator: 'GTE',
        threshold: null,
        secondaryThreshold: null,
        configJson: { seriesId: seriesId.trim() },
        isEnabled: body.isEnabled !== false,
      },
    }
  }

  if (definition.targetKind) {
    const rawConfig = body.configJson
    if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) return { error: `请选择${definition.targetKind === 'CONCERT' ? '演唱会' : '巡演'}` }
    const key = definition.targetKind === 'CONCERT' ? 'concertId' : 'tourId'
    const targetId = (rawConfig as Record<string, unknown>)[key]
    if (typeof targetId !== 'string' || !/^[A-Za-z0-9_-]{1,191}$/.test(targetId.trim())) return { error: `请选择有效的${definition.targetKind === 'CONCERT' ? '演唱会' : '巡演'}` }
    if (body.threshold !== undefined && body.threshold !== null && body.threshold !== '') return { error: '指定演唱会规则不需要填写数量' }
    if (body.isEnabled !== undefined && typeof body.isEnabled !== 'boolean') return { error: '自动规则启用标记无效' }
    return { rule: { ruleType: ruleTypeValue as SupportedBadgeRuleType, operator: 'GTE', threshold: null, secondaryThreshold: null, configJson: { [key]: targetId.trim() }, isEnabled: body.isEnabled !== false } }
  }

  const thresholdResult = parsePositiveInteger(body.threshold, '规则阈值', definition.threshold ?? BADGE_RULE_THRESHOLD_LIMITS)
  if ('error' in thresholdResult) return thresholdResult

  let secondaryThreshold: number | null = null
  if (body.secondaryThreshold !== undefined && body.secondaryThreshold !== null && body.secondaryThreshold !== '') {
    const secondaryResult = parsePositiveInteger(body.secondaryThreshold, '规则次级阈值', definition.threshold ?? BADGE_RULE_THRESHOLD_LIMITS)
    if ('error' in secondaryResult) return secondaryResult
    secondaryThreshold = secondaryResult.value
  }

  if (body.configJson !== undefined && body.configJson !== null) return { error: '当前版本暂不开放自定义业务事件配置' }
  if (body.isEnabled !== undefined && typeof body.isEnabled !== 'boolean') return { error: '自动规则启用标记无效' }

  return {
    rule: {
      ruleType: ruleTypeValue as SupportedBadgeRuleType,
      operator: operator as BadgeRuleOperatorValue,
      threshold: thresholdResult.value,
      secondaryThreshold,
      configJson: null,
      isEnabled: body.isEnabled !== false,
    },
  }
}

export function generateBadgeAcquisitionDescription(ruleType: SupportedBadgeRuleType, threshold: number | null) {
  const definition = BADGE_RULE_REGISTRY[ruleType]
  return definition?.defaultAcquisitionDescription(threshold) || '达成自动获取条件后获得'
}

export function isSupportedBadgeRuleType(value: string): value is SupportedBadgeRuleType {
  return Object.prototype.hasOwnProperty.call(BADGE_RULE_REGISTRY, value)
}
