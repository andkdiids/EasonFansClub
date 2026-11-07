import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

const client = read('app/notifications/NotificationsClient.tsx')
const service = read('lib/notifications.ts')
const helper = read('lib/reply-like.ts')
const route = read('app/api/daily-message-comments/[commentId]/like/route.ts')
const schema = read('prisma/schema.prisma')

test('通知来源标签来自真实 replySourceKind，覆盖帖子回复 / 评论回复 / 留言墙', () => {
  // 服务端按真实 replyTarget.kind 推导来源，不靠文案猜测。
  assert.match(service, /replySourceKind = target\.kind/)
  // 客户端映射来源标签（反馈回复不在快捷点赞范围内，标签按"不影响其他通知类型"处理为不展示）。
  assert.match(client, /REPLY_SOURCE_LABELS/)
  assert.match(client, /post: '帖子回复'/)
  assert.match(client, /'daily-message': '评论回复'/)
  assert.match(client, /'profile-wall': '留言墙'/)
  // 来源标签与「未读」并列渲染，且使用独立的中性描边样式，与阅读状态（实心天蓝）明确区分。
  assert.match(client, /sourceLabel \? <span[^>]*ring-slate-200[^>]*>\{sourceLabel\}/)
})

test('回复通知标题直接用「用户名：回复内容」，复用标题样式并限制两行', () => {
  assert.match(client, /isReplyTitleOptimization = item\.type === 'REPLY' && Boolean\(displayReplyPreview\)/)
  assert.match(client, /const titleContent = isReplyTitleOptimization[\s\S]*?\$\{displayReplyPreview\}/)
  assert.match(client, /notification-title mt-0\.5[\s\S]*?line-clamp-2/)
  assert.match(client, /isReplyNotification && displayReplyPreview && !isReplyTitleOptimization \?/)
})

test('快捷点赞按钮对所有具备合法点赞目标的回复通知展示（不再仅限评论回复）', () => {
  // 生产事故修复：此前按钮被硬编码为仅 daily-message，帖子回复 / 留言墙通知永远看不到按钮。
  // 现在统一以「是否存在可访问的点赞目标」为唯一判据。
  assert.match(client, /\{item\.replyLikeTargetId \? \(/)
  assert.doesNotMatch(client, /replySourceKind === 'daily-message' && item\.replyLikeTargetId/)
  // 后端仅对可访问目标下发 replyLikeTargetId；无效 / 已删除 / 不可访问为 null，按钮自动隐藏。
  assert.match(client, /后端只会对可访问的点赞目标下发该字段/)
  // 端点 / 方法 / 返回值归一化委托给可单测的纯函数（三类共享同一决策层）。
  assert.match(client, /resolveReplyLikeEndpoint\(sourceKind, targetId, nextLiked\)/)
  assert.match(client, /normalizeReplyLikeResponse\(sourceKind, data\)/)
  assert.match(client, /isReplyLikeSupported\(sourceKind\)/)
})

test('快捷点赞状态实时同步：乐观切换后写入服务端权威返回', () => {
  assert.match(client, /const nextLiked = !currentState\.liked/)
  assert.match(client, /const optimisticState = \{ liked: nextLiked, likeCount: nextLikeCount \}/)
  assert.match(client, /replyLikeState: optimisticState/)
  // 成功时用「归一化后的权威状态」覆盖乐观值（不同端点字段名 isLiked / liked 由纯函数统一）。
  assert.match(client, /const resolved = normalizeReplyLikeResponse\(sourceKind, data\)/)
  assert.match(client, /replyLikeState: resolved/)
})

test('快捷点赞请求失败时回滚，且防止重复点击', () => {
  assert.match(client, /catch \{[\s\S]*?replyLikeState: currentState/)
  assert.match(client, /commentLikePendingRef\.current\.has\(itemKey\)\) return/)
})

test('快捷点赞事件隔离：不触发跳转 / 已读，且阻止冒泡与默认行为', () => {
  // 锚定「快捷点赞按钮」本身（以其特征 aria-label 起手），避免误吞卡片主 onClick。
  const likeButton = client.match(
    /aria-label=\{item\.replyLikeState\?\.liked \? '取消点赞' : '点赞'\}[\s\S]*?onClick=\{\(event\) => \{[\s\S]*?void toggleReplyLike\(item\)[\s\S]*?\}\}/,
  )?.[0]
  assert.ok(likeButton, '应能匹配到快捷点赞按钮（含 aria-label 与 onClick）')
  assert.match(likeButton, /event\.preventDefault\(\)/)
  assert.match(likeButton, /event\.stopPropagation\(\)/)
  assert.match(likeButton, /void toggleReplyLike\(item\)/)
  assert.doesNotMatch(likeButton, /navigateToNotification|markRead/)
})

test('桌面与移动端：按钮流式排布自动换行、可点击尺寸', () => {
  assert.match(client, /mt-1 flex flex-wrap items-center justify-between gap-1\.5 pt-1/)
  assert.match(client, /flex flex-wrap items-center gap-1/)
  assert.match(client, /inline-flex min-h-8 items-center gap-1/)
})

test('评论点赞有独立数据模型与迁移；帖子回复 / 留言墙复用既有模型，不新增无关模型', () => {
  const migrationDir = 'prisma/migrations/20261107090000_add_daily_message_comment_like'
  assert.ok(existsSync(`${migrationDir}/migration.sql`), 'migration.sql 应存在')
  const migration = read(`${migrationDir}/migration.sql`)

  assert.match(schema, /model DailyMessageCommentLike \{/)
  assert.match(schema, /@@unique\(\[commentId, userId\]\)/)
  assert.match(migration, /CREATE TABLE `DailyMessageCommentLike`/)
  // 帖子回复 / 留言墙复用既有 ReplyLike / ProfileWallLike，不新建模型、不新增 migration 目录。
  assert.match(schema, /model ReplyLike \{/)
  assert.match(schema, /model ProfileWallLike \{/)
  assert.match(service, /prisma\.replyLike\.(findMany|groupBy)/)
  assert.match(service, /prisma\.profileWallLike\.(findMany|groupBy)/)
  assert.doesNotMatch(helper, /prisma|CREATE TABLE|migration/i)
  // 点赞目标由纯函数统一裁定为 focus（对方新回复），绝不误用原评论 / 原帖子。
  assert.match(service, /const focusId = resolveReplyLikeTargetId\(target\)/)
  assert.match(helper, /return focusId/)
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
  assert.match(route, /import \{ removeDailyMessageCommentLike, toggleDailyMessageCommentLike \} from '@\/lib\/daily-message-comment-like'/)
  assert.match(route, /toggleDailyMessageCommentLike\(prisma, commentId, guard\.user\.id\)/)
  assert.match(route, /removeDailyMessageCommentLike\(prisma, commentId, guard\.user\.id\)/)
  assert.match(route, /return NextResponse\.json\(result\)/)
})
