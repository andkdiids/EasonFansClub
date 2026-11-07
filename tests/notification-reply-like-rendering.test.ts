import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

const service = read('lib/notifications.ts')
const client = read('app/notifications/NotificationsClient.tsx')
const schema = read('prisma/schema.prisma')
const repliesLike = read('app/api/replies/[replyId]/like/route.ts')
const wallLike = read('app/api/profile-wall/[messageId]/like/route.ts')
const wallComponent = read('components/ProfileWall.tsx')

// 通知渲染测试：验证服务端 hydration 与客户端渲染对三类回复通知都产出「可见的快捷点赞」，
// 且按钮在删除 / 不可访问时隐藏、不跳转 / 不误标已读，桌面移动端均展示。
// 结合 tests/reply-like-behavior.test.ts 的纯函数真实行为测试，构成完整回归。

test('服务端对三类回复通知都下发 replyLikeTargetId / replyLikeState（基于真实可访问集合）', () => {
  // 统一的 focus 目标裁定（对方新回复），三类分支各自用真实可见集合二次校验。
  assert.match(service, /const focusId = resolveReplyLikeTargetId\(target\)/)
  assert.match(service, /target\.kind === 'post' && validPostReplyIdSet\.has\(focusId\)/)
  assert.match(service, /target\.kind === 'daily-message' && visibleFocusCommentIds\.has\(focusId\)/)
  assert.match(service, /target\.kind === 'profile-wall' && validWallMessageIdSet\.has\(focusId\)/)
  // 三类都赋值 replyLikeState（liked + likeCount），保证按钮有初始状态可渲染。
  const assignments = service.match(/replyLikeState = \{[\s\S]*?likeCount:/g) || []
  assert.ok(assignments.length >= 3, `应至少 3 处 replyLikeState 赋值，实际 ${assignments.length}`)
})

test('帖子回复：复用既有 ReplyLike / api/replies like，点赞目标=对方新回复的 reply id', () => {
  // 用 reply id（focus）查询点赞状态与计数，而非帖子 id。
  assert.match(service, /prisma\.replyLike\.findMany\(\{[\s\S]*?replyId: \{ in: Array\.from\(validPostReplyIdSet\) \}/)
  assert.match(service, /prisma\.replyLike\.groupBy\(\{[\s\S]*?by: \['replyId'\]/)
  assert.match(schema, /model ReplyLike \{[\s\S]*?replyId\s+String[\s\S]*?@@unique\(\[replyId, userId\]\)/)
  // 可见集合构造：回复必须真实存在、归属正确帖子、未删除。
  assert.match(service, /reply && reply\.postId === target\.resourceId && !reply\.isDeleted/)
  // 既有帖子回复点赞 API 支持 POST（点赞）与 DELETE（取消），返回 isLiked/likeCount。
  assert.match(repliesLike, /export async function POST/)
  assert.match(repliesLike, /export async function DELETE/)
  assert.match(repliesLike, /isLiked: !existing/)
  assert.match(repliesLike, /requireRequestUser/)
})

test('评论回复：继续使用 DailyMessageCommentLike / api/daily-message-comments like', () => {
  assert.match(service, /visibleFocusCommentIds\.has\(focusId\)/)
  assert.match(service, /likedFocusCommentIds\.has\(focusId\)/)
  assert.match(schema, /model DailyMessageCommentLike \{/)
})

test('留言墙：复用既有 ProfileWallLike / api/profile-wall like（无独立 DELETE，POST 幂等切换）', () => {
  // 有既有点赞能力：模型 + 端点 + 详情页组件都在，不新增无关数据库模型。
  assert.match(schema, /model ProfileWallLike \{[\s\S]*?@@unique\(\[messageId, userId\]\)/)
  assert.match(wallLike, /export async function POST/)
  assert.doesNotMatch(wallLike, /export async function DELETE/)
  assert.match(wallLike, /liked: !existing, likeCount/)
  assert.match(wallComponent, /\/api\/profile-wall\/\$\{messageId\}\/like/)
  // 服务端用 message id（focus）查询点赞状态与计数。
  assert.match(service, /prisma\.profileWallLike\.findMany\(\{[\s\S]*?messageId: \{ in: Array\.from\(validWallMessageIdSet\) \}/)
  assert.match(service, /prisma\.profileWallLike\.groupBy\(\{[\s\S]*?by: \['messageId'\]/)
  // 可见集合构造：留言必须真实存在、未删除、确属接收者自己的留言墙（沿用既有 uid 校验）。
  assert.match(service, /String\(row\.User_ProfileWallMessage_receiverIdToUser\.uid\) === String\(Number\(target\.resourceId\)\)/)
  assert.match(service, /deletedAt: null/)
})

test('删除 / 不可访问的回复不下发可用点赞按钮（replyLikeTargetId 保持 null）', () => {
  // 三类各自的可访问集合为权威：不在集合内则不赋值，前端 {item.replyLikeTargetId ? ...} 自动隐藏。
  assert.match(service, /let replyLikeTargetId: string \| null = null/)
  assert.match(service, /if \(focusId\) \{/)
  assert.match(service, /validPostReplyIdSet\.has\(focusId\)/)
  assert.match(service, /visibleFocusCommentIds\.has\(focusId\)/)
  assert.match(service, /validWallMessageIdSet\.has\(focusId\)/)
  assert.match(client, /\{item\.replyLikeTargetId \? \(/)
})

test('客户端渲染：单一按钮条件覆盖三类，图标 / 计数 / 点赞态 / 防抖禁用齐全', () => {
  assert.match(client, /aria-pressed=\{item\.replyLikeState\?\.liked \?\? false\}/)
  assert.match(client, /aria-label=\{item\.replyLikeState\?\.liked \? '取消点赞' : '点赞'\}/)
  assert.match(client, /disabled=\{commentLikePending\.has\(itemKey\)\}/)
  assert.match(client, /<span aria-hidden>♥<\/span>/)
  assert.match(client, /<span>\{item\.replyLikeState\?\.likeCount \?\? 0\}<\/span>/)
  // 点赞态用 rose 高亮、未点赞用中性描边，深色模式下亦可读（跟随 CSS 变量 / 固定浅底）。
  assert.match(client, /border-rose-200 bg-rose-50 text-rose-600/)
})

test('客户端交互：不跳转 / 不误标已读、乐观切换 + 失败回滚、状态与详情页同源', () => {
  // 不跳转 / 不误标已读：按钮自身阻止冒泡与默认行为，且不含导航 / 已读调用。
  assert.match(client, /event\.preventDefault\(\)/)
  assert.match(client, /event\.stopPropagation\(\)/)
  const likeButton = client.match(
    /aria-label=\{item\.replyLikeState\?\.liked \? '取消点赞' : '点赞'\}[\s\S]*?void toggleReplyLike\(item\)[\s\S]*?\}\}/,
  )?.[0]
  assert.ok(likeButton)
  assert.doesNotMatch(likeButton, /navigateToNotification|markRead|markAsRead|router\.push/)
  // 乐观切换 + 服务端权威返回覆盖 + 失败回滚。
  assert.match(client, /const optimisticState = \{ liked: nextLiked, likeCount: nextLikeCount \}/)
  assert.match(client, /const resolved = normalizeReplyLikeResponse\(sourceKind, data\)/)
  assert.match(client, /catch \{[\s\S]*?replyLikeState: currentState/)
  // 端点与详情页一致（复用既有 API，而非另建一套点赞）。
  assert.match(client, /resolveReplyLikeEndpoint\(sourceKind, targetId, nextLiked\)/)
})
