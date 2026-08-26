import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { calculateGrowthSummary } from '../lib/growth'

const read = (path: string) => readFileSync(path, 'utf8')

test('反馈与更新只保留一个前台导航并支持旧路由', () => {
  const nav = read('lib/navigation-registry.ts')
  assert.match(nav, /featureKey: 'FEEDBACK',[\s\S]*label: '反馈与更新'/)
  assert.doesNotMatch(nav, /label: '更新日志'/)
  assert.match(read('app/changelog/page.tsx'), /redirect\('\/feedback\?tab=updates'\)/)
  assert.match(read('app/updates/page.tsx'), /redirect\('\/feedback\?tab=updates'\)/)
})

test('留言墙点赞由唯一约束和服务端事务保护', () => {
  const schema = read('prisma/schema.prisma')
  const route = read('app/api/profile-wall/[messageId]/like/route.ts')
  assert.match(schema, /model ProfileWallLike/)
  assert.match(schema, /@@unique\(\[messageId, userId\]\)/)
  assert.match(route, /profileWallLike\.findUnique/)
  assert.match(route, /profileWallLike\.count/)
  assert.match(route, /message\.senderId !== user\.id/)
})

test('私信只允许好友且一对用户只有一个 pairKey 会话', () => {
  const schema = read('prisma/schema.prisma')
  const conversations = read('app/api/direct-conversations/route.ts')
  const messages = read('app/api/direct-conversations/[conversationId]/messages/route.ts')
  assert.match(schema, /pairKey\s+String\?\s+@unique/)
  assert.match(conversations, /friendship\.findUnique/)
  assert.match(conversations, /conversation\.upsert/)
  assert.match(messages, /只能给好友发送私信/)
  assert.match(messages, /lastReadAt/)
})

test('UID 前导零搜索按数字 UID 精确匹配且不返回隐私字段', () => {
  const api = read('app/api/search/route.ts')
  assert.match(api, /\/\^\\d\+\$\//)
  assert.match(api, /\{ uid: Number\(numericUid\) \}/)
  assert.match(api, /status: 'ACTIVE'/)
  assert.doesNotMatch(api, /passwordHash|securityQuestion|phone: true|email: true/)
})

test('积分榜显示按 experience 批量计算的真实成长等级', () => {
  const page = read('app/rankings/page.tsx')
  assert.match(page, /orderBy: \{ points: 'desc' \}/)
  assert.match(page, /select: \{ id: true, nickname: true, points: true, experience: true \}/)
  assert.match(page, /listGrowthLevels\(\)/)
  assert.match(page, /calculateGrowthSummary\(u\.experience, growthLevels\)/)
  const levels = [{ level: 1, name: '初入E院', requiredExp: 0 }, { level: 2, name: '观察期', requiredExp: 1000 }]
  assert.equal(calculateGrowthSummary(0, levels).level, 1)
  assert.equal(calculateGrowthSummary(1000, levels).level, 2)
})

test('评论点赞和热门评论使用既有 ReplyLike 与统一热度公式', () => {
  const page = read('app/posts/[postId]/page.tsx')
  const component = read('components/PostRepliesSection.tsx')
  assert.match(page, /likeCount \* 2 \+ .*Replies \* 3/)
  assert.match(page, /\.slice\(0, 3\)/)
  assert.match(page, /reply\.likeCount >= 3/)
  assert.match(component, /\/api\/replies\/\$\{replyId\}\/like/)
  assert.match(component, /热门评论/)
})

test('社区互动奖励使用上海时间、行锁、业务键并移除发帖挂号费', () => {
  const post = read('app/api/posts/route.ts')
  const reply = read('app/api/posts/[postId]/replies/route.ts')
  const rewards = read('lib/community-rewards.ts')
  assert.doesNotMatch(post, /POST_DAILY_FIRST/)
  assert.doesNotMatch(post, /getRandomPostRegistrationFee/)
  assert.match(reply, /checkForbiddenWords/)
  assert.match(reply, /awardCommunityCommentRewards/)
  assert.match(rewards, /POST_COMMENT_RECEIVED/)
  assert.match(rewards, /COMMENT_POST/)
  assert.match(rewards, /getShanghaiWeekKey/)
  assert.match(rewards, /post-comment-received:/)
  assert.match(rewards, /comment-post:/)
})
