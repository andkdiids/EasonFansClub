import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

/**
 * Source-contract tests: pin the wiring that cannot be observed from pure
 * helpers — cron scheduling, auth gates, ledger/badge/notification reuse,
 * migration presence and the Web-only boundary.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

test('结算引擎复用权威取数与钱包/勋章/通知服务', () => {
  const engine = read('lib/leaderboard-rewards-settlement.ts')
  assert.match(engine, /import \{ awardRegistrationFee \} from '@\/lib\/registration-fee'/)
  assert.match(engine, /import \{ grantBadgeWithTransaction \} from '@\/lib\/badge-service'/)
  assert.match(engine, /import \{ upsertNotificationWithDb \} from '@\/lib\/notification-write'/)
  // Force a row lock on User inside awardRegistrationFee (via the shared ledger).
  assert.match(engine, /isolationLevel: 'ReadCommitted'/)
  assert.match(engine, /runId: run\.id/)
  assert.match(engine, /status: STATUS\.completed/)
  assert.match(engine, /status: STATUS\.failed/)
})

test('结算引擎：三个独立类别上限、月榜不占额度、勋章顺延去重', () => {
  const engine = read('lib/leaderboard-rewards-settlement.ts')
  assert.match(engine, /THREE independent 270 caps/)
  assert.match(engine, /weeklyCap: config\.entertainment\.weeklyCap/)
  assert.match(engine, /weeklyCap: cfg\.weeklyCap/)
  // Monthly path explicitly passes null cap (no weekly budget consumed).
  assert.match(engine, /weeklyCap: null, capPeriodKey: '', now/)
  assert.match(engine, /resolveBadgeAwards\(\[dashboard\.comment\], owned, 3\)/)
  assert.match(engine, /resolveBadgeAwards\(entertainment, owned, 3\)/)
})

test('首次上线历史保护：周期早于生效时间则跳过', () => {
  const engine = read('lib/leaderboard-rewards-settlement.ts')
  assert.match(engine, /isPeriodAfterGoLive\(period, config\.enabledAt\)/)
  assert.match(engine, /PERIOD_BEFORE_GO_LIVE/)
  const api = read('app/api/admin/leaderboard-rewards/route.ts')
  assert.match(api, /validated\.enabledAt = new Date\(\)\.toISOString\(\)/)
})

test('cron 调度：周一 06:00 周榜、月初 06:00 月榜，月初周一两者都运行', () => {
  const cron = read('ops/cron/leaderboard-rewards.cron.example')
  assert.match(cron, /CRON_TZ=Asia\/Shanghai/)
  assert.match(cron, /0 6 \* \* 1 .*LEADERBOARD_SETTLEMENT_KIND=weekly/)
  assert.match(cron, /0 6 1 \* \* .*LEADERBOARD_SETTLEMENT_KIND=monthly/)
  const script = read('scripts/run-leaderboard-rewards.sh')
  assert.match(script, /weekly\|monthly/)
  assert.match(script, /x-daily-job-secret/)
})

test('internal cron route 用 DAILY_JOB_SECRET 鉴权并读配置', () => {
  const route = read('app/api/internal/daily-jobs/leaderboard-rewards/route.ts')
  assert.match(route, /timingSafeEqual/)
  assert.match(route, /x-daily-job-secret/)
  assert.match(route, /getLeaderboardRewardsConfig\(\)/)
  assert.match(route, /runLeaderboardSettlement\(\{ kind, config, now \}\)/)
  assert.match(route, /body\.kind === 'monthly' \? 'monthly' : 'weekly'/)
  // middleware lets the secret-authenticated cron caller through.
  const mw = read('middleware.ts')
  assert.match(mw, /\/api\/internal\/daily-jobs\/leaderboard-rewards/)
})

test('admin API：site_config_manage 权限 + Origin 校验 + 普通用户无法触发结算', () => {
  const api = read('app/api/admin/leaderboard-rewards/route.ts')
  assert.match(api, /requireAdmin\('site_config_manage'\)/)
  assert.match(api, /rejectInvalidRequestOrigin\(request\)/)
  assert.match(api, /retryLeaderboardSettlement/)
  const page = read('app/admin/leaderboard-rewards/page.tsx')
  assert.match(page, /requireAdminPage\('\/admin\/leaderboard-rewards', 'site_config_manage'\)/)
})

test('迁移：新增 2 个流水枚举 + 5 张表，纯增量无历史改写', () => {
  const migration = read('prisma/migrations/20261126060000_add_leaderboard_auto_rewards/migration.sql')
  assert.match(migration, /LEADERBOARD_WEEKLY_REWARD/)
  assert.match(migration, /LEADERBOARD_MONTHLY_REWARD/)
  assert.match(migration, /CREATE TABLE `LeaderboardRewardSettings`/)
  assert.match(migration, /CREATE TABLE `LeaderboardSettlementRun`/)
  assert.match(migration, /CREATE TABLE `LeaderboardWeeklyCapUsage`/)
  assert.match(migration, /CREATE TABLE `LeaderboardRewardGrant`/)
  assert.match(migration, /CREATE TABLE `LeaderboardBadgeGrant`/)
  assert.match(migration, /additive only/i)
  const schema = read('prisma/schema.prisma')
  assert.match(schema, /model LeaderboardSettlementRun/)
  assert.match(schema, /@@unique\(\[kind, periodKey\]\)/)
})

test('通知文案与口令一致', () => {
  const engine = read('lib/leaderboard-rewards-settlement.ts')
  assert.match(engine, /奖励 \$\{actual\} 挂号费/)
  assert.match(engine, /额外奖励 \$\{actual\} 挂号费/)
  assert.match(engine, /恭喜你获得『谢谢侬』勋章！/)
  assert.match(engine, /恭喜你获得『K歌之王』勋章！/)
})

test('Web only：本次变更未触碰 Android / APK 文件', () => {
  // Contract pin: no android source paths appear in any new module.
  const files = [
    'lib/leaderboard-rewards-settlement.ts',
    'lib/leaderboard-rewards-sources.ts',
    'lib/leaderboard-rewards-config.ts',
    'app/api/internal/daily-jobs/leaderboard-rewards/route.ts',
    'app/api/admin/leaderboard-rewards/route.ts',
  ]
  for (const file of files) {
    const content = read(file)
    assert.doesNotMatch(content, /android|apk/i, `${file} must not reference Android`)
  }
  assert.ok(existsSync(join(process.cwd(), 'lib/leaderboard-rewards-settlement.ts')))
})
