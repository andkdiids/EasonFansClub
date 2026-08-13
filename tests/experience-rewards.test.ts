import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  awardExperience,
  EXPERIENCE_REWARD_SOURCES,
  isAllowedExperienceRewardSource,
} from '../lib/growth'

const read = (path: string) => readFileSync(path, 'utf8')

test('经验值服务只接受每日挂号和精华帖子两个来源', () => {
  assert.deepEqual(EXPERIENCE_REWARD_SOURCES, {
    CHECK_IN: 'CHECK_IN',
    FEATURED_POST: 'FEATURED_POST',
  })
  assert.equal(isAllowedExperienceRewardSource('CHECK_IN'), true)
  assert.equal(isAllowedExperienceRewardSource('FEATURED_POST'), true)
  for (const source of ['POST', 'COMMENT', 'LIKE', 'ACTIVITY', 'DAILY_CHECKIN', 'TASK', 'OTHER']) {
    assert.equal(isAllowedExperienceRewardSource(source), false, source)
  }
})

test('非法经验来源在进入事务前被拒绝', async () => {
  await assert.rejects(
    awardExperience({} as never, {
      userId: 'user-1',
      amount: 1,
      type: 'ACTIVITY',
      description: '普通互动',
      sourceType: 'COMMENT' as never,
      sourceId: 'reply-1',
    }),
    /INVALID_EXPERIENCE_REWARD_SOURCE/,
  )
})

test('发帖、评论自己帖子和评论别人帖子都不写经验值', () => {
  const postRoute = read('app/api/posts/route.ts')
  const replyRoute = read('app/api/posts/[postId]/replies/route.ts')
  const rewards = read('lib/community-rewards.ts')
  const commentRewardSection = rewards.slice(
    rewards.indexOf('export async function awardCommunityCommentRewards'),
    rewards.indexOf('type CommentRewardReversalInput'),
  )

  assert.doesNotMatch(postRoute, /awardExperience|postCreateExperience/)
  assert.doesNotMatch(replyRoute, /awardExperience|replyCreateExperience/)
  assert.match(replyRoute, /const createdReply = await tx\.reply\.create/)
  assert.match(replyRoute, /awardCommunityCommentRewards/)
  assert.ok(replyRoute.indexOf('const createdReply = await tx.reply.create') < replyRoute.indexOf('await awardCommunityCommentRewards'))
  assert.match(commentRewardSection, /if \(input\.commenterId === input\.postAuthorId\)/)
  assert.match(commentRewardSection, /action: 'POST_COMMENT_RECEIVED'/)
  assert.match(commentRewardSection, /action: 'COMMENT_POST'/)
  assert.match(commentRewardSection, /requestedAmount: COMMUNITY_REWARD_POINTS\.postCommentReceived/)
  assert.match(commentRewardSection, /requestedAmount: COMMUNITY_REWARD_POINTS\.commentPost/)
  assert.doesNotMatch(commentRewardSection, /awardExperience|experience\s*:/)
})

test('发帖、评论、点赞相关接口不调用经验奖励；合法挂号费奖励仍保留', () => {
  const postLikeRoute = read('app/api/posts/[postId]/like/route.ts')
  const likeRoutes = [
    postLikeRoute,
    read('app/api/replies/[replyId]/like/route.ts'),
    read('app/api/daily-messages/[messageId]/like/route.ts'),
    read('app/api/profile-wall/[messageId]/like/route.ts'),
    read('app/api/music/reviews/[reviewId]/interactions/route.ts'),
  ]

  assert.doesNotMatch(postLikeRoute, /awardExperience|awardRegistrationFee|POST_LIKE_RECEIVED|postLikeReceived|experience\s*:/)
  for (const route of likeRoutes) assert.doesNotMatch(route, /awardExperience|experience\s*:/)
})

test('挂号费和经验值服务保持独立', () => {
  const feeService = read('lib/registration-fee.ts')
  const experienceService = read('lib/growth.ts')
  const communityRewards = read('lib/community-rewards.ts')

  assert.doesNotMatch(feeService, /experience|awardExperience/)
  assert.doesNotMatch(experienceService, /points\s*:\s*\{\s*(?:increment|decrement)/)
  assert.match(communityRewards, /awardRegistrationFee\(tx/)
  assert.match(communityRewards, /awardExperience\(tx/)
})

test('精华奖励保留挂号费、经验值 27、每日一次和帖子幂等保护', () => {
  const rewards = read('lib/community-rewards.ts')
  const featureRoute = read('app/api/posts/[postId]/route.ts')

  assert.match(featureRoute, /data\.isFeatured === true && !lockedExisting\.isFeatured/)
  assert.match(rewards, /businessKey: `community:featured-post:\$\{input\.postId\}`/)
  assert.match(rewards, /action: 'FEATURED_POST'/)
  assert.match(rewards, /featuredPostDaily: 1/)
  assert.match(rewards, /amount: COMMUNITY_REWARD_POINTS\.featuredPostExperience/)
  assert.match(rewards, /sourceType: EXPERIENCE_REWARD_SOURCES\.FEATURED_POST/)
  assert.match(rewards, /sourceId: input\.postId/)
})

test('每日挂号仍是合法经验入口并保留现有挂号费与经验奖励流程', () => {
  const checkinRoute = read('app/api/checkin/route.ts')

  assert.match(checkinRoute, /awardRegistrationFee\(tx/)
  assert.match(checkinRoute, /awardExperience\(tx/)
  assert.match(checkinRoute, /type: 'CHECKIN'/)
  assert.match(checkinRoute, /sourceType: EXPERIENCE_REWARD_SOURCES\.CHECK_IN/)
  assert.match(checkinRoute, /data: \{ points: gainedPoints, exp: gainedExp \}/)
})

test('管理员接口不再接受直接写入 legacy exp', () => {
  const route = read('app/api/admin/users/[userId]/route.ts')
  assert.match(route, /经验值只能通过每日挂号或精华帖子奖励增加/)
  assert.match(route, /body\?\.exp !== undefined \|\| body\?\.experience !== undefined \|\| body\?\.experiencePoints !== undefined/)
  assert.doesNotMatch(route, /data\.exp\s*=/)
})
