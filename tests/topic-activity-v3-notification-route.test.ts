import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import test from 'node:test'

test('actual review route keeps committed review successful on notification failure and deduplicates delivery', async () => {
  const require = createRequire(join(process.cwd(), 'package.json'))
  const loader = require('node:module') as { _load: (name: string, parent: unknown, main: boolean) => unknown }
  const original = loader._load
  let authorized = true, changed = true, readFails = false, writes = 0, reviews = 0
  const notices = new Map<string, { key: string; title: string; content: string }>()
  const db = {
    activity: { findUnique: async () => { if (readFails) throw new Error('local notification read failure'); return { title: '本地礼物' } } },
    topicActivityRewardGrant: { findUnique: async () => ({ status: 'GRANTED', points: 23 }) },
    topicActivityLotteryEligibility: { findUnique: async () => ({ valid: false }) },
  }
  loader._load = function (name, parent, main) {
    if (name === '@/lib/security') return {
      rejectInvalidRequestOrigin: () => null,
      requireRequestAdmin: async () => authorized ? { user: { id: 'admin' } } : { user: null, response: new Response('', { status: 403 }) },
    }
    if (name === '@/lib/prisma') return { prisma: db }
    if (name === '@/lib/topic-activity-v2') return {
      topicV2EntryGrantKey: () => 'local-grant',
      reviewTopicActivityV2Submission: async (input: { status: string; rejectReason: string }) => {
        reviews++
        return { changed, submission: { userId: 'user-one', rewardEntryId: 'entry-one', commentId: 'comment-one',
          rewardSnapshot: { platformName: '微博', title: '晒图' }, rejectReason: input.rejectReason,
          reviewedAt: new Date('2026-10-16T00:00:00Z') } }
      },
    }
    if (name === '@/lib/notification-write') return {
      createManyNotifications: async (input: { data: Array<{ key: string; title: string; content: string }>; skipDuplicates: boolean }) => {
        assert.equal(input.skipDuplicates, true); writes++
        for (const notice of input.data) if (!notices.has(notice.key)) notices.set(notice.key, notice)
      },
    }
    return original.call(this, name, parent, main)
  }
  let route: typeof import('../app/api/admin/activities/[activityId]/v2/submissions/[submissionId]/route')
  try { route = require('./app/api/admin/activities/[activityId]/v2/submissions/[submissionId]/route.ts') }
  finally { loader._load = original }
  const context = { params: Promise.resolve({ activityId: 'activity-one', submissionId: 'submission-one' }) }
  const request = (body: unknown) => new Request('http://localhost/api/local', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  authorized = false
  assert.equal((await route.PATCH(request({ status: 'APPROVED' }), context)).status, 403)
  assert.equal(reviews, 0)
  authorized = true
  for (const reason of ['', '   ', '字']) assert.equal((await route.PATCH(request({ status: 'REJECTED', rejectReason: reason }), context)).status, 400)
  assert.equal(reviews, 0)
  assert.equal((await route.PATCH(request({ status: 'APPROVED' }), context)).status, 200)
  assert.match([...notices.values()][0].content, /本地礼物.*微博.*23 挂号费/)
  changed = false
  assert.equal((await route.PATCH(request({ status: 'APPROVED' }), context)).status, 200)
  assert.equal(writes, 1)
  changed = true
  assert.equal((await route.PATCH(request({ status: 'APPROVED' }), context)).status, 200)
  assert.equal(notices.size, 1, 'same key retry does not add another notification')
  readFails = true
  assert.equal((await route.PATCH(request({ status: 'APPROVED' }), context)).status, 200, 'secondary notification failure cannot fail the core review')
  assert.equal(notices.size, 1)
})
