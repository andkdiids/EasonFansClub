import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { after, before, test } from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import sharp from 'sharp'
import { BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from '@zxing/library'
import { prisma } from '@/lib/prisma'
import { getTopicV2PosterSnapshot, submitTopicV2Test } from '@/lib/topic-activity-v2-interactive'
import { posterTextLines, topicPosterLayout, topicPosterTimeRange } from '@/lib/topic-activity-v2-poster-layout'
import { renderTopicV2Poster } from '@/lib/topic-activity-v2-poster'
import { fixture, instant } from './fixtures/topic-v2-transaction'

test('V4 has four paper groups, real test title priority, no second image slot or sample copy', () => {
  const svg = topicPosterLayout({ activityTitle: '活动名字', testTitle: '真实测试名称', title: '真实结果', description: '真实说明' })
  for (const group of ['activity', 'result', 'identity', 'brand']) assert.match(svg, new RegExp(`data-poster-group="${group}"`))
  assert.match(svg, /真实测试名称/); assert.doesNotMatch(svg, /活动名字|KEEP YOUR|CHIN UP|结果图片区域|<image|<filter/)
  assert.match(svg, /私家E院 · ECFC/)
  assert.match(topicPosterLayout({ activityTitle: '回退活动名' }), /回退活动名/)
})

test('dates use Beijing minute precision, independently of host time zone, with safe old-result fallback', () => {
  assert.equal(topicPosterTimeRange('2026-10-15T18:40:00Z', '2026-10-16T18:40:00Z'), '2026.10.16 02:40 - 2026.10.17 02:40')
  assert.equal(topicPosterTimeRange(null, 'bad-date'), '活动时间以活动页面为准')
  assert.equal(topicPosterTimeRange('2026-10-15T18:40:00Z', null), '2026.10.16 02:40 起')
})

test('long Chinese, Latin and emoji text is escaped and bounded to safe areas', () => {
  for (const value of ['中文'.repeat(200), 'W'.repeat(500), '😀'.repeat(200), '短\n'.repeat(200)]) {
    assert.ok(posterTextLines(value, 820, 68, 2).length <= 2)
    const svg = topicPosterLayout({ title: value, description: value, nickname: value, poster: { showQrCode: true } })
    const positions = [...svg.matchAll(/<text x="118" y="(\d+)"/gu)].map((match) => Number(match[1]))
    assert.ok(positions.every((y) => y < 1420 && y > 800))
    assert.ok(svg.length < 10000)
  }
  const svg = topicPosterLayout({ title: '<script> & "unsafe"', description: '<image href="https://invalid"/>' })
  assert.doesNotMatch(svg, /<script|<image/); assert.match(svg, /&lt;script&gt;/)
})

test('test submission schema stays unchanged; poster enrichment never changes stored attempt snapshots', async () => {
  const f = fixture()
  Reflect.set(f.tx.user, 'findFirst', async () => ({ nickname: '本人', avatarUrl: '/uploads/user.png', Profile: { avatarUrl: '/uploads/profile.png' } }))
  await f.run(async () => {
    const input = { activityId: f.activity.id, userId: 'user-one', answers: { q1: 'yes' }, requestKey: 'poster-v4-one', now: instant }
    const first = await submitTopicV2Test(input)
    const snapshot = first.attempt.resultSnapshot as Record<string, unknown>
    assert.equal(Object.hasOwn(snapshot, 'activityStartsAt'), false)
    assert.equal(Object.hasOwn(snapshot, 'activityEndsAt'), false)
    assert.equal(Object.hasOwn(snapshot, 'avatarUrl'), false)
    f.activity.startsAt = new Date('2030-01-01T00:00:00Z')
    assert.deepEqual((await submitTopicV2Test(input)).attempt.resultSnapshot, snapshot)
  })
})

test('poster-only historical enrichment is owner-scoped, read-only and preserves frozen result fields/nulls', async () => {
  const original = prisma.topicActivityTestAttempt.findFirst
  const stored = { title: '旧结果', testTitle: '旧测试', imageUrl: '/uploads/old.png', poster: { showNickname: false }, activityStartsAt: null }
  Reflect.set(prisma.topicActivityTestAttempt, 'findFirst', async (query: { where: { userId: string; activityId: string; id: string } }) => {
    assert.deepEqual(query.where, { id: 'attempt-one', activityId: 'activity-one', userId: query.where.userId })
    return query.where.userId === 'owner' ? { resultSnapshot: structuredClone(stored), Activity: { startsAt: instant, endsAt: instant }, User: { avatarUrl: '/uploads/user.png', Profile: { avatarUrl: '/uploads/profile.png' } } } : null
  })
  try {
    const enriched = await getTopicV2PosterSnapshot('activity-one', 'attempt-one', 'owner')
    assert.equal(enriched.activityStartsAt, null)
    assert.equal(enriched.activityEndsAt, instant.toISOString())
    assert.equal(enriched.avatarUrl, '/uploads/profile.png')
    for (const key of Object.keys(stored)) assert.deepEqual(enriched[key], stored[key as keyof typeof stored])
    assert.equal(Object.hasOwn(stored, 'avatarUrl'), false)
    await assert.rejects(getTopicV2PosterSnapshot('activity-one', 'attempt-one', 'other'), { code: 'TEST_RESULT_NOT_FOUND' })
  } finally { Reflect.set(prisma.topicActivityTestAttempt, 'findFirst', original) }
})

let directory = '', avatarUrl = ''
before(async () => {
  await mkdir(join(process.cwd(), 'public/uploads'), { recursive: true })
  directory = await mkdtemp(join(process.cwd(), 'public/uploads/poster-v4-test-'))
  avatarUrl = '/uploads/' + directory.split(/[\\/]/u).pop() + '/avatar.png'
  await writeFile(join(directory, 'avatar.png'), await sharp({ create: { width: 300, height: 160, channels: 4, background: '#22dd44' } }).png().toBuffer())
})
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

test('avatar is real image bytes cropped into a circle; nickname toggle hides the whole identity group', async () => {
  const value = { title: '真实结果', nickname: '测试会员', avatarUrl, poster: { showNickname: true } }
  const png = await renderTopicV2Poster(value, 'activity-one')
  const pixel = async (left: number, top: number, bytes = png) => [...await sharp(bytes).extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer()]
  assert.deepEqual(await pixel(184, 1633), [34, 221, 68])
  assert.notDeepEqual(await pixel(96, 1545), [34, 221, 68], 'circle clipping excludes square corners')
  const hidden = await renderTopicV2Poster({ ...value, poster: { showNickname: false } }, 'activity-one')
  assert.notDeepEqual(await pixel(184, 1633, hidden), [34, 221, 68])
})

test('missing, external, private or malformed avatars degrade to a local initial without failing PNG', async () => {
  for (const value of [undefined, '/uploads/does-not-exist.png', '/uploads/profile/private.png', 'http://127.0.0.1:9/avatar.png', 'https://evil.invalid/x.png', '/cos/topic-activity/private/a.png', '/uploads/%2e%2e/secret.png']) {
    const png = await renderTopicV2Poster({ title: '结果', nickname: '会员', avatarUrl: value }, 'a')
    assert.equal((await sharp(png).metadata()).width, 1080)
  }
})

test('repeated fallback renders retain real title ink and a decodable QR, not just paper placeholders', async () => {
  for (let i = 0; i < 2; i++) {
    const png = await renderTopicV2Poster({ title: '新演唱会肯定有票！', nickname: '会员', poster: { showNickname: true, showQrCode: true } }, 'local-preview-only')
    const { data, info } = await sharp(png).extract({ left: 744, top: 1545, width: 240, height: 240 }).greyscale().raw().toBuffer({ resolveWithObject: true })
    const bitmap = new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(new Uint8ClampedArray(data), info.width, info.height)))
    assert.equal(new QRCodeReader().decode(bitmap).getText(), 'https://ecfc.fans/activities/local-preview-only')
    const ink = await sharp(png).extract({ left: 118, top: 830, width: 820, height: 80 }).removeAlpha().raw().toBuffer()
    let dark = 0
    for (let p = 0; p < ink.length; p += 3) if (ink[p] < 80 && ink[p + 1] < 80 && ink[p + 2] < 80) dark++
    assert.ok(dark > 1000, 'result title must visibly render')
  }
})

