import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

// 想听排行榜管理（后台）测试：源码结构校验 + 纯函数测试，不连真实数据库。
// 覆盖需求 一~八：
//   - 管理员总览 / 清空全部 / 按模式 / 按用户
//   - 普通用户 403（requireAdmin 服务端校验）
//   - 只删 WantListenLeaderboardEntry，事务 + 计数 + 操作日志
//   - 不提供直接 DELETE API
//   - 前台二次确认文案
//   - LeaderboardAdminLog 模型与 migration 一致

const root = join(process.cwd())

function source(relativePath: string) {
  return readFileSync(join(root, relativePath), 'utf8')
}

import {
  isLeaderboardClearAction,
  isWantListenAdminMode,
  leaderboardModeLabel,
  startOfDay,
  startOfWeek,
  WANT_LISTEN_ADMIN_MODES,
} from '@/lib/want-listen-admin-leaderboard'

const route = source('app/api/admin/entertainment/want-listen/leaderboard/route.ts')
const service = source('lib/want-listen-admin-leaderboard.ts')
const manager = source('app/admin/entertainment/want-listen/leaderboard/WantListenLeaderboardManager.tsx')
const page = source('app/admin/entertainment/want-listen/leaderboard/page.tsx')
const navigation = source('app/admin/page.tsx')
const permissions = source('lib/admin-permission-config.ts')
const schema = source('prisma/schema.prisma')
const migration = source('prisma/migrations/20260819160000_add_leaderboard_admin_log/migration.sql')

test('1/管理员可清空全部排行榜（空条件 + 事务 + 计数 + 日志）', () => {
  assert.match(service, /prisma\.\$transaction/)
  // 删除前计数
  assert.match(service, /beforeCount = await tx\.wantListenLeaderboardEntry\.count/)
  // 只删除排行榜表
  assert.match(service, /tx\.wantListenLeaderboardEntry\.deleteMany/)
  // 写操作日志
  assert.match(service, /tx\.leaderboardAdminLog\.create/)
  // 日志记录管理员快照（审计安全）
  assert.match(service, /adminUid: input\.adminUid/)
  assert.match(service, /adminNickname: input\.adminNickname/)
  assert.match(service, /adminUsername: input\.adminUsername/)
  // CLEAR_ALL 时 where 为空（清空全部）
  assert.match(service, /action === 'CLEAR_ALL' \? 'ALL' : undefined/)
})

test('2/管理员可按模式清除（CLEAR_MODE + mode 过滤）', () => {
  assert.match(service, /action === 'CLEAR_MODE'/)
  assert.match(service, /where\.mode = mode/)
  assert.match(service, /isWantListenAdminMode\(input\.mode\)/)
  assert.match(service, /gameType: action === 'CLEAR_MODE' \? mode \?\? undefined/)
})

test('3/管理员可清除指定用户（CLEAR_USER + userId 过滤）', () => {
  assert.match(service, /action === 'CLEAR_USER'/)
  assert.match(service, /where\.userId = targetUserId/)
  assert.match(service, /targetUserId: targetUserId \?\? undefined/)
})

test('4/普通用户无法调用：路由服务端 requireAdmin 校验 + 来源校验', () => {
  assert.match(route, /requireAdmin\('entertainment_manage'\)/)
  assert.match(route, /rejectInvalidRequestOrigin\(request\)/)
  // 页面侧同样要求管理员
  assert.match(page, /requireAdminPage\([^,]+, 'entertainment_manage'\)/)
})

test('5/删除只影响排行榜：服务不触碰会话/统计/用户/反作弊/成就', () => {
  assert.doesNotMatch(service, /wantListenSession\.delete|wantListenSessionQuestion\.delete|wantListenStats\.delete|user\.delete|gameAntiCheatLog\.delete|userAchievement\.delete/)
  assert.match(service, /仅 WantListenLeaderboardEntry/)
})

test('6/不提供直接 DELETE API，统一走 POST action', () => {
  assert.doesNotMatch(route, /export async function DELETE/)
  assert.match(route, /CLEAR_ALL \/ CLEAR_MODE \/ CLEAR_USER/)
  assert.match(route, /body\?\.action/)
})

