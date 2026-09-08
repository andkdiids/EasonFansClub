import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { normalizeUserOperationCategory } from '../lib/user-operation-center'

const read = (relativePath: string) => readFileSync(relativePath, 'utf8')

test('用户操作中心使用管理员权限并提供两个主分区', () => {
  const page = read('app/admin/user-operations/page.tsx')
  const api = read('app/api/admin/user-operations/route.ts')
  const client = read('app/admin/user-operations/UserOperationCenter.tsx')
  const navigation = read('lib/admin-navigation.ts')

  assert.match(page, /requireAdminPage\('\/admin\/user-operations', 'user_manage'\)/u)
  assert.match(api, /requireAdmin\('user_manage'\)/u)
  assert.match(client, />今日操作记录<\/button>/u)
  assert.match(client, />高风险用户<\/button>/u)
  assert.match(navigation, /href: '\/admin\/user-operations'/u)
})

test('用户操作中心保留真实来源并按服务端范围聚合', () => {
  const center = read('lib/user-operation-center.ts')

  for (const source of [
    'prisma.userOperationLog',
    'prisma.adminAction',
    'prisma.adminActionLog',
    'prisma.checkIn',
    'prisma.pointLog',
    'prisma.post',
    'prisma.reply',
    'prisma.friendRequest',
    'prisma.directMessage',
    'prisma.userBadge',
    'prisma.gameAntiCheatLog',
    'prisma.accountSecurityLog',
  ]) assert.match(center, new RegExp(source.replace('.', '\\.'), 'u'))

  assert.match(center, /madeUpAt \|\| row\.createdAt/u)
  assert.match(center, /take: options\.take/u)
  assert.match(center, /orderBy: \[\{ occurredAt: 'desc' \}, \{ id: 'desc' \}\]/u)
  assert.match(center, /source: 'DirectMessage', detail: detailOf\(\{ type: row\.type \}\)/u)
  assert.match(center, /select: \{ id: true, senderId: true, type: true, createdAt: true \}/u)
})

test('昵称与生日只在成功业务事务中记录 old/new，不伪造历史', () => {
  const selfRoute = read('app/api/users/me/route.ts')
  const adminProfile = read('lib/admin-user-profile.ts')
  const logWriter = read('lib/user-operation-log.ts')

  assert.match(selfRoute, /const profile = await prisma\.\$transaction\(async \(tx\)/u)
  assert.match(selfRoute, /action: 'NICKNAME_CHANGED'/u)
  assert.match(selfRoute, /oldNickname: mutationCurrent\.nickname/u)
  assert.match(selfRoute, /newNickname: updated\.nickname/u)
  assert.match(selfRoute, /action: 'BIRTHDAY_CHANGED'/u)
  assert.match(selfRoute, /oldBirthday: birthdayMutation\.previousBirthday/u)
  assert.match(selfRoute, /newBirthday: birthdayMutation\.birthday/u)
  assert.match(selfRoute, /valuesEqual\(oldValue, newValue\)/u)
  assert.match(adminProfile, /oldValue/u)
  assert.match(adminProfile, /newValue/u)
  assert.match(adminProfile, /tx\.adminActionLog\.create/u)
  assert.match(logWriter, /tx\.userOperationLog\.create/u)
  assert.match(logWriter, /Prisma\.TransactionClient/u)
})

test('用户操作记录模型与 migration 的字段、索引和外键保持一致', () => {
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20260909100000_add_user_operation_log/migration.sql')

  assert.match(schema, /model UserOperationLog \{/u)
  for (const field of ['userId', 'category', 'action', 'summary', 'metadata', 'source', 'operatorType', 'operatorUserId', 'targetType', 'targetId', 'riskLevel', 'occurredAt', 'createdAt']) {
    assert.match(schema, new RegExp('\\b' + field + '\\b', 'u'))
    assert.match(migration, new RegExp('`' + field + '`', 'u'))
  }
  for (const index of [
    'UserOperationLog_userId_occurredAt_id_idx',
    'UserOperationLog_category_occurredAt_id_idx',
    'UserOperationLog_riskLevel_occurredAt_id_idx',
    'UserOperationLog_operatorUserId_occurredAt_idx',
  ]) assert.match(migration, new RegExp(index, 'u'))
  assert.match(migration, /UserOperationLog_userId_fkey/u)
  assert.match(migration, /UserOperationLog_operatorUserId_fkey/u)
  assert.doesNotMatch(migration, /(?:^|\n)\s*(?:UPDATE|DELETE|DROP)\s+/u)
})

test('用户搜索支持昵称、UID、手机号和邮箱，并对未知类别回退全部', () => {
  const center = read('lib/user-operation-center.ts')

  assert.equal(normalizeUserOperationCategory('RISK'), 'RISK')
  assert.equal(normalizeUserOperationCategory('not-a-category'), 'ALL')
  assert.match(center, /uid: numericUid/u)
  assert.match(center, /nickname: \{ contains: keyword \}/u)
  assert.match(center, /email: \{ contains: keyword \}/u)
  assert.match(center, /phone: \{ contains: keyword \}/u)
  assert.match(center, /Profile: \{ displayName: \{ contains: keyword \} \}/u)
})
