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

test('6/DELETE 精确删除成绩接口存在且受管理员鉴权保护，POST 仍统一走 action', () => {
  // DELETE 方法已合法提供，用于精确删除单条成绩
  assert.match(route, /export async function DELETE\(request: Request\)/)
  // DELETE 必须做来源校验 + 管理员权限校验
  assert.match(route, /export async function DELETE[\s\S]*?rejectInvalidRequestOrigin\(request\)/)
  assert.match(route, /export async function DELETE[\s\S]*?requireAdmin\('entertainment_manage'\)/)
  // 精确删除的查询参数入口
  assert.match(route, /deleteWantListenUserScore/)
  // POST 仍统一通过 body?.action 分发（清除/补录/删除成绩）
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
  const modelStart = schema.indexOf('model LeaderboardAdminLog {')
  const modelEnd = schema.indexOf('\n}', modelStart)
  assert.ok(modelStart >= 0 && modelEnd > modelStart, 'LeaderboardAdminLog 模型应存在且可独立解析')
  const auditModel = schema.slice(modelStart, modelEnd + 2)
  assert.doesNotMatch(auditModel, /onDelete: Cascade/)
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

// ---------- 想听排行榜补录（统一计分：异常游戏恢复优先，人工补题次之） ----------

import { getWantListenPeriod, isWantListenScoreBetter } from '@/lib/want-listen-period'

test('12/补录路由：POST 支持 PREVIEW_BACKFILL / BACKFILL，且 requireAdmin 服务端校验权限（普通用户 403）', () => {
  assert.match(route, /requireAdmin\('entertainment_manage'\)/)
  assert.match(route, /previewOrApplyWantListenBackfill/)
  assert.match(route, /body\?\.action === 'PREVIEW_BACKFILL' \|\| body\?\.action === 'BACKFILL'/)
  assert.match(route, /readWantListenAdminSession/)
  assert.match(route, /view'\) === 'rows'/)
  assert.match(route, /view'\) === 'recoverable'/)
  // 想听沿用同一权限体系：entertainment_manage（与听听一致）
  assert.match(permissions, /want-listen\/leaderboard[\s\S]*'entertainment_manage'/)
})

test('13/补录数据逻辑：排行榜保留「单局最高」完整记录，字段不来自不同记录', () => {
  // 补 28770 vs 原 12000 → 更好 → 覆盖
  const base = { score: 12000, correctCount: 230, maxStreak: 89, completionTimeMs: 1800000, achievedAt: new Date('2026-08-18T23:30:00+08:00') }
  const higher = { ...base, score: 28770 }
  assert.equal(isWantListenScoreBetter(higher, base), true, '补 28770 应覆盖 12000')
  // 已有 30000 补 28770 → 不更好 → 不覆盖（保持 30000）
  const best = { ...base, score: 30000 }
  assert.equal(isWantListenScoreBetter(higher, best), false, '已有 30000 补 28770 不应覆盖')
  // 服务端用 isWantListenScoreBetter 决定是否写入，且最终聚合走 recordWantListenLeaderboard（整行覆盖）
  assert.match(service, /isWantListenScoreBetter\(/)
  assert.match(service, /recordWantListenLeaderboard\(session\.id, tx\)/)
})

test('14/补录周期按「成绩发生时间」计算：历史日期归属当日/本周/全部榜', () => {
  const achievedAt = new Date('2026-08-18T23:30:00+08:00')
  const day = getWantListenPeriod('DAY', achievedAt)
  const week = getWantListenPeriod('WEEK', achievedAt)
  assert.equal(day.periodKey, '2026-08-18', 'DAY 应归属 8 月 18 日')
  assert.ok(week.periodKey.startsWith('2026-08-'), `WEEK 应归属 8 月所在周（实际 ${week.periodKey}）`)
  assert.equal(getWantListenPeriod('ALL', achievedAt).periodKey, 'ALL')
  // 服务端通过 affectedPeriodsOf(playedAt) 统一计算当日/本周/全部归属
  assert.match(service, /affectedPeriodsOf\(/)
  assert.match(service, /getWantListenPeriod\(periodType, achievedAt\)/)
})

test('15/补录支持异常 Session 恢复 + 人工补题 + 完整审计日志，不再使用 MANUAL_SCORE', () => {
  assert.match(service, /SESSION_RECOVERY/)
  assert.match(service, /MANUAL_QUESTION_ADJUSTMENT/)
  assert.match(service, /previewOrApplyWantListenBackfill/)
  assert.match(service, /readWantListenAdminSession/)
  assert.match(service, /beforeScore/)
  assert.match(service, /afterScore/)
  assert.match(service, /beforeCorrectCount/)
  assert.match(service, /afterCorrectCount/)
  assert.match(service, /beforeCompletedCount/)
  assert.match(service, /afterCompletedCount/)
  assert.match(service, /beforeMaxStreak/)
  assert.match(service, /afterMaxStreak/)
  assert.match(service, /sourceSessionId/)
  assert.match(service, /playedAt: playedAt\.toISOString\(\)/)
  assert.doesNotMatch(service, /WANT_LISTEN_ADD_SCORE/)
  assert.doesNotMatch(service, /MANUAL_SCORE/)
  // 从 Session 读取接口
  assert.match(route, /view'\) === 'session'/)
  assert.match(service, /readWantListenAdminSession\(rawSessionId/)
})

test('16/补录 UI：异常游戏恢复优先 + 人工补题 + 预览，不再出现「请输入补录分数」', () => {
  const guessManager = source('app/admin/entertainment/guess-song/GuessSongLeaderboardManager.tsx')
  // 想听补录使用与听听一致的容器结构（Tailwind 类）
  assert.match(manager, /rounded-2xl border border-sky-100 bg-white p-5 shadow-sm/)
  // 说明文案按需求第 18 节调整
  assert.match(manager, /想听排行榜按完整单局成绩排名。/)
  assert.match(manager, /系统将按照当前模式计分规则自动计算分数/)
  // 补录方式：异常恢复优先、人工补题次之
  assert.match(manager, /从异常游戏恢复/)
  assert.match(manager, /人工补题/)
  // 补录字段为答题数据，不再是分数
  assert.match(manager, /补回答对题数/)
  assert.match(manager, /补回答错题数/)
  assert.doesNotMatch(manager, /请输入补录分数/)
  assert.doesNotMatch(manager, /最终成绩/)
  // 听听原有结构不被本次改动破坏
  assert.match(guessManager, /rounded-2xl border border-sky-100 bg-white p-5 shadow-sm/)
})
