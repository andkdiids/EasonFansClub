import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  COMMUNITY_REWARD_LIMITS,
  COMMUNITY_REWARD_POINTS,
  getShanghaiWeekKey,
} from '../lib/community-rewards'

const read = (path: string) => readFileSync(path, 'utf8')

test('社区互动奖励按上海时间的自然周周一归档', () => {
  assert.equal(getShanghaiWeekKey(new Date('2026-08-10T00:30:00+08:00')), '2026-08-10')
  assert.equal(getShanghaiWeekKey(new Date('2026-08-16T23:59:59+08:00')), '2026-08-10')
  // 2026-08-09T16:30Z is already Monday 00:30 in Asia/Shanghai.
  assert.equal(getShanghaiWeekKey(new Date('2026-08-09T16:30:00.000Z')), '2026-08-10')
})

test('社区奖励额度与奖励来源保持独立', () => {
  assert.deepEqual(COMMUNITY_REWARD_POINTS, {
    postCommentReceived: 1,
    commentPost: 2,
    featuredPost: 27,
    featuredPostExperience: 27,
  })
  assert.deepEqual(COMMUNITY_REWARD_LIMITS, {
    postCommentReceivedDaily: 10,
    commentPostDaily: 10,
    featuredPostDaily: 1,
  })
})

test('发帖不再写入挂号费，评论与精华走可幂等的社区奖励服务', () => {
  const postRoute = read('app/api/posts/route.ts')
  const replyRoute = read('app/api/posts/[postId]/replies/route.ts')
  const deleteRoute = read('app/api/replies/[replyId]/route.ts')
  const featureRoute = read('app/api/posts/[postId]/route.ts')
  const rewards = read('lib/community-rewards.ts')
  const fee = read('lib/registration-fee.ts')

  assert.doesNotMatch(postRoute, /awardRegistrationFee|POST_DAILY_FIRST|getRandomPostRegistrationFee/)
  assert.match(replyRoute, /checkForbiddenWords/)
  assert.match(replyRoute, /awardCommunityCommentRewards/)
  assert.match(deleteRoute, /reverseCommunityCommentRewards/)
  assert.match(featureRoute, /awardFeaturedPostRewards/)
  assert.match(rewards, /businessKey: `community:comment-post:/)
  assert.match(rewards, /action: 'POST_COMMENT_RECEIVED'/)
  assert.match(rewards, /action: 'COMMENT_POST'/)
  assert.match(rewards, /action: 'FEATURED_POST'/)
  assert.match(rewards, /reverseRegistrationFee/)
  assert.match(fee, /action: 'COMMENT_REVOKE'/)
})
