import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDefaultTopicActivityV2Program, type TopicRewardEntryConfig } from '@/lib/topic-activity-v2-config'
import { getTopicActivityV2Availability } from '@/lib/topic-activity-v2-availability'

const now = new Date('2026-10-22T04:00:00Z')

function entry(id: string, platformKey = id): TopicRewardEntryConfig {
  return {
    id,
    platformKey,
    platformName: platformKey,
    title: id,
    instructions: '完成任务后提交截图',
    materialRequirement: '截图',
    minImages: 0,
    maxImages: 2,
    points: 10,
    enabled: true,
    sortOrder: 0,
    startsAt: null,
    endsAt: null,
    allowResubmit: true,
  }
}

function input(overrides: Partial<Parameters<typeof getTopicActivityV2Availability>[0]> = {}) {
  const program = createDefaultTopicActivityV2Program()
  program.enabled = true
  program.platformRewards.enabled = true
  program.platformRewards.allowStacking = true
  program.entries = [entry('weibo')]
  program.poll = { ...program.poll, enabled: true, id: 'poll-one', options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }
  program.test = { ...program.test, enabled: true, id: 'test-one', allowRetake: false, questions: [{ id: 'q', prompt: 'Q', points: 1, options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], correctOptionId: 'a' }], results: [{ id: 'r', title: 'R', description: 'R', scoreMin: 0, scoreMax: 1 }] }
  program.fixedReward = { ...program.fixedReward, enabled: true, condition: 'POLL', points: 10 }
  return {
    activity: { status: 'PUBLISHED', startsAt: new Date('2026-10-01T00:00:00Z'), endsAt: new Date('2026-10-31T00:00:00Z'), allowImageAttachments: true },
    program,
    authenticated: true,
    now,
    ...overrides,
  }
}

test('availability exposes server time and authentication gates for every V2 action', () => {
  const anonymous = getTopicActivityV2Availability({ ...input(), authenticated: false })
  assert.equal(anonymous.activityStatus, 'ONGOING')
  assert.deepEqual(anonymous.entries.weibo, { canSubmit: false, code: 'UNAUTHENTICATED' })
  assert.deepEqual(anonymous.poll, { canSubmit: false, code: 'UNAUTHENTICATED' })
  assert.deepEqual(anonymous.test, { canSubmit: false, code: 'UNAUTHENTICATED' })
  assert.deepEqual(anonymous.fixedReward, { canSubmit: false, code: 'UNAUTHENTICATED' })

  const upcoming = getTopicActivityV2Availability({ ...input(), activity: { ...input().activity, startsAt: new Date('2026-11-01T00:00:00Z') } })
  assert.equal(upcoming.activityStatus, 'UPCOMING')
  assert.equal(upcoming.entries.weibo.code, 'ACTIVITY_NOT_STARTED')
  assert.equal(upcoming.poll.code, 'ACTIVITY_NOT_STARTED')
})

test('availability mirrors task resubmission and entry/platform limit rules', () => {
  const blocked = getTopicActivityV2Availability({
    ...input(),
    submissions: [{ rewardEntryId: 'weibo', status: 'PENDING' }],
  })
  assert.deepEqual(blocked.entries.weibo, { canSubmit: false, code: 'TOPIC_V2_RESUBMISSION_NOT_ALLOWED' })

  const limitedProgram = createDefaultTopicActivityV2Program()
  limitedProgram.enabled = true
  limitedProgram.platformRewards = { enabled: true, allowStacking: true, maxEntries: 1, maxPlatforms: 2 }
  limitedProgram.entries = [entry('weibo'), entry('instagram', 'instagram')]
  const limited = getTopicActivityV2Availability({
    ...input(),
    program: limitedProgram,
    grants: [{ rewardEntryId: 'weibo', rewardSnapshot: { entry: { platformKey: 'weibo' } }, origin: 'PLATFORM', kind: 'POINTS', status: 'GRANTED' }],
  })
  assert.equal(limited.entries.instagram.code, 'TOPIC_V2_MAX_ENTRIES_REACHED')
  assert.equal(limited.entries.weibo.canSubmit, true)
})

test('availability gates poll, test retakes, and fixed reward evidence from persisted progress', () => {
  const beforeVote = getTopicActivityV2Availability(input())
  assert.equal(beforeVote.poll.canSubmit, true)
  assert.equal(beforeVote.fixedReward.code, 'TOPIC_V2_FIXED_REWARD_NOT_ELIGIBLE')

  const afterVote = getTopicActivityV2Availability({ ...input(), pollVotes: [{ pollId: 'poll-one' }] })
  assert.equal(afterVote.poll.canSubmit, false)
  assert.equal(afterVote.poll.code, 'POLL_ALREADY_SUBMITTED')
  assert.equal(afterVote.fixedReward.canSubmit, true)

  const afterTest = getTopicActivityV2Availability({ ...input(), testAttempts: [{ testId: 'test-one', configVersion: 1 }] })
  assert.equal(afterTest.test.code, 'TEST_RETAKE_NOT_ALLOWED')
})

test('fixed reward remains available after the activity date while its own claim window is open', () => {
  const program = input().program!
  program.fixedReward.endsAt = '2026-10-31T23:00:00.000Z'
  const ended = getTopicActivityV2Availability({
    ...input(),
    program,
    activity: { ...input().activity, endsAt: new Date('2026-10-20T00:00:00Z') },
    pollVotes: [{ pollId: 'poll-one' }],
  })
  assert.equal(ended.activityStatus, 'ENDED')
  assert.deepEqual(ended.fixedReward, { canSubmit: true, code: null })
})
