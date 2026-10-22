import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { canShowTopicActivityCommentReviewActions, isReviewableTopicActivitySubmission, topicActivityPlatformReplyWhere, topicActivityPlatformTabs, topicActivityReviewReplyWhere, topicActivityReviewSubmissionScopeWhere } from '@/lib/topic-activity-comment-platform'
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

test('V2 discussion comments never expose review actions while platform submissions retain pending-only actions', () => {
  const statuses = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'] as const
  const platforms = ['weibo', 'xiaohongshu', 'douyin', 'instagram']
  const discussion = statuses.map((status) => ({ status, rewardEntryId: null }))
  const submissions = platforms.flatMap((platformKey) => statuses.map((status) => ({ status, rewardEntryId: `entry-${platformKey}`, platformKey })))

  for (const item of discussion) {
    assert.equal(isReviewableTopicActivitySubmission({ isV2Activity: true, rewardEntryId: item.rewardEntryId }), false, `V2 discussion ${item.status} is not reviewable even when it has a TopicActivitySubmission row`)
    assert.equal(canShowTopicActivityCommentReviewActions({ canReview: true, isV2Activity: true, ...item }), false)
  }
  for (const item of submissions) {
    assert.equal(isReviewableTopicActivitySubmission({ isV2Activity: true, rewardEntryId: item.rewardEntryId }), true, `${item.platformKey} ${item.status} remains a reviewable platform submission`)
    assert.equal(canShowTopicActivityCommentReviewActions({ canReview: true, isV2Activity: true, ...item }), item.status === 'PENDING')
  }
  for (const platformKey of platforms) {
    assert.equal(isReviewableTopicActivitySubmission({ isV2Activity: true, rewardEntryId: `entry-${platformKey}` }), true)
  }
  assert.equal(canShowTopicActivityCommentReviewActions({ canReview: true, isV2Activity: false, status: 'PENDING', rewardEntryId: null }), true, 'legacy activity review remains unchanged')
  assert.equal(isReviewableTopicActivitySubmission({ isV2Activity: false, rewardEntryId: null }), true, 'legacy status visibility remains unchanged')
  assert.equal(canShowTopicActivityCommentReviewActions({ canReview: false, isV2Activity: false, status: 'PENDING', rewardEntryId: 'entry-weibo' }), false)

  const replies = read('components/PostRepliesSection.tsx')
  const platformCard = read('components/activities/TopicActivityPlatformSubmissionCard.tsx')
  const taskReview = read('components/activities/TopicActivityV2TaskReview.tsx')
  const legacyReviewService = read('lib/topic-activity.ts')
  const v2ReviewService = read('lib/topic-activity-v2.ts')
  const legacyReviewRoute = read('app/api/admin/topic-activity-submissions/[submissionId]/route.ts')
  const v2ReviewRoute = read('app/api/admin/activities/[activityId]/v2/submissions/[submissionId]/route.ts')
  assert.match(replies, /canShowTopicActivityCommentReviewActions\(/u)
  assert.match(replies, /isReviewableTopicActivitySubmission\(\{ isV2Activity: topicActivityV2Enabled, rewardEntryId: submission\.rewardEntryId \}\)/u)
  assert.match(replies, /\{reviewableSubmission \? <span[\s\S]*?已通过[\s\S]*?未通过[\s\S]*?已撤回[\s\S]*?待审核[\s\S]*?: null\}/u)
  assert.match(replies, /\{canShowReviewActions \? <>[\s\S]*?通过[\s\S]*?拒绝[\s\S]*?<\/>\s*: null\}/u)
  assert.match(replies, /reviewableSubmission\?\.status === 'REJECTED'[\s\S]*?拒绝原因/u)
  assert.match(replies, /已计入本活动/u)
  assert.match(replies, /尚未填写表单/u)
  assert.match(replies, /reply\.topicActivitySubmission\?\.rewardEntryId\) return <TopicActivityPlatformSubmissionCard/u)
  assert.match(platformCard, /<TopicActivityV2TaskReview[^>]*canReview=\{canReview\}/u)
  assert.match(taskReview, /const isPending = submission\.status === 'PENDING'/u)
  assert.match(taskReview, /if \(!canReview \|\| !isPending \|\| loading\) return/u)
  assert.match(replies, /<DeleteReplyButton/u)
  assert.match(replies, /canPinPostReply\(/u)
  assert.match(replies, /onClick=\{\(\) => openReplyComposer/u)
  assert.match(legacyReviewService, /if \(!submission\.rewardEntryId\) throw new Error\('TOPIC_V2_DISCUSSION_NOT_REVIEWABLE'\)/u)
  assert.match(v2ReviewService, /if \(!submission\.rewardEntryId\) fail\('TOPIC_V2_DISCUSSION_NOT_REVIEWABLE'/u)
  assert.match(legacyReviewRoute, /TOPIC_V2_DISCUSSION_NOT_REVIEWABLE/u)
  assert.match(v2ReviewRoute, /reviewTopicActivityV2Submission/u)
})

test('category, status, and platform query combinations keep only matching controlled records', () => {
  type RecordRow = { id: string; TopicActivitySubmission: null | { activityId: string; status: string; rewardEntryId: string | null; RewardEntry: { platformKey: string } | null } }
  const activityId = 'activity-1'
  const statuses = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'] as const
  const platforms = ['weibo', 'xiaohongshu', 'douyin', 'instagram']
  const rows: RecordRow[] = [
    { id: 'discussion-without-submission', TopicActivitySubmission: null },
    ...statuses.map((status) => ({ id: `discussion-${status}`, TopicActivitySubmission: { activityId, status, rewardEntryId: null, RewardEntry: null } })),
    ...platforms.flatMap((platformKey) => statuses.map((status) => ({ id: `${platformKey}-${status}`, TopicActivitySubmission: { activityId, status, rewardEntryId: `entry-${platformKey}`, RewardEntry: { platformKey } } }))),
  ]
  const matches = (record: Record<string, unknown>, where: Record<string, unknown>): boolean => Object.entries(where).every(([key, value]) => {
    if (key === 'AND') return (value as Record<string, unknown>[]).every((condition) => matches(record, condition))
    if (key === 'OR') return (value as Record<string, unknown>[]).some((condition) => matches(record, condition))
    if (key === 'TopicActivitySubmission') {
      const relation = (value as { is?: unknown }).is
      const submission = record.TopicActivitySubmission as Record<string, unknown> | null
      if (relation === null) return submission === null
      return Boolean(submission) && matches(submission!, relation as Record<string, unknown>)
    }
    if (key === 'RewardEntry') {
      const relation = (value as { is?: unknown }).is as Record<string, unknown> | undefined
      const rewardEntry = record.RewardEntry as Record<string, unknown> | null
      return Boolean(rewardEntry && (!relation || matches(rewardEntry, relation)))
    }
    return record[key] === value
  })

  for (const status of statuses) {
    for (const platformKey of platforms) {
      const where = topicActivityReviewReplyWhere(activityId, status, platformKey) as Record<string, unknown>
      assert.deepEqual(rows.filter((row) => matches(row as unknown as Record<string, unknown>, where)).map((row) => row.id), [`${platformKey}-${status}`])
    }
    const discussionWhere = topicActivityReviewReplyWhere(activityId, status, null, true) as Record<string, unknown>
    assert.deepEqual(rows.filter((row) => matches(row as unknown as Record<string, unknown>, discussionWhere)).map((row) => row.id), [`discussion-${status}`])
  }
  for (const platformKey of platforms) {
    const platformWhere = topicActivityReviewReplyWhere(activityId, null, platformKey) as Record<string, unknown>
    assert.deepEqual(rows.filter((row) => matches(row as unknown as Record<string, unknown>, platformWhere)).map((row) => row.id), statuses.map((status) => `${platformKey}-${status}`))
  }
  const pendingAcrossPlatforms = topicActivityReviewReplyWhere(activityId, 'PENDING', null) as Record<string, unknown>
  assert.deepEqual(rows.filter((row) => matches(row as unknown as Record<string, unknown>, pendingAcrossPlatforms)).map((row) => row.id), ['discussion-PENDING', ...platforms.map((platformKey) => `${platformKey}-PENDING`)])
  const allDiscussion = topicActivityReviewReplyWhere(activityId, null, null, true) as Record<string, unknown>
  assert.deepEqual(rows.filter((row) => matches(row as unknown as Record<string, unknown>, allDiscussion)).map((row) => row.id), ['discussion-without-submission', ...statuses.map((status) => `discussion-${status}`)])
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
  assert.match(page, /topicActivityV2Enabled=\{topicActivityV2Enabled\}/u)
  assert.match(page, /topicProgram:\s*true/u)
  const panel = read('components/activities/TopicActivityV2Panel.tsx')
  const v2Comments = read('components/activities/TopicActivityV2Comments.tsx')
  assert.match(v2Comments, /topicActivityV2Enabled/u)
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