test('preview/download/share continue using one authenticated PNG endpoint, no new image upload field', () => {
  const ui = readFileSync(join(process.cwd(), 'components/activities/TopicActivityV2Interactive.tsx'), 'utf8')
  assert.match(ui, /poster/); assert.match(ui, /navigator\.share/)
  const route = readFileSync(join(process.cwd(), 'app/api/activities/[activityId]/v2/attempts/[attemptId]/poster/route.ts'), 'utf8')
  assert.match(route, /requireRequestUser/); assert.match(route, /getTopicV2PosterSnapshot\(activityId, attemptId, guard.user.id\)/)
  assert.match(route, /renderTopicV2Poster\(snapshot, activityId\)/)
  assert.match(route, /image\/png/)
})

test('actual poster GET rejects anonymous/foreign attempts and returns a private PNG for its owner', async () => {
  const require = createRequire(join(process.cwd(), 'package.json'))
  const loader = require('node:module') as { _load: (name: string, parent: unknown, main: boolean) => unknown }
  const originalLoad = loader._load, originalFind = prisma.topicActivityTestAttempt.findFirst
  let caller: string | null = null, reads = 0
  Reflect.set(prisma.topicActivityTestAttempt, 'findFirst', async ({ where }: { where: { id: string; activityId: string; userId: string } }) => {
    reads++
    return where.id === 'attempt-one' && where.activityId === 'activity-one' && where.userId === 'owner' ? {
      resultSnapshot: { title: '真实测试结果', testTitle: '冻结测试名', poster: { showQrCode: true } },
      Activity: { startsAt: instant, endsAt: instant }, User: { avatarUrl: null, Profile: null },
    } : null
  })
  loader._load = function (name, parent, main) {
    if (name === '@/lib/security') return { requireRequestUser: async () => caller ? { user: { id: caller } } : { user: null, response: new Response('', { status: 401 }) } }
    return originalLoad.call(this, name, parent, main)
  }
  try {
    let route: typeof import('../app/api/activities/[activityId]/v2/attempts/[attemptId]/poster/route')
    try { route = require('./app/api/activities/[activityId]/v2/attempts/[attemptId]/poster/route.ts') }
    finally { loader._load = originalLoad }
    const invoke = (activityId = 'activity-one', attemptId = 'attempt-one') => route.GET(new Request('http://localhost/api/local'), { params: Promise.resolve({ activityId, attemptId }) })
    assert.equal((await invoke()).status, 401); assert.equal(reads, 0)
    caller = 'other'; assert.equal((await invoke()).status, 404)
    caller = 'owner'; assert.equal((await invoke('other-activity')).status, 404)
    assert.equal((await invoke('activity-one', 'other-attempt')).status, 404)
    const response = await invoke()
    assert.equal(response.status, 200)
    assert.match(response.headers.get('cache-control') || '', /private.*no-store/)
    assert.equal(response.headers.get('content-type'), 'image/png')
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    const bytes = Buffer.from(await response.arrayBuffer())
    assert.equal(Number(response.headers.get('content-length')), bytes.length)
    assert.deepEqual(await sharp(bytes).metadata().then((m) => [m.width, m.height]), [1080, 1920])
  } finally { loader._load = originalLoad; Reflect.set(prisma.topicActivityTestAttempt, 'findFirst', originalFind) }
})
