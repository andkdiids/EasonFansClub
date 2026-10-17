import assert from 'node:assert/strict'
import test from 'node:test'
import { prisma } from '@/lib/prisma'
import { getTopicV2PosterSnapshot } from '@/lib/topic-activity-v2-interactive'

const snapshot = (backgroundUrl: string | null, imageUrl: string | null) => ({
  title: '固定历史结果', description: '固定历史说明', imageUrl,
  poster: { backgroundUrl, showNickname: true, showQrCode: true },
  score: 3, maxScore: 5,
})

async function withAttempt(attempt: Record<string, unknown>, work: () => Promise<void>) {
  const delegate = prisma.topicActivityTestAttempt
  const original = Reflect.get(delegate, 'findFirst')
  Reflect.set(delegate, 'findFirst', async () => attempt)
  try { await work() } finally { Reflect.set(delegate, 'findFirst', original) }
}

function attempt(resultSnapshot: ReturnType<typeof snapshot>, topicProgram: Record<string, unknown>) {
  return {
    resultSnapshot: structuredClone(resultSnapshot), testId: 'current-test', configVersion: 4, resultId: 'second',
    Activity: { startsAt: null, endsAt: null, topicProgram },
    User: { nickname: '历史昵称', avatarUrl: null, Profile: null },
  }
}

test('current shared poster background beats the result image and the frozen snapshot', async () => {
  const stored = attempt(snapshot('/snapshot-global.png', '/snapshot-result.png'), { test: {
    id: 'current-test', version: 4, poster: { backgroundUrl: '/activity-global.png', showNickname: true, showQrCode: true },
    results: [{ id: 'first', imageUrl: '/legacy-first.png' }, { id: 'second', imageUrl: '/legacy-matching-result.png' }],
  } })
  const before = structuredClone(stored.resultSnapshot)
  await withAttempt(stored, async () => {
    const resolved = await getTopicV2PosterSnapshot('activity-one', 'attempt-one', 'user-one')
    assert.deepEqual(resolved.poster, { backgroundUrl: '/activity-global.png', showNickname: true, showQrCode: true })
    assert.equal(resolved.imageUrl, '/snapshot-result.png', 'the historical per-result image remains a final fallback only')
    assert.equal(resolved.title, '固定历史结果')
  })
  assert.deepEqual(stored.resultSnapshot, before, 'resolving artwork never writes to historical attempt JSON')
})

test('the first nonempty legacy result image becomes one shared fallback, independent of the attempt result', async () => {
  const stored = attempt(snapshot('/snapshot-global.png', '/snapshot-result.png'), { test: {
    id: 'current-test', version: 4, poster: { backgroundUrl: null, showNickname: false, showQrCode: false },
    results: [{ id: 'empty', imageUrl: '  ' }, { id: 'first-image', imageUrl: ' /legacy-first.png ' }, { id: 'second', imageUrl: '/legacy-matching-result.png' }],
  } })
  await withAttempt(stored, async () => {
    const resolved = await getTopicV2PosterSnapshot('activity-one', 'attempt-one', 'user-one')
    assert.equal((resolved.poster as Record<string, unknown>).backgroundUrl, '/legacy-first.png')
    assert.equal(resolved.nickname, null)
  })
  assert.equal((stored.resultSnapshot as Record<string, unknown>).imageUrl, '/snapshot-result.png')
})

test('frozen poster artwork is used only when current shared and legacy sources are absent', async () => {
  const stored = attempt(snapshot('/snapshot-global.png', '/snapshot-result.png'), { test: {
    id: 'current-test', version: 4, poster: { backgroundUrl: null, showNickname: false, showQrCode: false }, results: [],
  } })
  await withAttempt(stored, async () => {
    const resolved = await getTopicV2PosterSnapshot('activity-one', 'attempt-one', 'user-one')
    assert.equal((resolved.poster as Record<string, unknown>).backgroundUrl, '/snapshot-global.png')
    assert.equal(resolved.imageUrl, '/snapshot-result.png')
    assert.equal(resolved.nickname, null)
  })
})
