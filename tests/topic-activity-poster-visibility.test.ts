import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import { BinaryBitmap, HybridBinarizer, QRCodeReader, RGBLuminanceSource } from '@zxing/library'
import { prisma } from '@/lib/prisma'
import { createDefaultTopicActivityV2Program, readTopicActivityV2Program } from '@/lib/topic-activity-v2-config'
import { getTopicV2PosterSnapshot } from '@/lib/topic-activity-v2-interactive'
import { renderTopicV2Poster } from '@/lib/topic-activity-v2-poster'
import { HERO_SAFE_BOTTOM, TOPIC_POSTER_QR, TOPIC_POSTER_SIZE, topicPosterFooter, topicPosterLayout, topicPosterQr } from '@/lib/topic-activity-v2-poster-layout'
import { fixture } from './fixtures/topic-v2-transaction'

test('poster defaults and legacy missing flags are false; explicit saved booleans round-trip unchanged', () => {
  const defaults = createDefaultTopicActivityV2Program().test.poster
  assert.equal(defaults.showNickname, false); assert.equal(defaults.showQrCode, false)
  const legacy = fixture().program
  Reflect.deleteProperty(legacy.test.poster, 'showNickname'); Reflect.deleteProperty(legacy.test.poster, 'showQrCode')
  const read = readTopicActivityV2Program(legacy)!
  assert.equal(read.test.poster.showNickname, false); assert.equal(read.test.poster.showQrCode, false)
  for (const showNickname of [true, false]) for (const showQrCode of [true, false]) {
    const program = structuredClone(read)
    Object.assign(program.test.poster, { showNickname, showQrCode })
    assert.deepEqual(readTopicActivityV2Program(JSON.parse(JSON.stringify(program)))!.test.poster, program.test.poster)
    assert.equal(Object.hasOwn(program.test.poster, 'showActivityQr'), false, 'reuse the persisted showQrCode contract')
  }
})

const target = 'https://ecfc.fans/activities/visibility-qa'
async function decode(png: Buffer, poster: { showNickname: boolean; showQrCode: boolean }) {
  const { left, top, size } = topicPosterQr(poster)
  const { data, info } = await sharp(png).extract({ left, top, width: size, height: size }).greyscale().raw().toBuffer({ resolveWithObject: true })
  return new QRCodeReader().decode(new BinaryBitmap(new HybridBinarizer(new RGBLuminanceSource(new Uint8ClampedArray(data), info.width, info.height)))).getText()
}

for (const showNickname of [false, true]) for (const showQrCode of [false, true]) {
  test(`actual PNG visibility nickname=${showNickname} QR=${showQrCode}: no placeholders, protected hero/bottom, valid branded QR when on`, async () => {
    const poster = { showNickname, showQrCode }
    const value = { title: '结果', description: '结果说明', nickname: '私人昵称', poster }
    const svg = topicPosterLayout(value)
    assert.equal(svg.includes('私人昵称'), showNickname)
    assert.equal(svg.includes('data-poster-group="identity"'), showNickname, 'no empty identity group, avatar or name placeholder when private')
    const brand = topicPosterFooter(poster)
    assert.ok(brand.top >= 1200 && brand.top + brand.height < TOPIC_POSTER_SIZE.height - 48)
    assert.equal(brand.textLeft, brand.left + brand.width / 2)
    assert.match(svg, /text-anchor="middle"/, 'brand text stays centred in every visibility mode')
    if (showQrCode) assert.ok(brand.top >= topicPosterQr(poster).top + TOPIC_POSTER_QR.size, 'brand sits below QR with a clear gap')
    const png = await renderTopicV2Poster(value, 'visibility-qa')
    assert.deepEqual(await sharp(png).metadata().then((metadata) => [metadata.width, metadata.height]), [1080, 1440])
    for (const region of [{ left: 0, top: 0, width: 1080, height: HERO_SAFE_BOTTOM }, { left: 1020, top: 0, width: 60, height: 1440 }, { left: 0, top: 1392, width: 1080, height: 48 }]) {
      const raw = await sharp(png).extract(region).removeAlpha().raw().toBuffer()
      for (let offset = 0; offset < raw.length; offset += 3) assert.ok(raw[offset] === 16 && raw[offset + 1] === 44 && raw[offset + 2] === 72)
    }
    if (showQrCode) assert.equal(await decode(png, poster), target)
    else await assert.rejects(decode(png, poster), 'hidden QR has no decodable QR left behind')
    if (!showNickname) {
      const other = await renderTopicV2Poster({ ...value, nickname: '另一个用户', avatarUrl: 'https://invalid.example/private.png' }, 'visibility-qa')
      assert.deepEqual(png, other, 'hidden nickname/avatar cannot affect any output byte')
    }
  })
}

test('legacy snapshots with missing booleans render identically to explicit false/false', async () => {
  const value = { title: '历史结果', nickname: '旧昵称' }
  assert.deepEqual(await renderTopicV2Poster(value, 'visibility-qa'), await renderTopicV2Poster({ ...value, poster: { showNickname: false, showQrCode: false } }, 'visibility-qa'))
})

test('current saved visibility controls historical PNG without changing frozen results, scores, images or database records', async () => {
  const original = prisma.topicActivityTestAttempt.findFirst
  const frozen = { title: '冻结结果', description: '冻结说明', imageUrl: null, score: 2, nickname: '旧昵称', poster: { showNickname: true, showQrCode: true, backgroundUrl: null } }
  let current: Record<string, unknown> = { showNickname: false, showQrCode: false }
  Reflect.set(prisma.topicActivityTestAttempt, 'findFirst', async ({ where }: { where: { userId: string; activityId: string; id: string } }) => {
    assert.deepEqual(where, { id: 'attempt', activityId: 'activity', userId: where.userId })
    return where.userId === 'owner' ? { resultSnapshot: structuredClone(frozen), Activity: { topicProgram: { test: { poster: current } }, startsAt: null, endsAt: null }, User: { nickname: '当前昵称', avatarUrl: null, Profile: null } } : null
  })
  try {
    for (const showNickname of [false, true]) for (const showQrCode of [false, true]) {
      current = { showNickname, showQrCode }
      const snapshot = await getTopicV2PosterSnapshot('activity', 'attempt', 'owner')
      assert.deepEqual(snapshot.poster, { ...frozen.poster, showNickname, showQrCode })
      assert.equal(snapshot.nickname, showNickname ? '旧昵称' : null)
      for (const field of ['title', 'description', 'imageUrl', 'score'] as const) assert.equal(snapshot[field], frozen[field])
    }
    current = {}
    const legacy = await getTopicV2PosterSnapshot('activity', 'attempt', 'owner')
    assert.deepEqual(legacy.poster, { ...frozen.poster, showNickname: false, showQrCode: false })
    assert.deepEqual(frozen.poster, { showNickname: true, showQrCode: true, backgroundUrl: null })
    await assert.rejects(getTopicV2PosterSnapshot('activity', 'attempt', 'other'), { code: 'TEST_RESULT_NOT_FOUND' })
  } finally { Reflect.set(prisma.topicActivityTestAttempt, 'findFirst', original) }
})
