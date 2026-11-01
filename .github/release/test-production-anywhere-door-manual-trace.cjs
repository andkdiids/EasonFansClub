'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { querySocialEvidence, safeInstagramPermalink } = require('./production-anywhere-door-diagnostic-v2.cjs')

test('manual trace correlates create and dedupe audit events to a post without exposing operator fields', async () => {
  const post = {
    id: 'post-1',
    externalId: 'must-not-be-exposed',
    shortcode: 'AbC_123',
    permalink: 'https://m.instagram.com/p/AbC_123/?tracking=private',
    provider: 'manual',
    mediaType: 'CAROUSEL',
    status: 'READY',
    publishedAt: new Date('2026-10-16T04:00:00.000Z'),
    createdAt: new Date('2026-11-01T21:00:00.000Z'),
    media: [
      { type: 'IMAGE', sortOrder: 0 },
      { type: 'VIDEO', sortOrder: 1 },
      { type: 'IMAGE', sortOrder: 2 },
    ],
  }
  const audits = [
    { id: 'audit-2', operationType: 'ANYWHERE_DOOR_MANUAL_POST_DEDUPED', targetId: 'post-1', createdAt: new Date('2026-11-01T21:02:00.000Z'), adminId: 'secret-admin-id', metadata: { sourceUrl: 'https://instagram.com/p/AbC_123/?token=private', caption: 'private-caption', secret: 'private-secret' } },
    { id: 'audit-1', operationType: 'ANYWHERE_DOOR_MANUAL_POST_CREATED', targetId: 'post-1', createdAt: new Date('2026-11-01T21:00:00.000Z'), operatorName: 'private-operator', metadata: { sourceUrl: 'https://instagram.com/p/AbC_123/', publishedAt: '2026-10-16T04:00:00.000Z', caption: 'private-caption', secret: 'private-secret' } },
  ]
  let socialPostFindManyCount = 0
  const prisma = {
    socialSyncState: { findMany: async () => [] },
    socialSyncLog: { findMany: async () => [], findFirst: async () => null },
    socialPost: {
      findMany: async () => (++socialPostFindManyCount === 1 ? [] : [post]),
      findFirst: async () => null,
      count: async () => 20,
    },
    adminAction: { findMany: async () => audits },
  }

  const result = await querySocialEvidence(prisma, new Date('2026-11-02T00:00:00.000Z'))
  assert.equal(result.manualSubmissions.returnedCount, 2)
  assert.equal(result.manualSubmissions.createdCount, 1)
  assert.equal(result.manualSubmissions.deduplicatedCount, 1)
  assert.equal(result.manualSubmissions.uniqueExistingPostCount, 1)
  assert.deepEqual(result.manualSubmissions.entries.map((entry) => entry.operation), [
    'ANYWHERE_DOOR_MANUAL_POST_DEDUPED',
    'ANYWHERE_DOOR_MANUAL_POST_CREATED',
  ])
  assert.deepEqual(result.manualSubmissions.entries[0].media, [
    { type: 'IMAGE', sortOrder: 0 },
    { type: 'VIDEO', sortOrder: 1 },
    { type: 'IMAGE', sortOrder: 2 },
  ])
  assert.equal(result.manualSubmissions.entries[0].publicFeedPosition, 21)
  assert.equal(result.manualSubmissions.entries[0].publicFeedPage, 2)
  assert.equal(result.manualSubmissions.entries[0].sourceUrl, 'https://www.instagram.com/p/AbC_123/')
  const serialized = JSON.stringify(result.manualSubmissions)
  for (const forbidden of ['secret-admin-id', 'private-operator', 'must-not-be-exposed', 'adminId', 'operatorName', 'metadata', 'private-caption', 'private-secret', 'token=private']) {
    assert.equal(serialized.includes(forbidden), false, `sensitive field leaked: ${forbidden}`)
  }
})

test('manual trace reports a missing target record without guessing its public visibility', async () => {
  const prisma = {
    socialSyncState: { findMany: async () => [] },
    socialSyncLog: { findMany: async () => [], findFirst: async () => null },
    socialPost: { findMany: async () => [], findFirst: async () => null, count: async () => 0 },
    adminAction: { findMany: async () => [{ id: 'audit', operationType: 'ANYWHERE_DOOR_MANUAL_POST_CREATED', targetId: 'gone-post', createdAt: new Date('2026-11-01T21:00:00.000Z') }] },
  }
  const result = await querySocialEvidence(prisma, new Date('2026-11-02T00:00:00.000Z'))
  assert.equal(result.manualSubmissions.entries[0].postExists, false)
  assert.equal(result.manualSubmissions.entries[0].postId, 'gone-post')
  assert.equal(result.manualSubmissions.entries[0].publicFeedPosition, null)
  assert.equal(result.manualSubmissions.entries[0].publicFeedPage, null)
})

test('manual trace canonicalizes public Instagram source links and rejects unsafe URLs', () => {
  assert.equal(safeInstagramPermalink('https://instagram.com/reel/AbC_123/?igsh=private'), 'https://www.instagram.com/reel/AbC_123/')
  assert.equal(safeInstagramPermalink('https://user:pass@instagram.com/p/AbC_123/'), null)
  assert.equal(safeInstagramPermalink('https://example.com/p/AbC_123/'), null)
  assert.equal(safeInstagramPermalink('http://instagram.com/p/AbC_123/'), null)
})
