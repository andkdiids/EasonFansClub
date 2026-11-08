import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  getActivityLotteryRecordIntegrityIssues,
  groupActivityLotteryWinnersByPrize,
  hasCompleteActivityLotteryPublicRecords,
  isActivityLotteryPubliclyComplete,
  type PublicLotteryWinnerRecord,
} from '@/lib/activity-lottery-records'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')

test('只有带实际开奖时间和已记录人数的正式开奖批次可以公开', () => {
  assert.equal(isActivityLotteryPubliclyComplete({ status: 'SCHEDULED', drawnAt: null, winnerCount: null }), false)
  assert.equal(isActivityLotteryPubliclyComplete({ status: 'DRAWN', drawnAt: null, winnerCount: 2 }), false)
  assert.equal(isActivityLotteryPubliclyComplete({ status: 'DRAWN', drawnAt: new Date('2026-10-01T00:00:00Z'), winnerCount: null }), false)
  assert.equal(isActivityLotteryPubliclyComplete({ status: 'DRAWN', drawnAt: new Date('2026-10-01T00:00:00Z'), winnerCount: 2 }), true)
  assert.equal(isActivityLotteryPubliclyComplete({ status: 'CANCELLED', drawnAt: new Date('2026-10-01T00:00:00Z'), winnerCount: 2 }), true)
  assert.equal(isActivityLotteryPubliclyComplete({ status: 'CANCELLED', drawnAt: null, winnerCount: null }), false)
})

test('历史记录不完整时不公开部分中奖行，也不推测缺失奖品', () => {
  const lottery = { status: 'DRAWN' as const, drawnAt: new Date('2026-10-01T00:00:00Z'), winnerCount: 2 }
  assert.equal(hasCompleteActivityLotteryPublicRecords(lottery, [
    { prizeId: 'prize-1', hasPrize: true, hasUser: true },
    { prizeId: null, hasPrize: false, hasUser: true },
  ]), false)
  assert.equal(hasCompleteActivityLotteryPublicRecords(lottery, [
    { prizeId: 'prize-1', hasPrize: true, hasUser: true },
  ]), false)
  assert.deepEqual(getActivityLotteryRecordIntegrityIssues({ ...lottery, entries: [
    { prizeId: 'prize-1', hasPrize: true },
    { prizeId: null, hasPrize: false },
  ] }), ['存在未关联奖品的中奖记录'])
})

test('管理员记录完整性提示覆盖开奖时间、中奖人数及奖品关联缺失', () => {
  assert.deepEqual(getActivityLotteryRecordIntegrityIssues({
    status: 'DRAWN',
    drawnAt: null,
    winnerCount: 2,
    entries: [{ prizeId: 'prize-1', hasPrize: true }],
  }), [
    '缺少实际开奖时间，未向前台公开',
    '声明中奖人数 2 与已保存中奖记录数 1 不一致',
  ])
  assert.deepEqual(getActivityLotteryRecordIntegrityIssues({ status: 'SCHEDULED', drawnAt: null, winnerCount: null, entries: [] }), [])
  assert.deepEqual(getActivityLotteryRecordIntegrityIssues({ status: 'CANCELLED', drawnAt: null, winnerCount: 1, entries: [{ prizeId: 'prize-1', hasPrize: true }] }), [
    '缺少实际开奖时间，未向前台公开',
  ])
})

