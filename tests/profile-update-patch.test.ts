import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getNicknameChangeAvailability } from '@/lib/nickname-change'

const read = (path: string) => readFileSync(path, 'utf8')

test('未使用的一次性昵称机会长期可用且不显示倒计时', () => {
  const changedAt = new Date('2026-09-01T12:00:00.000Z')
  const result = getNicknameChangeAvailability({
    lastChangedAt: changedAt,
    freeChangeUsedAt: null,
    cooldownDays: 30,
    now: new Date('2027-01-01T12:00:00.000Z'),
  })

  assert.equal(result.canChange, true)
  assert.equal(result.opportunityAvailable, true)
  assert.equal(result.nextAllowedAt, null)
  assert.equal(result.cooldownActive, false)
})

test('昵称机会只在成功使用后进入冷却，冷却严格使用实际修改时间', () => {
  const changedAt = new Date('2026-09-01T12:00:00.000Z')
  const now = new Date('2026-09-10T12:00:00.000Z')
  const active = getNicknameChangeAvailability({
    lastChangedAt: changedAt,
    freeChangeUsedAt: changedAt,
    cooldownDays: 30,
    now,
  })
  assert.equal(active.canChange, false)
  assert.equal(active.cooldownActive, true)
  assert.equal(active.nextAllowedAt?.toISOString(), '2026-10-01T12:00:00.000Z')

  const available = getNicknameChangeAvailability({
    lastChangedAt: changedAt,
    freeChangeUsedAt: changedAt,
    cooldownDays: 30,
    now: new Date('2026-10-01T12:00:00.000Z'),
  })
  assert.equal(available.canChange, true)
})

test('资料 PATCH 只对已提供字段执行更新，昵称机会和操作日志在事务中提交', () => {
  const route = read('app/api/users/me/route.ts')
  const form = read('app/profile/ProfileSettingsForm.tsx')
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20260909110000_add_nickname_free_change/migration.sql')

  assert.match(route, /hasBodyField\s*=\s*\(field: string\)/)
  assert.match(route, /nicknameFreeChangeUsedAt\s*=\s*now/)
  assert.match(route, /nicknameChangedAt\s*=\s*now/)
  assert.match(route, /Prisma\.TransactionIsolationLevel\.Serializable/)
  assert.match(route, /writeUserOperationLog\(tx/)
  assert.match(route, /usedFreeChange:\s*nicknameUsedFreeOpportunity/)
  assert.match(route, /errors: \{ \[field\]: message \}/)
  assert.match(form, /Object\.assign\(payload, nicknamePayload\)/)
  assert.match(form, /Object\.assign\(payload, birthdayPayload\)/)
  assert.match(form, /extractProfileFieldErrors/)
  assert.match(schema, /nicknameFreeChangeUsedAt\s+DateTime\?/)
  assert.match(migration, /ADD COLUMN `nicknameFreeChangeUsedAt` DATETIME\(3\) NULL/)
})

test('资料修改失败不会伪造用户操作记录', () => {
  const route = read('app/api/users/me/route.ts')
  assert.match(route, /writeUserOperationLog\(tx,/)
  assert.match(route, /console\.error\('\[users\.me\.profile\]'/)
  assert.match(route, /PROFILE_UPDATE_FAILED/)
})
