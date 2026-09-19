import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { accountAgeDays } from '@/lib/badge-metrics'
import { resolveBadgeBackfillEligibility } from '@/lib/badge-rule-engine'

const read = (path: string) => readFileSync(path, 'utf8')

const accountAgeRule = {
  ruleType: 'ACCOUNT_AGE_DAYS' as const,
  operator: 'GTE' as const,
  threshold: 1,
}

test('时代曲的历史注册天数资格在预览与执行模式下使用同一判断', () => {
  const historicalEnd = new Date('2025-01-03T15:59:59.000Z')
  const user = { id: 'user-1', createdAt: new Date('2025-01-01T16:30:00.000Z') }
  const metric = accountAgeDays(user.createdAt, historicalEnd)

  assert.equal(metric, 1)
  assert.equal(resolveBadgeBackfillEligibility({ user, rule: accountAgeRule, metric, now: historicalEnd, mode: 'HISTORICAL_WINDOW' }), true)
  assert.equal(resolveBadgeBackfillEligibility({ user, rule: accountAgeRule, metric, now: new Date('2026-09-20T00:00:00.000Z'), mode: 'HISTORICAL_WINDOW' }), true)
})

test('历史补发允许已绝版限定勋章，但实时 CURRENT 发放仍受可用期保护', () => {
  const service = read('lib/badge-service.ts')
  const engine = read('lib/badge-rule-engine.ts')

  assert.match(service, /historicalBackfill\s*=\s*availabilityMode === 'HISTORICAL_WINDOW'/)
  assert.match(service, /if \(historicalBackfill\) return[\s\S]*if \(!badge\.isEnabled \|\| !badge\.isActive\)/)
  assert.match(service, /availabilityMode === 'CURRENT' && availability !== 'PERMANENT' && availability !== 'AVAILABLE'/)
  assert.match(engine, /context\.mode === 'HISTORICAL_WINDOW'/)
})

test('时代曲扫描的预览与执行共用资格 resolver、当前 ownership 口径和用户级幂等键', () => {
  const engine = read('lib/badge-rule-engine.ts')

  assert.equal((engine.match(/resolveBadgeBackfillEligibility\(/g) || []).length >= 3, true)
  assert.match(engine, /userId: user\.id, mode, historicalWindow/)
  assert.match(engine, /currentUserBadgeWhere\(now\)/)
  assert.match(engine, /take: boundedBatchSize \+ 1/)
  assert.match(engine, /normalizedCursor \? \{ id: \{ gt: normalizedCursor \} \} : \{\}/)
  assert.doesNotMatch(engine, /prisma\.userBadge\.create/)
})

test('重复扫描继续走中心 grantBadge 幂等链路，而不是直接写 ownership', () => {
  const engine = read('lib/badge-rule-engine.ts')
  const service = read('lib/badge-service.ts')

  assert.match(engine, /grantBadge\(/)
  assert.match(service, /where: \{ grantKey \}/)
  assert.match(service, /return operationResult\(input, badge\.name, sameGrant\.id\)/)
})
