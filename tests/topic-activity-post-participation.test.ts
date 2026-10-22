import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { topicActivityPlatformReplyWhere, topicActivityPlatformTabs, topicActivityReviewReplyWhere, topicActivityReviewSubmissionScopeWhere } from '@/lib/topic-activity-comment-platform'
import { fixture, rewardEntry } from './fixtures/topic-v2-transaction'

const read = (file: string) => readFileSync(join(process.cwd(), file), 'utf8')

test('post participation tabs come only from enabled V2 platforms and dedupe platform entry variants', () => {
  const { program } = fixture([
    rewardEntry('weibo-main', 'weibo'),
    rewardEntry('weibo-second', 'weibo'),
    rewardEntry('douyin-main', 'douyin'),
  ])
  program.entries[1].enabled = false
  program.entries[2].platformName = '抖音'
  assert.deepEqual(topicActivityPlatformTabs(program), [
    { platformKey: 'weibo', platformName: 'weibo' },
    { platformKey: 'douyin', platformName: '抖音' },
  ])
  program.enabled = false
  assert.deepEqual(topicActivityPlatformTabs(program), [])
})

test('platform and discussion views reuse the existing comment-submission relation', () => {
  assert.deepEqual(topicActivityPlatformReplyWhere('activity-1', null), {})
  assert.deepEqual(topicActivityPlatformReplyWhere('activity-1', 'weibo'), {
    TopicActivitySubmission: {
      is: { activityId: 'activity-1', RewardEntry: { is: { platformKey: 'weibo' } } },
    },
  })
  assert.deepEqual(topicActivityPlatformReplyWhere('activity-1', null, true), {
    OR: [
      { TopicActivitySubmission: { is: null } },
      { TopicActivitySubmission: { is: { activityId: 'activity-1', rewardEntryId: null } } },
    ],
  })
  const schema = read('prisma/schema.prisma')
  assert.match(schema, /model TopicActivitySubmission \{[\s\S]*?commentId\s+String\?\s+@unique[\s\S]*?rewardEntryId\s+String\?/u)
  assert.match(schema, /Comment\s+Reply\?\s+@relation[\s\S]*?RewardEntry\s+TopicActivityRewardEntry\?/u)
})

test('review status and platform predicates are composed with AND instead of overwriting the shared relation', () => {
  assert.deepEqual(topicActivityReviewReplyWhere('activity-1', 'PENDING', 'weibo'), {
    AND: [
      { TopicActivitySubmission: { is: { activityId: 'activity-1', status: 'PENDING' } } },
      { TopicActivitySubmission: { is: { activityId: 'activity-1', RewardEntry: { is: { platformKey: 'weibo' } } } } },
    ],
  })
  assert.deepEqual(topicActivityReviewReplyWhere('activity-1', 'APPROVED', null), {
    TopicActivitySubmission: { is: { activityId: 'activity-1', status: 'APPROVED' } },
  })
  assert.deepEqual(topicActivityReviewSubmissionScopeWhere('douyin'), { RewardEntry: { is: { platformKey: 'douyin' } } })
  assert.deepEqual(topicActivityReviewSubmissionScopeWhere(null, true), { rewardEntryId: null })
})

test('post activity UI composes the existing form, V2 actions, one header, and shared comments', () => {
  const page = read('app/posts/[postId]/page.tsx')
  assert.match(page, /aria-label="话题活动信息"/u)
  assert.equal((page.match(/aria-label="话题活动信息"/gu) || []).length, 1)
  assert.match(page, /<TopicActivityFormParticipation activityId=\{topicActivity\.id\}/u)
  assert.match(page, /<TopicActivityV2Panel[^>]*showComments=\{false\}/u)
  assert.match(page, /TaskImageAssets:\s*\{\s*select:\s*\{\s*id:\s*true/u)
  assert.match(page, /canViewPrivate\s*&&\s*submission\.rewardEntryId/u)
  assert.match(page, /\/v2\/submissions\/\$\{encodeURIComponent\(submission\.id\)\}\/assets/u)
  assert.match(page, /topicActivityCommentTabs\s*=\s*topicActivityBase\s*\?\s*topicActivityPlatformTabs/u)
  assert.match(page, /topicDiscussionFilter|topicPlatformFilter/u)
  assert.match(page, /topicProgram:\s*true/u)
  const panel = read('components/activities/TopicActivityV2Panel.tsx')
  assert.match(panel, /拒绝原因：/u)
  assert.match(panel, /查看提交/u)
  assert.match(panel, /查看测试结果/u)
  assert.match(page, /<TopicActivityFormParticipation/u)
})

test('status and platform tab changes both return to page one, and empty state follows filtered server results', () => {
  const replies = read('components/PostRepliesSection.tsx')
  assert.match(replies, /function changeTopicReviewFilter[\s\S]*?params\.delete\('commentPage'\)/u)
  assert.match(replies, /function changeTopicCommentTab[\s\S]*?params\.delete\('commentPage'\)/u)
  assert.match(replies, /\{filteredRootReplies\.length === 0 \? \([\s\S]*?还没有回复/u)
})

test('existing activity API continues to expose only the current user result attempts used by the link', () => {
  const service = read('lib/topic-activity-v2.ts')
  assert.match(service, /topicActivityTestAttempt\.findMany\(\{\s*where:\s*\{\s*activityId,\s*userId\s*\}/u)
  assert.match(service, /testAttempts:\s*attempts/u)
  const panel = read('components/activities/TopicActivityV2Panel.tsx')
  assert.match(panel, /\(item as Record<string, unknown>\)\.testId\s*===\s*program\.test\.id/u)
  assert.match(panel, /\(item as Record<string, unknown>\)\.configVersion\s*===\s*program\.test\.version/u)
  const runner = read('components/activities/TopicActivityV2Interactive.tsx')
  assert.match(runner, /requestedAttemptId\s*\?\s*attempts\.find/u)
  assert.match(runner, /setAttempt\(selected\)/u)
})
