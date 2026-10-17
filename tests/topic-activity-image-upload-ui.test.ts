import assert from 'node:assert/strict'
import test from 'node:test'
import { topicActivityEditorImagesMatch, uploadTopicActivityPosterBackground } from '@/components/activities/TopicActivityPosterBackgroundUploader'
import { createDefaultTopicActivityV2Program, type TopicActivityV2Test } from '@/lib/topic-activity-v2-config'

const source = 'https://media.ecfc.fans/media/activities/22222222-2222-4222-8222-222222222222/source.webp'
const proxy = '/cos/activities/22222222-2222-4222-8222-222222222222/source.webp'

function fixture(): TopicActivityV2Test {
  return { ...createDefaultTopicActivityV2Program().test,
    results: [
      { id: 'first', title: '结果一', description: '说明一', imageUrl: '/cos/activities/first.webp' },
      { id: 'second', title: '结果二', description: '说明二', imageUrl: '/cos/activities/second.webp' },
    ],
    poster: { width: 1080, height: 1920, backgroundUrl: '/cos/activities/background.webp', showNickname: true, showQrCode: false },
  }
}

test('shared poster background upload reuses authenticated activity upload and stores controlled proxy URL', async (t) => {
  let requests = 0
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    requests++
    assert.equal(input, '/api/uploads/activity-image')
    assert.equal(init?.method, 'POST')
    assert.equal(init?.credentials, 'same-origin')
    assert.ok(init?.body instanceof FormData)
    assert.equal((init.body.get('file') as File).name, 'poster-background.png')
    return Response.json({ url: source })
  })
  assert.equal(await uploadTopicActivityPosterBackground(new File(['png'], 'poster-background.png', { type: 'image/png' })), proxy)
  assert.equal(requests, 1)
})

test('failed activity upload rejects without returning a replacement URL', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ message: '上传失败测试' }, { status: 503 }))
  await assert.rejects(uploadTopicActivityPosterBackground(new File(['png'], 'poster-background.png')), /上传失败测试/)
})

test('temporary or foreign upload URLs cannot enter editor image fields', async (t) => {
  let url = ''
  t.mock.method(globalThis, 'fetch', async () => Response.json({ url }))
  for (const invalid of ['blob:https://ecfc.fans/local', 'file:///C:/local.png', 'http://localhost:8000/image.png', 'C:\\images\\local.png', 'https://example.com/photo.png']) {
    url = invalid
    await assert.rejects(uploadTopicActivityPosterBackground(new File(['png'], 'poster-background.png')), /路径无效/)
  }
})

test('image readback matches old URLs without requiring uploads or result-order equality', () => {
  const expected = fixture()
  assert.equal(topicActivityEditorImagesMatch(expected, structuredClone(expected)), true)
  assert.equal(topicActivityEditorImagesMatch(expected, { ...expected, results: [...expected.results].reverse() }), true)
})

test('image readback detects swapped result images using stable result IDs', () => {
  const expected = fixture()
  const actual = structuredClone(expected)
  ;[actual.results[0].imageUrl, actual.results[1].imageUrl] = [actual.results[1].imageUrl, actual.results[0].imageUrl]
  assert.equal(topicActivityEditorImagesMatch(expected, actual), false)
})

test('image readback verifies background and result image independently', () => {
  const expected = fixture()
  const actual = structuredClone(expected)
  actual.poster.backgroundUrl = actual.results[0].imageUrl || null
  assert.equal(topicActivityEditorImagesMatch(expected, actual), false)
  actual.poster.backgroundUrl = expected.poster.backgroundUrl
  actual.results[1].imageUrl = proxy
  assert.equal(topicActivityEditorImagesMatch(expected, actual), false)
})

test('image readback detects unsaved removals or missing records', () => {
  const old = fixture()
  const removed = structuredClone(old)
  removed.results[0].imageUrl = undefined
  removed.poster.backgroundUrl = null
  assert.equal(topicActivityEditorImagesMatch(removed, old), false)
  assert.equal(topicActivityEditorImagesMatch(removed, structuredClone(removed)), true)
  assert.equal(topicActivityEditorImagesMatch(old, { ...old, results: old.results.slice(1) }), false)
})
