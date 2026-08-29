import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { findPotentialDuplicateConcerts, parseContributionPayload } from '../lib/music-contributions'

const read = (path: string) => readFileSync(path, 'utf8')

test('场次投稿只保留允许字段，不接受审核状态或创建者身份', () => {
  const result = parseContributionPayload('SHOW', {
    tourId: 'tour-1', city: '香港', countryOrRegion: '中国', venue: '红馆', concertDate: '2026-08-01', startTime: '20:00', title: '香港站',
    status: 'PUBLISHED', sortOrder: 999, contributorUserId: 'attacker', submitterId: 'attacker', reviewerId: 'attacker',
  })
  assert.ok(result.payload && 'tourId' in result.payload)
  assert.equal('status' in result.payload, false)
  assert.equal('contributorUserId' in result.payload, false)
  assert.equal('reviewerId' in result.payload, false)
})

test('用户歌单和 Encore 必须绑定明确场次并使用曲库 songId', () => {
  assert.match(parseContributionPayload('SETLIST', { targetShowId: 'concert-1', items: [{ displayName: '任意文本' }] }, { requireSongId: true }).message || '', /曲库|歌曲/)
  const result = parseContributionPayload('ENCORE', { targetShowId: 'concert-1', items: [{ songId: 'song-1', section: 'MAIN' }] }, { requireSongId: true })
  assert.ok(result.payload && 'targetShowId' in result.payload)
  if (result.payload && 'items' in result.payload) assert.equal(result.payload.items[0].isEncore, true)
})

test('重复场次检测按巡演、城市和 UTC 日期查询，且可排除当前正式场次', async () => {
  let received: unknown
  const db = { musicConcert: { findMany: async (args: unknown) => { received = args; return [] } } }
  await findPotentialDuplicateConcerts(db, { tourId: 'tour-1', city: '香港', countryOrRegion: '中国', venue: null, concertDate: '2026-08-01', startTime: null, endTime: null, title: null, posterUrl: null, description: null, stageType: 'NORMAL' }, 'existing')
  const where = (received as { where: { id: { not: string }; tourId: string; city: string; concertDate: { gte: Date; lt: Date } } }).where
  assert.equal(where.tourId, 'tour-1')
  assert.equal(where.city, '香港')
  assert.equal(where.id.not, 'existing')
  assert.equal(where.concertDate.gte.toISOString(), '2026-08-01T00:00:00.000Z')
})

test('投稿审核使用事务、行锁和 PENDING 条件，重复审核不能重复发布', () => {
  const service = read('lib/music-contributions.ts')
  assert.match(service, /prisma\.\$transaction/)
  assert.match(service, /FOR UPDATE/)
  assert.match(service, /where: \{ id: contributionId, status: 'PENDING' \}/)
  assert.match(service, /claimed\.count !== 1/)
  assert.match(service, /status: 'APPROVED'/)
  assert.match(service, /target\.setlistContributorUserId \|\| current\.submitterId/)
  assert.match(service, /target\.encoreContributorUserId \|\| current\.submitterId/)
})

test('所有权、状态和管理员权限由服务端路由校验', () => {
  const userRoute = read('app/api/music/concerts/contributions/[id]/route.ts')
  const adminRoute = read('app/api/admin/music/concerts/contributions/[id]/approve/route.ts')
  assert.match(userRoute, /where: \{ id, submitterId: guard\.user\.id \}/)
  assert.match(userRoute, /current\.status !== 'PENDING'/)
  assert.match(userRoute, /status: 'PENDING'/)
  assert.match(adminRoute, /requireAdmin\('music_manage'\)/)
  assert.match(adminRoute, /approveConcertContribution/)
})

test('审核通知使用正式资料链接，投稿功能不接入任何奖励服务', () => {
  const service = read('lib/music-contributions.ts')
  assert.match(service, /safeNotificationWrite/)
  assert.match(service, /upsertNotification\(notification\)/)
  assert.match(service, /资料已经进入 Eason in Concert 正式数据体系/)
  for (const path of [
    'lib/music-contributions.ts',
    'app/api/music/concerts/contributions/route.ts',
    'app/api/admin/music/concerts/contributions/[id]/approve/route.ts',
  ]) {
    const source = read(path)
    assert.doesNotMatch(source, /awardRegistrationFee|awardExperience|experience\.increment|UserAchievement|achievement/i)
  }
})

test('前台来源组件只在存在 contributor 时显示，并实时使用 nickname 与 UID', () => {
  const source = read('components/music/ConcertContributorAttribution.tsx')
  assert.match(source, /if \(!contributor \|\| !contributor\.uid \|\| !contributor\.nickname\) return null/)
  assert.match(source, /contributor\.nickname/)
  assert.match(source, /contributor\.uid/)
  assert.match(source, /\/user\//)
})
