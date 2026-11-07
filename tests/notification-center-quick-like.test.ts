import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

const client = read('app/notifications/NotificationsClient.tsx')
const service = read('lib/notifications.ts')
const route = read('app/api/daily-message-comments/[commentId]/like/route.ts')
const schema = read('prisma/schema.prisma')

test('通知来源标签来自真实 replySourceKind，覆盖帖子回复 / 评论回复 / 留言墙', () => {
  // 服务端按真实 replyTarget.kind 推导来源，不靠文案猜测。
  assert.match(service, /replySourceKind = target\.kind/)
  // 客户端映射来源标签（反馈回复不在需求范围内，按"不影响其他通知类型"处理为不展示）。
  assert.match(client, /REPLY_SOURCE_LABELS/)
  assert.match(client, /post: '帖子回复'/)
  assert.match(client, /'daily-message': '评论回复'/)
  assert.match(client, /'profile-wall': '留言墙'/)
  // 来源标签与「未读」并列渲染，且使用独立的中性描边样式，与阅读状态（实心天蓝）明确区分。
  assert.match(client, /sourceLabel \? <span[^>]*ring-slate-200[^>]*>\{sourceLabel\}/)
})

test('回复通知标题直接用「用户名：回复内容」，复用标题样式并限制两行', () => {
  // 移除固定标题（如「你的帖子有新回复」），对 REPLY 类型改用 actorName：replyPreview 作为主标题。
  assert.match(client, /isReplyTitleOptimization = item\.type === 'REPLY' && Boolean\(displayReplyPreview\)/)
  assert.match(client, /const titleContent = isReplyTitleOptimization[\s\S]*?\$\{displayReplyPreview\}/)
  // 主标题复用 .notification-title 的字号/字重/视觉位置，并限制最多两行、超出省略。
  assert.match(client, /notification-title mt-0\.5[\s\S]*?line-clamp-2/)
  // 回复内容不再作为缩小的副标题渲染（REPLY 优化时跳过 reply-preview 块）。
  assert.match(client, /isReplyNotification && displayReplyPreview && !isReplyTitleOptimization \?/)
})

test('评论回复快捷点赞按钮仅在目标真实可访问时展示，并调用专属 API', () => {
  // 仅在评论回复且点赞目标（被对方回复的那条评论）存在时展示按钮；目标无效/已删除/不可访问时为 null，按钮自动隐藏。
  assert.match(client, /item\.replySourceKind === 'daily-message' && item\.replyLikeTargetId \?/)
  // 点赞 / 取消点赞分别使用 POST / DELETE 同一端点。
  assert.match(client, /\/api\/daily-message-comments\/\$\{encodeURIComponent\(targetId\)\}\/like/)
  assert.match(client, /method: nextLiked \? 'POST' : 'DELETE'/)
})

test('快捷点赞状态实时同步：乐观切换后写入服务端权威返回', () => {
  assert.match(client, /const nextLiked = !currentState\.liked/)
  assert.match(client, /const optimisticState = \{ liked: nextLiked, likeCount: nextLikeCount \}/)
  assert.match(client, /replyLikeState: optimisticState/)
  // 成功时用服务端返回覆盖（isLiked / likeCount）。
  assert.match(client, /replyLikeState: \{ liked: data\.isLiked[\s\S]*?likeCount: data\.likeCount/)
})

test('快捷点赞请求失败时回滚，且防止重复点击', () => {
  // 失败回滚：catch 中将 replyLikeState 还原为操作前状态 currentState。
  assert.match(client, /catch \{[\s\S]*?replyLikeState: currentState/)
  // 防重复点击：按 source:id 去重，进行中直接返回。
  assert.match(client, /commentLikePendingRef\.current\.has\(itemKey\)\) return/)
})

test('快捷点赞事件隔离：不触发跳转 / 已读，且阻止冒泡与默认行为', () => {
  // 锚定「快捷点赞按钮」本身（以其特征 aria-label 起手），避免误吞卡片主 onClick。
  const likeButton = client.match(
    /aria-label=\{item\.replyLikeState\?\.liked \? '取消点赞' : '点赞'\}[\s\S]*?onClick=\{\(event\) => \{[\s\S]*?void toggleCommentLike\(item\)[\s\S]*?\}\}/,
  )?.[0]
  assert.ok(likeButton, '应能匹配到快捷点赞按钮（含 aria-label 与 onClick）')
  // 处理块内阻止冒泡与默认行为，仅调用点赞切换，不触发整卡跳转 / 已读。
  assert.match(likeButton, /event\.preventDefault\(\)/)
  assert.match(likeButton, /event\.stopPropagation\(\)/)
  assert.match(likeButton, /void toggleCommentLike\(item\)/)
  assert.doesNotMatch(likeButton, /navigateToNotification|markRead/)
})

test('评论点赞有独立数据模型与迁移，且不可访问评论不下发点赞目标', () => {
  const migrationDir = 'prisma/migrations/20261107090000_add_daily_message_comment_like'
  assert.ok(existsSync(`${migrationDir}/migration.sql`), 'migration.sql 应存在')
  const migration = read(`${migrationDir}/migration.sql`)

  assert.match(schema, /model DailyMessageCommentLike \{/)
  assert.match(schema, /@@unique\(\[commentId, userId\]\)/)
  assert.match(migration, /CREATE TABLE `DailyMessageCommentLike`/)

  // 点赞目标必须是对方回复的 focus 评论（target.parentId 即 notification 的 focus），
  // 绝不是 focusComment.parentId（被回复的原评论）。可见性按 focus 评论自身判定。
  assert.match(service, /const focusCommentId = target\.parentId/)
  assert.match(service, /if \(focusCommentId && visibleFocusCommentIds\.has\(focusCommentId\)\)/)
  assert.match(service, /replyLikeTargetId = focusCommentId/)
  // 反向确认：绝不用「被回复的原评论」(focus 评论的 parentId) 作为点赞目标。
  assert.doesNotMatch(service, /replyLikeTargetId = focusComment\?\.parentId/)

  // 点赞路由对不可访问评论返回 404，不暴露可操作点赞入口。
  assert.match(route, /评论不存在或不可访问/)
  assert.match(route, /status: 404/)
})

test('评论点赞路由委托纯函数做幂等切换，并返回权威点赞计数', () => {
  assert.match(route, /export async function POST/)
  assert.match(route, /export async function DELETE/)
  assert.match(route, /requireRequestUser/)
  assert.match(route, /enforceApiRateLimit/)
  // 路由把核心切换逻辑委托给可单测的纯函数（POST=toggle，DELETE=remove）。
  assert.match(route, /import \{ removeDailyMessageCommentLike, toggleDailyMessageCommentLike \} from '@\/lib\/daily-message-comment-like'/)
  assert.match(route, /toggleDailyMessageCommentLike\(prisma, commentId, guard\.user\.id\)/)
  assert.match(route, /removeDailyMessageCommentLike\(prisma, commentId, guard\.user\.id\)/)
  assert.match(route, /return NextResponse\.json\(result\)/)
})
