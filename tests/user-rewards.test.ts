import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildUserRewardNotificationContent,
  normalizeUserRewardInput,
} from '../lib/user-rewards'

const read = (path: string) => readFileSync(path, 'utf8')

test('用户奖励通知只展示实际发生的奖励，并使用中性文案', () => {
  assert.equal(
    buildUserRewardNotificationContent({ experienceAmount: 27, registrationFeeAmount: 10, reason: '投稿内容已被采纳' }),
    '获得以下奖励：\n经验值 +27\n挂号费 +10\n\n奖励说明：投稿内容已被采纳',
  )
  assert.equal(
    buildUserRewardNotificationContent({ experienceAmount: 27, registrationFeeAmount: 0, reason: '功能建议已被采纳' }),
    '获得以下奖励：\n经验值 +27\n\n奖励说明：功能建议已被采纳',
  )
  assert.doesNotMatch(buildUserRewardNotificationContent({ experienceAmount: 0, registrationFeeAmount: 50, reason: '优质内容贡献奖励' }), /管理员/)
})

test('奖励输入要求说明必填、至少一项为正且金额为安全整数', () => {
  assert.deepEqual(normalizeUserRewardInput({
    transactionId: 'reward-test-1',
    userId: 'user-1',
    operatorId: 'admin-1',
    experienceAmount: '27',
    registrationFeeAmount: 10,
    reason: '投稿内容已被采纳',
  }), {
    transactionId: 'reward-test-1',
    userId: 'user-1',
    operatorId: 'admin-1',
    experienceAmount: 27,
    registrationFeeAmount: 10,
    reason: '投稿内容已被采纳',
  })
  assert.throws(() => normalizeUserRewardInput({ transactionId: 'reward-test-2', userId: 'user-1', operatorId: 'admin-1', experienceAmount: 0, registrationFeeAmount: 0, reason: '无奖励' }), /至少需要填写一项/)
  assert.throws(() => normalizeUserRewardInput({ transactionId: 'reward-test-3', userId: 'user-1', operatorId: 'admin-1', experienceAmount: 1, registrationFeeAmount: 0, reason: '' }), /奖励说明不能为空/)
  assert.throws(() => normalizeUserRewardInput({ transactionId: 'reward-test-4', userId: 'user-1', operatorId: 'admin-1', experienceAmount: 1.5, registrationFeeAmount: 0, reason: '投稿被采纳' }), /整数/)
})

test('数据库结构为用户奖励提供独立审计记录和幂等键', () => {
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20260814220000_add_user_rewards/migration.sql')
  assert.match(schema, /model UserReward\s*\{[\s\S]*transactionId\s+String\s+@unique[\s\S]*usernameSnapshot[\s\S]*experienceAmount[\s\S]*registrationFeeAmount/)
  assert.match(schema, /USER_REWARD/)
  assert.match(migration, /CREATE TABLE `UserReward`/)
  assert.match(migration, /UserReward_transactionId_key/)
  assert.match(migration, /'USER_REWARD'/)
})

test('奖励事务复用经验值与挂号费流水，绕过每日经验上限并防止重复请求', () => {
  const service = read('lib/user-rewards.ts')
  assert.match(service, /prisma\.\$transaction\(async \(tx\)/)
  assert.match(service, /tx\.userReward\.create/)
  assert.match(service, /tx\.experienceLog\.create/)
  assert.match(service, /awardRegistrationFee\(tx/)
  assert.match(service, /action: 'USER_REWARD'/)
  assert.match(service, /tx\.notification\.create/)
  assert.match(service, /tx\.adminActionLog\.create/)
  assert.match(service, /FOR UPDATE/)
  assert.match(service, /P2002/)
  assert.doesNotMatch(service, /dailyExpLimit|dailyExperienceRecord/)
})

test('用户奖励入口和 API 使用独立权限，且通知接入统一通知中心', () => {
  const permissionConfig = read('lib/admin-permission-config.ts')
  const adminPage = read('app/admin/page.tsx')
  const page = read('app/admin/user-rewards/page.tsx')
  const route = read('app/api/admin/user-rewards/route.ts')
  const usersRoute = read('app/api/admin/user-rewards/users/route.ts')
  const adminPermissionsRoute = read('app/api/admin/admins/route.ts')
  const notifications = read('lib/notifications.ts')
  const client = read('app/notifications/NotificationsClient.tsx')
  assert.match(permissionConfig, /user_reward_manage/)
  assert.match(adminPage, /\/admin\/user-rewards/)
  assert.match(page, /requireAdminPage\([^\n]*USER_REWARD_PERMISSION/)
  assert.match(route, /requireAdmin\(USER_REWARD_PERMISSION\)/)
  assert.match(usersRoute, /requireAdmin\(USER_REWARD_PERMISSION\)/)
  assert.match(adminPermissionsRoute, /只有超级管理员可以调整用户奖励权限/)
  assert.match(notifications, /USER_REWARD:\s*'获得奖励'/)
  assert.match(client, /USER_REWARD/)
  assert.match(client, /查看成长/)
})

test('挂号费奖励写入现有 PointLog，0 元不生成流水，历史页支持用户、时间和操作人查询', () => {
  const service = read('lib/user-rewards.ts')
  const feeService = read('lib/registration-fee.ts')
  const page = read('app/admin/user-rewards/UserRewardManager.tsx')
  assert.match(service, /registrationFeeAmount > 0/)
  assert.match(service, /getUserRewardPointBusinessKey/)
  assert.match(feeService, /USER_REWARD:\s*'获得奖励'/)
  assert.match(feeService, /points:\s*\{\s*not:\s*0\s*\}/)
  assert.match(page, /historyUserQuery/)
  assert.match(page, /historyOperatorId/)
  assert.match(page, /historyFrom/)
  assert.match(page, /historyTo/)
  assert.match(page, /奖励记录分页/)
})