test('7/前台二次确认文案包含安全提示', () => {
  assert.match(manager, /确认清空全部想听排行榜数据/)
  assert.match(manager, /不会删除/)
  assert.match(manager, /用户数据/)
  assert.match(manager, /游戏记录/)
  assert.match(manager, /成就/)
  assert.match(manager, /反作弊日志/)
  assert.match(manager, /删除后用户需要重新挑战进入排行榜/)
  // 清除必须填原因
  assert.match(manager, /请填写清除原因（必填）/)
})

test('8/后台入口：权限映射 + 导航链接', () => {
  assert.match(permissions, /'\/admin\/entertainment\/want-listen\/leaderboard': 'entertainment_manage'/)
  assert.match(navigation, /\/admin\/entertainment\/want-listen\/leaderboard/)
  assert.match(navigation, /想听排行榜/)
})

test('9/LeaderboardAdminLog 模型与 migration 一致', () => {
  assert.match(schema, /model LeaderboardAdminLog \{/)
  for (const field of ['adminId', 'action', 'targetUserId', 'gameType', 'deletedCount', 'reason', 'createdAt', 'adminUid', 'adminNickname', 'adminUsername']) {
    assert.match(schema, new RegExp(`\\b${field}\\b`))
  }
  assert.match(migration, /CREATE TABLE `LeaderboardAdminLog`/)
  assert.match(migration, /`deletedCount` INT NOT NULL DEFAULT 0/)
  assert.match(migration, /INDEX `LeaderboardAdminLog_adminId_createdAt_idx`/)
})

test('9b/审计安全：adminId 不级联删除，保留管理员快照', () => {
  // 管理员被永久删除时，历史操作日志不得级联消失
  assert.match(schema, /adminId\s+String\?/) // 可空，删除后置空
  assert.match(schema, /onDelete: SetNull/)
  assert.doesNotMatch(schema, /model LeaderboardAdminLog \{[\s\S]*?onDelete: Cascade[\s\S]*?\}/)
  // 快照字段：日志自包含，管理员删除后仍可追溯
  assert.match(schema, /adminUid\s+Int\?/)
  assert.match(schema, /adminNickname\s+String\?\s+@db\.VarChar\(64\)/)
  assert.match(schema, /adminUsername\s+String\?\s+@db\.VarChar\(64\)/)
  // migration 同样不使用 CASCADE
  assert.doesNotMatch(migration, /adminId_fkey[\s\S]*?ON DELETE CASCADE/)
  assert.match(migration, /adminId_fkey[\s\S]*?ON DELETE SET NULL/)
  assert.match(migration, /`adminUid` INT NULL/)
})

test('10/纯函数：模式与操作类型校验', () => {
  assert.equal(isWantListenAdminMode('WANT_LISTEN'), true)
  assert.equal(isWantListenAdminMode('CANTONESE_FRAGMENT'), true)
  assert.equal(isWantListenAdminMode('FALSE_TITLE'), true)
  assert.equal(isWantListenAdminMode('EASY'), false)
  assert.equal(isLeaderboardClearAction('CLEAR_ALL'), true)
  assert.equal(isLeaderboardClearAction('CLEAR_MODE'), true)
  assert.equal(isLeaderboardClearAction('CLEAR_USER'), true)
  assert.equal(isLeaderboardClearAction('DELETE'), false)
  assert.deepEqual(WANT_LISTEN_ADMIN_MODES, ['WANT_LISTEN', 'CANTONESE_FRAGMENT', 'FALSE_TITLE'])
  assert.equal(leaderboardModeLabel('WANT_LISTEN'), '想听')
  assert.equal(leaderboardModeLabel('FALSE_TITLE'), '防不胜防')
})

test('11/纯函数：今日/本周起点（周一为一周起点）', () => {
  const now = new Date('2026-08-19T15:00:00+08:00') // 周三
  const day = startOfDay(now)
  assert.equal(day.getHours(), 0)
  assert.equal(day.getMinutes(), 0)
  const week = startOfWeek(now)
  assert.equal(week.getDay(), 1, '应为周一')
  assert.equal(week.getHours(), 0)
})
