import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

const schema = read('prisma/schema.prisma')
const service = read('lib/daily-message-deletion.ts')
const userRoute = read('app/api/daily-messages/[messageId]/route.ts')
const adminRoute = read('app/api/admin/daily-messages/[messageId]/route.ts')
const registrationAdminRoute = read('app/api/admin/registration-messages/[id]/route.ts')
const profileModules = read('components/PublicUserModules.tsx')
const legacyProfileModules = read('components/ProfileDeferredModules.tsx')

test('挂号留言是独立软删除模型，但签到主记录仍保留留言快照字段和关联', () => {
  assert.match(schema, /model CheckIn \{[\s\S]*?message\s+String\?/)
  assert.match(schema, /model DailyMessage \{[\s\S]*?isDeleted\s+Boolean[\s\S]*?checkInId\s+String\?/)
  assert.match(schema, /DailyMessage\s+DailyMessage\?/)
  assert.match(schema, /CheckIn\s+CheckIn\?\s+@relation\(fields: \[checkInId\], references: \[id\]\)/)
  assert.match(service, /tx\.checkIn\.updateMany/)
  assert.match(service, /data: \{ message: isDeleted \? null : message\.content \}/)
  assert.doesNotMatch(service, /checkIn\.delete|dailyMessage\.delete/)
})

test('用户删除 API 做参数、登录、数据库 ownership 和幂等校验', () => {
  assert.match(userRoute, /requireUser\(\)/)
  assert.match(userRoute, /if \(!guard\.user\) return guard\.response/)
  assert.match(userRoute, /isValidDailyMessageId\(messageId\)/)
  assert.match(userRoute, /status: 400/)
  assert.match(userRoute, /deleteDailyMessageForOwner\(messageId, guard\.user\.id\)/)
  assert.match(service, /if \(existing\.userId !== userId\)/)
  assert.match(service, /status: 403/)
  assert.match(service, /status: 404/)
  assert.match(service, /updateMany\([\s\S]*?where: \{ id: messageId, userId \}/)
  assert.doesNotMatch(userRoute, /request\.json|body.*userId/)
})

test('个人主页只给本人显示危险操作，复用 ConfirmDialog 并在成功后更新缓存', () => {
  assert.match(profileModules, /onRequestDeleteRecentMessage=\{isSelf \?/)
  assert.match(profileModules, /aria-label="删除留言"/)
  assert.match(profileModules, /ConfirmDialog/)
  assert.match(profileModules, /title="删除挂号留言？"/)
  assert.match(profileModules, /删除后将无法恢复，但不会影响该日的挂号记录、连续签到和已获得奖励。/)
  assert.match(profileModules, /fetch\(`\/api\/daily-messages\/\$\{encodeURIComponent\(messageId\)\}`/)
  assert.match(profileModules, /value\.items\.filter\(\(item\) => item\.id !== messageId\)/)
  assert.match(profileModules, /disabled=\{deletingRecentMessageId === message\.id\}/)
  assert.doesNotMatch(profileModules, /window\.confirm/)
  assert.doesNotMatch(legacyProfileModules, /window\.confirm/)
})

test('管理员原有删除能力继续复用同一份留言投影同步逻辑', () => {
  assert.match(adminRoute, /requireAdmin\('daily_message_manage'\)/)
  assert.match(adminRoute, /isDeleted: nextIsDeleted/)
  assert.match(adminRoute, /syncDailyMessageDeletionEffects\(tx, existing, nextIsDeleted\)/)
  assert.match(adminRoute, /adminAction\.create/)
  assert.doesNotMatch(adminRoute, /dailyMessage\.delete/)

  assert.match(registrationAdminRoute, /requireAdmin\('daily_message_manage'\)/)
  assert.match(registrationAdminRoute, /isValidDailyMessageId\(id\)/)
  assert.match(registrationAdminRoute, /syncDailyMessageDeletionEffects\(tx, existing, true\)/)
  assert.doesNotMatch(registrationAdminRoute, /dailyMessage\.delete/)
})
