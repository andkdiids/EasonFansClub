import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import sharp from 'sharp'
import { prisma } from '@/lib/prisma'
import { getTopicV2PosterSnapshot } from '@/lib/topic-activity-v2-interactive'
import { renderTopicV2Poster } from '@/lib/topic-activity-v2-poster'
import { topicPosterLayout } from '@/lib/topic-activity-v2-poster-layout'

let directory = '', currentUrl = '', oldUrl = ''
before(async () => {
  await mkdir(join(process.cwd(), 'public/uploads'), { recursive: true })
  directory = await mkdtemp(join(process.cwd(), 'public/uploads/poster-presentation-'))
  const current = await sharp(Buffer.from('<svg width="1080" height="1920"><rect width="1080" height="1920" fill="#228844"/><rect width="60" height="60" fill="#ee2233"/><rect x="1020" y="1860" width="60" height="60" fill="#2244ee"/></svg>')).png().toBuffer()
  await writeFile(join(directory, 'current.png'), current)
  await writeFile(join(directory, 'old.png'), await sharp({ create: { width: 1080, height: 1920, channels: 4, background: '#992211' } }).png().toBuffer())
  currentUrl = `/uploads/${basename(directory)}/current.png`
  oldUrl = `/uploads/${basename(directory)}/old.png`
})
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }) })

async function pixel(png: Buffer, left: number, top: number) {
  return [...await sharp(png).extract({ left, top, width: 1, height: 1 }).removeAlpha().raw().toBuffer()]
}

test('matching current result artwork fixes old null/old snapshots; background/explicit removal and retired versions stay safe', async () => {
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
    assert.equal(snapshot.imageUrl, currentUrl, 'match the actual second result by ID, never use first result artwork')
    const png = await renderTopicV2Poster(snapshot, 'activity')
    assert.deepEqual(await sharp(png).metadata().then((metadata) => [metadata.width, metadata.height]), [1080, 1920])
    assert.deepEqual(await pixel(png, 0, 0), [238, 34, 51])
    assert.deepEqual(await pixel(png, 1079, 1919), [34, 68, 238], 'a 9:16 source retains both opposite corners')
    assert.deepEqual(await pixel(png, 500, 600), [34, 136, 68], 'uploaded background is not covered by a full blue layer')
    const alpha = await sharp(Buffer.from(topicPosterLayout(snapshot))).ensureAlpha().extract({ left: 0, top: 0, width: 1080, height: 620 }).extractChannel(3).raw().toBuffer()
    assert.ok(alpha.every((value) => value === 0), 'information layout is transparent outside its cards')
    for (const key of ['title', 'description', 'score'] as const) assert.equal(snapshot[key], frozen[key])

    testConfig.results[1].imageUrl = ''
    testConfig.poster.backgroundUrl = currentUrl
    const backgroundOnly = await resolve()
    assert.equal(backgroundOnly.imageUrl, null)
    assert.deepEqual(await pixel(await renderTopicV2Poster(backgroundOnly, 'activity'), 500, 600), [34, 136, 68])
    testConfig.poster.backgroundUrl = null
    assert.deepEqual(await pixel(await renderTopicV2Poster(await resolve(), 'activity'), 500, 600), [16, 44, 72], 'default blue is used only when both image sources are empty')

    frozen.imageUrl = oldUrl
    configVersion = 2
    assert.equal((await resolve()).imageUrl, oldUrl, 'never apply another test version artwork')
    configVersion = 1; resultId = 'removed-result'
    assert.equal((await resolve()).imageUrl, oldUrl, 'removed IDs never borrow another result image')
    frozen.imageUrl = null
    assert.deepEqual(frozen, beforeSnapshot, 'database attempt is never rewritten by a presentation read')
    await assert.rejects(getTopicV2PosterSnapshot('activity', 'attempt', 'other'), { code: 'TEST_RESULT_NOT_FOUND' })
  } finally { Reflect.set(prisma.topicActivityTestAttempt, 'findFirst', original) }
})
