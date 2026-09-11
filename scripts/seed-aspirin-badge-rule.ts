import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma'
import { ASPIRIN_CLINIC_MODULE, ASPIRIN_INITIAL_STREAK_DAYS, ASPIRIN_MAX_REPEAT_RATE, ASPIRIN_MIN_LENGTH, getAspirinRuleConfig, validateSustainedQualificationSettings } from '../lib/aspirin-badge-config'
import { generateBadgeAcquisitionDescription, parseBadgeRuleInput } from '../lib/badge-rules'

export const ASPIRIN_BADGE_NAME = '阿士匹灵'
export const ASPIRIN_RULE_SEED = {
  ruleType: 'CLINIC_CONSULTATION_STREAK',
  operator: 'GTE',
  threshold: 5,
  secondaryThreshold: ASPIRIN_INITIAL_STREAK_DAYS,
  configJson: {
    module: ASPIRIN_CLINIC_MODULE,
    minLength: ASPIRIN_MIN_LENGTH,
    maxRepeatRate: ASPIRIN_MAX_REPEAT_RATE,
    initialStreakDays: ASPIRIN_INITIAL_STREAK_DAYS,
  },
  isEnabled: true,
  sustainedQualification: true,
  inactiveAfterDays: 1,
  revokeAfterDays: 7,
} as const

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/mysql:\/\/[^\s]+/gi, 'mysql://[redacted]')
}

function assertSeedShape() {
  const parsed = parseBadgeRuleInput(ASPIRIN_RULE_SEED)
  if (parsed.error || !parsed.rule) throw new Error(parsed.error || '阿士匹灵规则 seed 配置无效')
  const sustained = validateSustainedQualificationSettings(ASPIRIN_RULE_SEED)
  if ('error' in sustained) throw new Error(sustained.error)
  const config = getAspirinRuleConfig(parsed.rule.configJson)
  if (!config) throw new Error('阿士匹灵规则 seed 的门诊配置无效')
  return { ...parsed.rule, ...sustained, config }
}

async function databaseSupportsAspirinRuleType() {
  const rows = await prisma.$queryRaw<Array<{ COLUMN_TYPE: string }>>(
    Prisma.sql`SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'BadgeRule' AND COLUMN_NAME = 'ruleType'`,
  )
  return rows[0]?.COLUMN_TYPE.includes("'CLINIC_CONSULTATION_STREAK'") === true
}

async function main() {
  const apply = process.argv.includes('--apply')
  const rule = assertSeedShape()
  const schemaSupportsRuleType = await databaseSupportsAspirinRuleType()
  if (!schemaSupportsRuleType) {
    const message = '生产 BadgeRule.ruleType ENUM 尚未包含 CLINIC_CONSULTATION_STREAK；请先通过受审计的 schema migration 补齐，seed 未执行。'
    if (!apply) {
      console.info(JSON.stringify({ mode: 'dry-run', blocked: true, reason: message, businessDataMutated: false, userBadgeCreated: false }, null, 2))
      return
    }
    throw new Error(message)
  }
  const matches = await prisma.badge.findMany({
    where: { name: ASPIRIN_BADGE_NAME },
    select: {
      id: true,
      name: true,
      grantType: true,
      isAutoGrant: true,
      BadgeRule: {
        select: {
          id: true,
          ruleType: true,
          operator: true,
          threshold: true,
          secondaryThreshold: true,
          configJson: true,
          isEnabled: true,
          sustainedQualification: true,
          inactiveAfterDays: true,
          revokeAfterDays: true,
        },
      },
    },
  })

  if (matches.length !== 1) throw new Error(`精确匹配“${ASPIRIN_BADGE_NAME}”勋章应为 1 条，实际为 ${matches.length} 条；已停止。`)
  const badge = matches[0]
  const existing = badge.BadgeRule
  if (existing) {
    const same = existing.ruleType === rule.ruleType
      && existing.operator === rule.operator
      && existing.threshold === rule.threshold
      && existing.secondaryThreshold === rule.secondaryThreshold
      && existing.isEnabled === true
      && existing.sustainedQualification === true
      && existing.inactiveAfterDays === rule.inactiveAfterDays
      && existing.revokeAfterDays === rule.revokeAfterDays
      && JSON.stringify(existing.configJson) === JSON.stringify(rule.configJson)
    if (!same) throw new Error(`阿士匹灵勋章已存在其他或不一致的自动规则（${existing.id}），不会覆盖现有配置。`)
    console.info(JSON.stringify({
      mode: apply ? 'apply' : 'dry-run',
      badge: 'FOUND',
      existingRules: 1,
      willCreate: false,
      action: 'SKIP_EXISTING_MATCH',
      rule: rule.ruleType,
      sustainedQualification: true,
      inactiveAfterDays: rule.inactiveAfterDays,
      revokeAfterDays: rule.revokeAfterDays,
      businessDataMutated: false,
      userBadgeCreated: false,
      note: '规则已存在且配置一致，幂等跳过。',
    }, null, 2))
    return
  }

  const generatedDescription = generateBadgeAcquisitionDescription(rule.ruleType, rule.threshold, rule.configJson)
  const result = {
    mode: apply ? 'apply' : 'dry-run',
    badge: 'FOUND',
    badgeId: badge.id,
    existingRules: 0,
    willCreate: true,
    rule: rule.ruleType,
    threshold: rule.threshold,
    secondaryThreshold: rule.secondaryThreshold,
    config: rule.config,
    sustainedQualification: true,
    inactiveAfterDays: rule.inactiveAfterDays,
    revokeAfterDays: rule.revokeAfterDays,
    badgeGrantType: `${badge.grantType} -> AUTO`,
    noUserBadgeMutation: true,
  }

  if (!apply) {
    console.info(JSON.stringify({ ...result, businessDataMutated: false, userBadgeCreated: false, note: 'NO DATA WRITE；使用 --apply 才会创建规则。' }, null, 2))
    return
  }

  await prisma.$transaction(async (tx) => {
    await tx.badge.update({
      where: { id: badge.id },
      data: {
        grantType: 'AUTO',
        isAutoGrant: true,
        acquisitionDescription: generatedDescription,
        acquisitionDescriptionCustomized: false,
      },
    })
    await tx.badgeRule.create({
      data: {
        badgeId: badge.id,
        ruleType: rule.ruleType,
        operator: rule.operator,
        threshold: rule.threshold,
        secondaryThreshold: rule.secondaryThreshold,
        configJson: rule.configJson as Prisma.InputJsonValue,
        isEnabled: rule.isEnabled,
        retentionPolicy: null,
        sustainedQualification: rule.sustainedQualification,
        inactiveAfterDays: rule.inactiveAfterDays,
        revokeAfterDays: rule.revokeAfterDays,
      },
    })
  })

  console.info(JSON.stringify({ ...result, businessDataMutated: true, userBadgeCreated: false, note: '仅创建勋章自动规则并切换勋章发放类型；未调用 grant/revoke/scan。' }, null, 2))
}

main()
  .catch((error) => {
    console.error('[seed-aspirin-badge-rule] failed', safeErrorMessage(error))
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
