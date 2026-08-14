import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const postLikeRoute = read('app/api/posts/[postId]/like/route.ts')
const likeNotifications = read('lib/like-notifications.ts')
const postLikePost = postLikeRoute.slice(
  postLikeRoute.indexOf('export async function POST'),
  postLikeRoute.indexOf('export async function DELETE'),
)
const postLikeDelete = postLikeRoute.slice(postLikeRoute.indexOf('export async function DELETE'))
const duplicateBranch = postLikeRoute.slice(
  postLikeRoute.indexOf('const existing'),
  postLikeRoute.indexOf('await tx.like.create'),
)

const forbiddenRewardEffects = /awardRegistrationFee|awardExperience|POST_LIKE_RECEIVED|postLikeReceived|tx\.pointLog\.(?:create|update)|tx\.user\.update/

test('A liking B post only creates Like, updates count, and upserts its aggregate notification', () => {
  assert.match(postLikePost, /await tx\.like\.create\(/)
  assert.match(postLikePost, /await tx\.like\.count\(/)
  assert.match(postLikePost, /await tx\.post\.update\(/)
  assert.match(postLikePost, /syncLikeNotification\(/)
  assert.match(likeNotifications, /getLikeNotificationKey\(/)
  assert.match(likeNotifications, /notification\.upsert\(/)
  assert.match(likeNotifications, /type: 'LIKE'/)
  assert.doesNotMatch(postLikePost, forbiddenRewardEffects)
})

test('取消帖子点赞只删除 Like 并刷新数量，双方积分和经验保持不变', () => {
  assert.match(postLikeDelete, /await tx\.like\.deleteMany\(/)
  assert.match(postLikeDelete, /await tx\.like\.count\(/)
  assert.match(postLikeDelete, /await tx\.post\.update\(/)
  assert.match(postLikeDelete, /syncLikeNotification\([\s\S]*'unlike'/)
  assert.doesNotMatch(postLikeDelete, forbiddenRewardEffects)
})

test('重复点赞保持幂等，不进入创建或任何奖励副作用', () => {
  assert.match(duplicateBranch, /if \(existing\)/)
  assert.match(duplicateBranch, /return \{ isLiked: true, likeCount \}/)
  assert.doesNotMatch(duplicateBranch, forbiddenRewardEffects)
})

test('所有当前点赞/互动接口都不写入挂号费或经验奖励', () => {
  for (const path of [
    'app/api/posts/[postId]/like/route.ts',
    'app/api/replies/[replyId]/like/route.ts',
    'app/api/daily-messages/[messageId]/like/route.ts',
    'app/api/profile-wall/[messageId]/like/route.ts',
    'app/api/music/reviews/[reviewId]/interactions/route.ts',
  ]) {
    assert.doesNotMatch(read(path), forbiddenRewardEffects, path)
  }
  assert.doesNotMatch(read('lib/points.ts'), /postLikeReceived/)
})

test('评论奖励路径仍保留，未被点赞修复移除', () => {
  const replyRoute = read('app/api/posts/[postId]/replies/route.ts')
  const deleteReplyRoute = read('app/api/replies/[replyId]/route.ts')
  const rewards = read('lib/community-rewards.ts')

  assert.match(replyRoute, /awardCommunityCommentRewards\(/)
  assert.match(deleteReplyRoute, /reverseCommunityCommentRewards\(/)
  assert.match(rewards, /action: 'POST_COMMENT_RECEIVED'/)
  assert.match(rewards, /action: 'COMMENT_POST'/)
})

test('精华奖励路径仍保留挂号费和经验奖励', () => {
  const featureRoute = read('app/api/posts/[postId]/route.ts')
  const rewards = read('lib/community-rewards.ts')

  assert.match(featureRoute, /awardFeaturedPostRewards\(/)
  assert.match(rewards, /action: 'FEATURED_POST'/)
  assert.match(rewards, /sourceType: EXPERIENCE_REWARD_SOURCES\.FEATURED_POST/)
})
