import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { canReuseInstagramMedia } from '@/lib/instagram/sync-service'
import type { InstagramPost } from '@/lib/instagram/types'

const source = readFileSync('lib/instagram/sync-service.ts', 'utf8')
const post: Pick<InstagramPost, 'media'> = {
  media: [
    { type: 'IMAGE', sourceUrl: 'https://cdninstagram.com/image.jpg', thumbnailUrl: null, width: null, height: null, duration: null, sortOrder: 0 },
  ],
}

test('FAILED posts are retried in place instead of reusing a missing media set', () => {
  assert.equal(canReuseInstagramMedia({ status: 'FAILED', media: post.media }, post), false)
  assert.equal(canReuseInstagramMedia({ status: 'READY', media: post.media }, post), true)
  assert.match(source, /socialPost\.upsert\(/)
  assert.match(source, /platform_externalId: \{ platform: 'INSTAGRAM', externalId: post\.externalId \}/)
  assert.match(source, /status: prepared\.status === 'HIDDEN' \? 'HIDDEN' : 'READY'/)
  assert.match(source, /status: existing\?\.status === 'READY' \|\| existing\?\.status === 'HIDDEN' \? existing\.status : 'FAILED'/)
  assert.match(source, /\[instagram\.media\.failure\]/)
  assert.match(source, /errorCode: errorCode\(error\)/)
})

test('a failed baseline does not set baselineCompletedAt in the worker path', () => {
  const worker = readFileSync('lib/instagram/worker.ts', 'utf8')
  assert.match(worker, /baselineCompletedAt: baseline \? now : state\.baselineCompletedAt/)
  assert.match(worker, /recordFailure\(db, latestState, now, result\.errorCode \|\| result\.status/)
})
