import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import sharp from 'sharp'
import { prisma } from '@/lib/prisma'
import { getTopicV2PosterSnapshot } from '@/lib/topic-activity-v2-interactive'
import { renderTopicV2Poster } from '@/lib/topic-activity-v2-poster'
import { HERO_SAFE_BOTTOM, topicPosterLayout } from '@/lib/topic-activity-v2-poster-layout'

let directory = '', currentUrl = '', oldUrl = ''
before(async () => {
  await mkdir(join(process.cwd(), 'public/uploads'), { recursive: true })
  directory = await mkdtemp(join(process.cwd(), 'public/uploads/poster-presentation-'))
  const current = await sharp(Buffer.from('<svg width="1080" height="1440"><rect width="1080" height="1440" fill="#228844"/><rect width="60" height="60" fill="#ee2233"/><rect x="1020" y="1380" width="60" height="60" fill="#2244ee"/></svg>')).png().toBuffer()
  await writeFile(join(directory, 'current.png'), current)
  await writeFile(join(directory, 'old.png'), await sharp({ create: { width: 1080, height: 1440, channels: 4, background: '#992211' } }).png().toBuffer())
  currentUrl = `/uploads/${basename(directory)}/current.png`
  oldUrl = `/uploads/${basename(directory)}/old.png`
})
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

async function pixel(png: Buffer, left: number, top: number) {
  return [...await sharp(png).extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer()]
}
function posterBackground(snapshot: Record<string, unknown>) {
  const poster = snapshot.poster
  return poster && typeof poster === 'object' && 'backgroundUrl' in poster
    ? poster.backgroundUrl
    : undefined
}

test('shared poster background wins; first legacy result and frozen snapshot remain read-only fallbacks', async () => {
  const original = prisma.topicActivityTestAttempt.findFirst
  const frozen = { resultId: 'second', testId: 'test-one', version: 1, title: '冻结结果', description: '冻结说明', score: 2, imageUrl: null as string | null, poster: { backgroundUrl: null } }
  const testConfig = { id: 'test-one', version: 1, results: [{ id: 'first', imageUrl: oldUrl }, { id: 'second', imageUrl: currentUrl }], poster: { backgroundUrl: null as string | null, showNickname: false, showQrCode: false } }
  let resultId = 'second', configVersion = 1
  const beforeSnapshot = structuredClone(frozen)
  Reflect.set(prisma.topicActivityTestAttempt, 'findFirst', async ({ where }: { where: { userId: string } }) => where.userId === 'owner' ? {
    testId: 'test-one', configVersion, resultId, resultSnapshot: structuredClone(frozen),
    Activity: { topicProgram: { test: testConfig }, startsAt: null, endsAt: null }, User: { nickname: '会员', avatarUrl: null, Profile: null },
  } : null)
  try {
    const resolve = () => getTopicV2PosterSnapshot('activity', 'attempt', 'owner')
    const snapshot = await resolve()
    assert.equal(posterBackground(snapshot), oldUrl, 'first nonempty legacy result artwork is shared by every result')
    assert.equal(snapshot.imageUrl, null, 'the frozen result image remains unchanged')
    const png = await renderTopicV2Poster(snapshot, 'activity')
    assert.deepEqual(await sharp(png).metadata().then((metadata) => [metadata.width, metadata.height]), [1080, 1440])
    assert.deepEqual(await pixel(png, 500, 1100), [153, 34, 17], 'legacy artwork stays visible behind transparent layout')
    const alpha = await sharp(Buffer.from(topicPosterLayout(snapshot))).ensureAlpha().extract({ left: 0, top: 0, width: 1080, height: HERO_SAFE_BOTTOM }).extractChannel(3).raw().toBuffer()
    assert.ok(alpha.every((value) => value === 0), 'information layout is transparent outside its cards')
    for (const key of ['title', 'description', 'score'] as const) assert.equal(snapshot[key], frozen[key])

    testConfig.poster.backgroundUrl = currentUrl
    const backgroundOnly = await resolve()
    assert.equal(posterBackground(backgroundOnly), currentUrl, 'explicit activity background overrides every legacy result image')
    assert.equal(backgroundOnly.imageUrl, null)
    const sharedPng = await renderTopicV2Poster(backgroundOnly, 'activity')
    assert.deepEqual(await pixel(sharedPng, 0, 0), [238, 34, 51])
    assert.deepEqual(await pixel(sharedPng, 1079, 1439), [34, 68, 238], 'an exact 3:4 source retains both opposite corners')
    assert.deepEqual(await pixel(sharedPng, 500, 1100), [34, 136, 68])
    testConfig.poster.backgroundUrl = null
    assert.equal(posterBackground(await resolve()), oldUrl, 'removing the shared image exposes the first legacy fallback')

    testConfig.results[0].imageUrl = ''
    testConfig.results[1].imageUrl = ''
    frozen.imageUrl = oldUrl
    assert.deepEqual(await pixel(await renderTopicV2Poster(await resolve(), 'activity'), 500, 1100), [153, 34, 17], 'frozen snapshot artwork remains a read-only fallback')
    testConfig.results = []
    frozen.imageUrl = null
    configVersion = 2
    resultId = 'removed-result'
    assert.deepEqual(await pixel(await renderTopicV2Poster(await resolve(), 'activity'), 500, 1100), [16, 44, 72], 'blue is used only when shared, legacy and frozen artwork are absent')
    assert.deepEqual(frozen, beforeSnapshot, 'database attempt is never rewritten by a presentation read')
    await assert.rejects(getTopicV2PosterSnapshot('activity', 'attempt', 'other'), { code: 'TEST_RESULT_NOT_FOUND' })
  } finally { Reflect.set(prisma.topicActivityTestAttempt, 'findFirst', original) }
})
