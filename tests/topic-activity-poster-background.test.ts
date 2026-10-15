import assert from 'node:assert/strict'
import test from 'node:test'
import { topicActivityPosterBackgroundPath } from '@/lib/topic-activity-poster-background'

test('normalizes activity upload media URLs to the existing COS proxy path', () => {
  assert.equal(
    topicActivityPosterBackgroundPath('https://media.ecfc.fans/media/activities/22222222-2222-4222-8222-222222222222/source.webp'),
    '/cos/activities/22222222-2222-4222-8222-222222222222/source.webp',
  )
  assert.equal(
    topicActivityPosterBackgroundPath('/cos/activities/22222222-2222-4222-8222-222222222222/source.webp'),
    '/cos/activities/22222222-2222-4222-8222-222222222222/source.webp',
  )
})

test('rejects non-activity, malformed, or decorated media URLs', () => {
  for (const value of [
    'blob:https://ecfc.fans/asset',
    'file:///tmp/poster.webp',
    'https://media.ecfc.fans/media/activities/not-a-uuid/source.webp',
    'https://media.ecfc.fans/media/activities/22222222-2222-4222-8222-222222222222/source.webp?token=secret',
    '/cos/activities/../secret/source.webp',
    '/cos/uploads/22222222-2222-4222-8222-222222222222/source.webp',
  ]) assert.equal(topicActivityPosterBackgroundPath(value), null, value)
})
