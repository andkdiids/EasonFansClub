import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { buildMobilePublicActivityWinnersPage, type MobilePublicActivityLottery } from '../lib/mobile-public-activity-winners'

const root = process.cwd()
const source = (path: string) => readFileSync(join(root, path), 'utf8')
function lottery(status: MobilePublicActivityLottery['status'] = 'DRAWN'): MobilePublicActivityLottery {
  return {
    status,
    prizes: [{
      winners: [{
        nickname: '院友', uid: 23, avatarUrl: 'https://ecfc.fans/avatar.png', tierName: '一等奖', prizeName: '礼品',
        wonAt: '2026-11-09T00:00:00.000Z', rewardStatus: 'PENDING', rewardAt: null,
        realName: '不可公开', phone: '不可公开', address: '不可公开', email: '不可公开', claimToken: '不可公开',
      }],
    }],
  } as unknown as MobilePublicActivityLottery
}
test('ordinary lottery results expose only paged public fields after a verified draw', () => {
  const result = buildMobilePublicActivityWinnersPage(lottery(), '1', '1')
  assert.deepEqual(result, { status: 'DRAWN', winners: [{
    nickname: '院友', uid: 23, avatarUrl: 'https://ecfc.fans/avatar.png', tierName: '一等奖', prizeName: '礼品',
    wonAt: '2026-11-09T00:00:00.000Z', rewardStatus: 'PENDING', rewardAt: null,
  }], page: 1, pageSize: 1, total: 1, totalPages: 1 })
  for (const status of ['SCHEDULED', 'RESULTS_UNAVAILABLE'] as const) {
    const hidden = buildMobilePublicActivityWinnersPage(lottery(status), '1', '1')
    assert.equal(hidden.winners.length, 0)
    assert.equal(hidden.total, 0)
  }
})
test('ordinary lottery winner pagination clamps invalid input and returns stable pages', () => {
  const value = lottery()
  value.prizes[0]!.winners.push(
    { nickname: '乙', uid: 25, avatarUrl: null, tierName: '二等奖', prizeName: '礼品B', wonAt: '2026-11-09T00:00:02.000Z', rewardStatus: 'PENDING', rewardAt: null },
    { nickname: '甲', uid: 24, avatarUrl: null, tierName: '二等奖', prizeName: '礼品A', wonAt: '2026-11-09T00:00:01.000Z', rewardStatus: 'PENDING', rewardAt: null },
  )
  assert.deepEqual(buildMobilePublicActivityWinnersPage(value, '1', '2').winners.map((row) => row.uid), [23, 24])
  assert.deepEqual(buildMobilePublicActivityWinnersPage(value, '2', '2').winners.map((row) => row.uid), [25])
  assert.equal(buildMobilePublicActivityWinnersPage(value, '1', '2').totalPages, 2)
  assert.equal(buildMobilePublicActivityWinnersPage(value, 'bad', '500').pageSize, 50)
})
test('native scheduled and ordinary lottery APIs retain owner auth and safe responses', () => {
  const scheduled = source('app/api/posts/scheduled/route.ts')
  assert.match(scheduled, /requireRequestUser\(request\)/)
  assert.match(scheduled, /authorId: guard\.user\.id/)
  assert.match(scheduled, /publicationStatus: 'SCHEDULED'/)
  assert.match(scheduled, /isDeleted: false/)
  assert.doesNotMatch(scheduled, /reviewedById|authorId:\s*true|realName|phone|address/)
  assert.match(source('app/api/posts/[postId]/schedule/route.ts'), /requireRequestUser\(request\)/)
  const winners = source('app/api/activities/[activityId]/lottery-winners/route.ts')
  assert.match(winners, /requireRequestUser\(request\)/)
  assert.match(winners, /getPublicActivityLotteries\(activityId, guard\.user\.id\)/)
  assert.doesNotMatch(winners, /address|realName|phone|claimToken/)
})
test('ordinary lottery notification preserves the Web route and marks native routing', () => {
  assert.ok(source('lib/activity-lottery.ts').includes('nativeTarget=event-center'))
})
test('ordinary activity winner API remains authenticated and safe', () => {
  const route = source('app/api/activities/[activityId]/lottery-winners/route.ts')
  assert.match(route, /if \(!guard\.user\) return guard\.response/)
  assert.match(route, /Cache-Control.*private, no-store/)
})
