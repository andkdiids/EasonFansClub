import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { COMMUNITY_REWARD_LIMITS, COMMUNITY_REWARD_POINTS } from '@/lib/community-rewards'
import { getGrowthTask, getRewardRuleGroups } from '@/lib/growth-tasks/registry'
import { isQualifiedPublishedPost } from '@/lib/post-moderation'

const read = (path: string) => readFileSync(path, 'utf8')

test('回复帖子和帖子被回复共用社区账本的真实额度', () => {
  const reply = getGrowthTask('DAILY_COMMENT')
  const received = getGrowthTask('POST_COMMENT_RECEIVED')
  assert.equal(reply?.reward, COMMUNITY_REWARD_POINTS.commentPost)
  assert.equal(reply?.dailyCap, COMMUNITY_REWARD_LIMITS.commentPostDaily)
  assert.equal(reply?.completionThreshold, 1)
  assert.equal(received?.reward, COMMUNITY_REWARD_POINTS.postCommentReceived)
  assert.equal(received?.dailyCap, COMMUNITY_REWARD_LIMITS.postCommentReceivedDaily)
  assert.equal(received?.dailyCap, 5)
  assert.equal(received?.reward, 2)
  const rewards = read('lib/community-rewards.ts')
  assert.match(rewards, /getPositiveRewardEventCount/)
  assert.match(rewards, /authorRewardEvents < COMMUNITY_REWARD_LIMITS\.postCommentReceivedDaily/)
  assert.match(rewards, /commenterRewardEvents < COMMUNITY_REWARD_LIMITS\.commentPostDaily/)
  assert.match(read('app/api/posts/[postId]/replies/route.ts'), /awardCommunityCommentRewards/)
})

test('任务列表只输出状态和进度，奖励金额集中在展开的规则区', () => {
  const panel = read('components/GrowthPanel.tsx')
  const listStart = panel.indexOf('growth-core-list')
  const branchStart = panel.indexOf('growth-passive-section')
  const taskListSource = panel.slice(listStart, branchStart)
  assert.ok(listStart >= 0 && branchStart > listStart)
  assert.match(taskListSource, /formatTodayProgress/)
  assert.doesNotMatch(taskListSource, /formatTodayReward|\+\$\{|\+1\/次|\+2\/次|\+14|\+27|\+50|\+74/)
  assert.match(panel, /overview\.rewardRules\.map/)
  assert.match(panel, /<details className="growth-panel-section growth-reward-rules">/)
  assert.match(panel, /<summary>支线/)
  assert.doesNotMatch(panel, />被动奖励</)
})

test('奖励规则覆盖回复、点赞、分享、发帖、收到回复和周奖励', () => {
  const groups = getRewardRuleGroups()
  const rules = groups.flatMap((group) => group.items)
  const rule = (code: string) => rules.find((item) => item.code === code)
  assert.equal(rule('DAILY_COMMENT')?.amount, 1)
  assert.equal(rule('DAILY_COMMENT')?.dailyCap, 10)
  assert.equal(rule('POST_LIKE_ACTIVE')?.amount, 1)
  assert.equal(rule('POST_LIKE_ACTIVE')?.dailyCap, 5)
  assert.equal(rule('CONTENT_SHARE_ACTIVE')?.amount, 2)
  assert.equal(rule('CONTENT_SHARE_ACTIVE')?.dailyCap, 1)
  assert.equal(rule('PUBLISH_POST_ACTIVE')?.amount, 2)
  assert.equal(rule('PUBLISH_POST_ACTIVE')?.dailyCap, 1)
  assert.equal(rule('PUBLISH_POST_ACTIVE')?.weeklyCap, 7)
  assert.equal(rule('PUBLISH_POST_ACTIVE')?.maxWeeklyAmount, 14)
  assert.equal(rule('POST_COMMENT_RECEIVED')?.amount, 2)
  assert.equal(rule('POST_COMMENT_RECEIVED')?.dailyCap, 5)
  assert.equal(rule('POST_COMMENT_RECEIVED')?.maxDailyAmount, 10)
  assert.deepEqual(
    groups.find((group) => group.key === 'weekly')?.items.map((item) => [item.amount, item.milestoneDays]),
    [[27, 3], [50, 5], [74, 7]],
  )
})

test('任意娱乐模式只有正式结算才写入 DAILY_GAME，1v1 进入支线', () => {
  const game = getGrowthTask('DAILY_GAME')
  const duel = getGrowthTask('LISTEN_DUEL_BRANCH')
  assert.equal(game?.dailyCap, 1)
  assert.equal(game?.completionThreshold, 1)
  assert.equal(game?.actionHref, '/games')
  assert.equal(duel?.actionHref, '/games/guess-song/duel')
  assert.match(read('lib/growth-tasks/service.ts'), /recordEntertainmentGameCompletion/)
  assert.match(read('lib/guess-song-session.ts'), /recordEntertainmentGameCompletion/)
  assert.match(read('lib/want-listen.ts'), /recordEntertainmentGameCompletion/)
  assert.match(read('lib/guess-song-duel-service.ts'), /recordEntertainmentGameCompletion/)
  assert.match(read('lib/undercover-star.ts'), /recordEntertainmentGameCompletion/)
  assert.match(read('lib/guess-song-duel-service.ts'), /input\.valid/)
  assert.match(read('lib/undercover-star.ts'), /reason !== 'UNDERCOVER_EXIT'/)
  assert.equal(read('lib/growth-tasks/service.ts').match(/taskCode:\s*'DAILY_GAME'/g)?.length, 1)
})

test('发布帖子只认统一公开资格，普通待审不会奖励，免审公开无需伪造审核', () => {
  const helper = read('lib/post-moderation.ts')
  const service = read('lib/growth-tasks/service.ts')
  const postRoute = read('app/api/posts/route.ts')
  const reviewRoute = read('app/api/admin/posts/review/route.ts')
  const publish = getGrowthTask('PUBLISH_POST_ACTIVE')
  const post = (status: string, moderationStatus: string, isDeleted = false) => ({ status, moderationStatus, isDeleted })
  assert.equal(publish?.reward, 2)
  assert.equal(publish?.dailyCap, 1)
  assert.equal(publish?.weeklyCap, 7)
  assert.equal(publish?.actionHref, '/posts/new')
  assert.equal(isQualifiedPublishedPost(post('PUBLISHED', 'APPROVED')), true)
  assert.equal(isQualifiedPublishedPost(post('PUBLISHED', 'PENDING')), false)
  assert.equal(isQualifiedPublishedPost(post('PUBLISHED', 'REJECTED')), false)
  assert.equal(isQualifiedPublishedPost(post('PUBLISHED', 'APPROVED', true)), false)
  assert.match(helper, /isDeleted === false && post\.status === 'PUBLISHED' && post\.moderationStatus === 'APPROVED'/)
  assert.match(service, /stableBusinessKey\(\['published-post', input\.userId, input\.postId\]\)/)
  assert.match(service, /capWindows/)
  assert.match(postRoute, /moderationStatus === 'APPROVED'[\s\S]*recordQualifiedPublishedPostGrowth/)
  assert.match(reviewRoute, /status === 'APPROVED'[\s\S]*recordQualifiedPublishedPostGrowth/)
  assert.doesNotMatch(service, /role === ['"]ADMIN['"]|approvedById|ReviewLog/)
})
