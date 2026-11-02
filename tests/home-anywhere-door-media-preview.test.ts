import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildHomeAnywhereDoorMediaPreview, HOME_ANYWHERE_DOOR_MEDIA_PREVIEW_LIMIT } from '../lib/home-anywhere-door-preview'
import type { SocialPostMediaView } from '../lib/social-posts'

function media(id: string, type: SocialPostMediaView['type'], sortOrder: number): SocialPostMediaView {
  return { id, type, url: `https://media.ecfc.fans/media/${id}`, thumbnailUrl: null, width: null, height: null, durationMs: null, sortOrder }
}

test('homepage preview preserves mixed IMAGE/VIDEO sortOrder and limits the request projection to four tiles', () => {
  const input = [media('image-3', 'IMAGE', 2), media('video-2', 'VIDEO', 3), media('image-1', 'IMAGE', 0), media('video-1', 'VIDEO', 1), media('image-5', 'IMAGE', 4), media('image-6', 'IMAGE', 5)]
  const preview = buildHomeAnywhereDoorMediaPreview(input, 6)

  assert.equal(HOME_ANYWHERE_DOOR_MEDIA_PREVIEW_LIMIT, 4)
  assert.deepEqual(preview.items.map((item) => `${item.type}:${item.sortOrder}`), ['IMAGE:0', 'VIDEO:1', 'IMAGE:2', 'VIDEO:3'])
  assert.equal(preview.overflowCount, 2)
})

test('one through four media items display without an overflow indicator', () => {
  for (let count = 1; count <= 4; count += 1) {
    const preview = buildHomeAnywhereDoorMediaPreview(Array.from({ length: count }, (_, index) => media(`m-${index}`, index % 2 ? 'VIDEO' : 'IMAGE', index)))
    assert.equal(preview.items.length, count)
    assert.equal(preview.overflowCount, 0)
  }
})

test('text-only posts have no media preview and image-only/video-only posts keep their original media kind', () => {
  assert.deepEqual(buildHomeAnywhereDoorMediaPreview([]), { items: [], overflowCount: 0 })
  assert.equal(buildHomeAnywhereDoorMediaPreview([media('image', 'IMAGE', 0)]).items[0]?.type, 'IMAGE')
  assert.equal(buildHomeAnywhereDoorMediaPreview([media('video', 'VIDEO', 0)]).items[0]?.type, 'VIDEO')
})

test('home media tiles lazy-load images, never autoplay video, and provide failure fallbacks', () => {
  const component = readFileSync('components/HomeAnywhereDoorMediaPreview.tsx', 'utf8')
  assert.match(component, /loading="lazy"/)
  assert.match(component, /preload="metadata"/)
  assert.match(component, /onError=\{\(\) => setFailed\(true\)\}/)
  assert.match(component, /媒体预览暂不可用/)
  assert.match(component, /aria-label=\{`还有 \$\{overflowCount\} 项媒体`\}/)
  assert.doesNotMatch(component, /autoPlay/i)
})