test('多奖品中奖记录按奖品分组且不合并重复用户记录', () => {
  const prizes: Array<{ id: string; name: string; winners: PublicLotteryWinnerRecord[] }> = [
    { id: 'prize-a', name: '周边礼包', winners: [] },
    { id: 'prize-b', name: '限定徽章', winners: [] },
  ]
  const winner = (prizeId: string, wonAt: string) => ({
    prizeId,
    nickname: '公开昵称',
    uid: 1001,
    avatarUrl: 'https://cdn.example/avatar.webp',
    tierName: '一等奖',
    prizeName: prizeId === 'prize-a' ? '周边礼包' : '限定徽章',
    createdAt: wonAt,
    wonAt,
    rewardStatus: 'FULFILLED' as const,
    rewardAt: wonAt,
  })
  const grouped = groupActivityLotteryWinnersByPrize(prizes, [winner('prize-a', '2026-10-01T00:00:00Z'), winner('prize-b', '2026-10-02T00:00:00Z')], true)
  assert.equal(grouped[0]?.winners.length, 1)
  assert.equal(grouped[1]?.winners.length, 1)
  assert.equal(grouped[0]?.winners[0]?.nickname, grouped[1]?.winners[0]?.nickname)
  assert.equal('userId' in (grouped[0]?.winners[0] || {}), false)
  assert.deepEqual(groupActivityLotteryWinnersByPrize(prizes, [winner('prize-a', '2026-10-01T00:00:00Z')], false).map((prize) => prize.winners), [[], []])
})

test('开奖记录复用既有开奖结果、开奖服务及 activity_manage 管理权限', () => {
  const service = read('lib/activity-lottery.ts')
  const publicPanel = read('components/activities/ActivityLotteryPanel.tsx')
  const adminManager = read('components/activities/ActivityLotteryManager.tsx')
  const adminRoute = read('app/api/admin/activities/[activityId]/lotteries/route.ts')
  assert.match(service, /tx\.lotteryEntry\.create\(/)
  assert.match(service, /drawSource: options\.trigger/)
  assert.match(service, /completedLotteryIds/)
  assert.match(service, /hasCompleteActivityLotteryPublicRecords/)
  assert.match(service, /getActivityLotteryRecordIntegrityIssues/)
  assert.match(publicPanel, /中奖名单/)
  assert.match(publicPanel, /prize\.winners\.map/)
  assert.match(adminManager, /开奖记录/)
  assert.match(adminManager, /recordBatchFilter/)
  assert.match(adminManager, /recordPrizeFilter/)
  assert.match(adminManager, /recordUserFilter/)
  assert.match(adminRoute, /requireAdmin\('activity_manage'\)/)
})

test('公开赢家查询只取公开昵称、头像与 E院ID，不序列化内部主键或联系方式', () => {
  const service = read('lib/activity-lottery.ts')
  const userProjection = service.match(/User: \{ select: \{ id: true, uid: true, nickname: true, nicknameModerationStatus: true, nicknameViolationDisplay: true, avatarUrl: true, Profile: \{ select: \{ avatarUrl: true \} \} \} \}/)
  assert.ok(userProjection)
  // `uid` is the public E院ID used for the profile link; internal primary keys
  // and contact fields must never be projected to the public winner list.
  assert.doesNotMatch(userProjection?.[0] || '', /phone|email|username|userId|realName|idCard/)
  assert.match(userProjection?.[0] || '', /uid: true/)
  assert.match(service, /nickname: getPublicUserDisplayName\(entry\.User\)/)
  assert.match(service, /avatarUrl: publicImageVariantUrl\(/)
})

test('迁移用可空字段保留历史来源未知事实，且新开奖只写真实触发来源', () => {
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20261105090000_add_activity_lottery_draw_source/migration.sql')
  const service = read('lib/activity-lottery.ts')
  assert.match(schema, /drawSource\s+String\?\s+@db\.VarChar\(32\)/)
  assert.match(migration, /ADD COLUMN `drawSource` VARCHAR\(32\) NULL/)
  assert.doesNotMatch(migration, /UPDATE `?Lottery`|DEFAULT\s+'(SCHEDULED|ADMIN_MANUAL)'/i)
  assert.match(service, /drawSource: options\.trigger/)
  assert.match(service, /row\.drawSource === 'SCHEDULED' \|\| row\.drawSource === 'ADMIN_MANUAL' \? row\.drawSource : null/)
})
