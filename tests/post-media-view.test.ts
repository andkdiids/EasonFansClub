import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  POST_MEDIA_VISIBLE_TYPES,
  livePhotoAssetIdForRecord,
  mapPostMediaRows,
  toPostMediaDisplayItem,
  type PostMediaUrlResolver,
} from '../lib/post-media-core.ts'

const resolver: PostMediaUrlResolver = {
  cover: (raw) => raw,
  thumbnail: (raw) => `thumb:${raw}`,
  video: (assetId) => `/api/media/live-photo/${assetId}/video`,
}

const LIVE_ID = 'lp_abcdef123456'

test('every post-facing query shares one visible-media type list', () => {
  // A lone 'IMAGE' filter is what removed live photos from the detail page.
  assert.deepEqual([...POST_MEDIA_VISIBLE_TYPES], ['IMAGE', 'LIVE_PHOTO'])
})

test('a live photo keeps its static cover and gains the guarded clip', () => {
  const item = toPostMediaDisplayItem({
    id: 'm1',
    type: 'LIVE_PHOTO',
    url: `/api/media/live-photo/${LIVE_ID}/cover`,
    thumbnail: `/api/media/live-photo/${LIVE_ID}/cover`,
    width: 1080,
    height: 1440,
    sortOrder: 0,
    livePhotoId: LIVE_ID,
  }, resolver)

  assert.ok(item)
  assert.equal(item.mediaType, 'LIVE_PHOTO')
  assert.equal(item.coverUrl, `/api/media/live-photo/${LIVE_ID}/cover`)
  assert.equal(item.videoUrl, `/api/media/live-photo/${LIVE_ID}/video`)
  assert.equal(item.thumbnailUrl, `thumb:/api/media/live-photo/${LIVE_ID}/cover`)
  assert.deepEqual([item.width, item.height], [1080, 1440])
})

test('the asset id survives a plain stored cover, so old rows still play', () => {
  const item = toPostMediaDisplayItem({
    id: 'm2',
    type: 'LIVE_PHOTO',
    url: 'https://media.ecfc.fans/media/posts/cover.jpg',
    livePhotoId: LIVE_ID,
    sortOrder: 1,
  }, resolver)
  assert.ok(item)
  assert.equal(item.coverUrl, 'https://media.ecfc.fans/media/posts/cover.jpg')
  assert.equal(item.videoUrl, `/api/media/live-photo/${LIVE_ID}/video`)
})

test('a malformed asset id never produces a phantom clip', () => {
  const item = toPostMediaDisplayItem({
    id: 'm3',
    type: 'LIVE_PHOTO',
    url: '/api/media/live-photo/abc/cover',
    sortOrder: 0,
  }, resolver)
  assert.ok(item)
  assert.equal(item.mediaType, 'LIVE_PHOTO')
  assert.equal(item.videoUrl, null, 'an invalid id must not resolve to a playable URL')
  assert.equal(livePhotoAssetIdForRecord({ url: '/api/media/live-photo/abc/cover' }), null)
})

test('plain images stay plain and never claim playback', () => {
  const item = toPostMediaDisplayItem({ id: 'm4', type: 'IMAGE', url: '/uploads/a.jpg', sortOrder: 2 }, resolver)
  assert.ok(item)
  assert.equal(item.mediaType, 'IMAGE')
  assert.equal(item.videoUrl, null)
  assert.equal(item.sortOrder, 2)
})

test('the mapper keeps the author’s order and drops the types the page cannot show', () => {
  const items = mapPostMediaRows([
    { id: 'a', type: 'IMAGE', url: '/uploads/1.jpg', sortOrder: 0 },
    { id: 'b', type: 'LIVE_PHOTO', url: `/api/media/live-photo/${LIVE_ID}/cover`, livePhotoId: LIVE_ID, sortOrder: 1 },
    { id: 'c', type: 'VIDEO', url: '/uploads/clip.mp4', sortOrder: 2 },
    { id: 'd', type: 'IMAGE', url: '/uploads/2.jpg', sortOrder: 3 },
  ], resolver)

  assert.deepEqual(items.map((item) => item.id), ['a', 'b', 'd'])
  assert.deepEqual(items.map((item) => item.mediaType), ['IMAGE', 'LIVE_PHOTO', 'IMAGE'])
})

test('a duplicated live asset renders once', () => {
  const items = mapPostMediaRows([
    { id: 'a', type: 'LIVE_PHOTO', url: `/api/media/live-photo/${LIVE_ID}/cover`, livePhotoId: LIVE_ID, sortOrder: 0 },
    // Legacy row pointing at the same cover without the column.
    { id: 'a-dup', type: 'LIVE_PHOTO', url: `/api/media/live-photo/${LIVE_ID}/cover`, sortOrder: 1 },
  ], resolver)
  assert.equal(items.length, 1)
  assert.equal(items[0].videoUrl, `/api/media/live-photo/${LIVE_ID}/video`)
})

test('a repeated still collapses on its cover URL', () => {
  const items = mapPostMediaRows([
    { id: 'a', type: 'IMAGE', url: '/uploads/x.jpg', sortOrder: 0 },
    { id: 'b', type: 'IMAGE', url: '/uploads/x.jpg', sortOrder: 1 },
  ], resolver)
  assert.equal(items.length, 1)
})

test('missing dimensions are reported as null, not zero', () => {
  const item = toPostMediaDisplayItem({ id: 'm5', type: 'IMAGE', url: '/uploads/y.jpg' }, resolver)
  assert.ok(item)
  assert.equal(item.width, null)
  assert.equal(item.height, null)
  assert.equal(item.sortOrder, 0)
})
