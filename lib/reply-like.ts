import type { NotificationReplyTarget } from '@/lib/notification-target'

/**
 * 回复类通知「快捷点赞」的纯决策层（客户端 / 服务端共用，无任何副作用、不依赖数据库）。
 *
 * 设计约束（生产事故修复）：
 * - 点赞目标恒为通知 focus 指向的「对方新回复」= target.parentId。
 *   绝不返回 target.resourceId（帖子本身 / 主留言 / 留言墙主人 uid），
 *   也绝不返回 focus 的 parentId（被回复的原评论 / 接收者自己的评论）——后者根本不在
 *   NotificationReplyTarget 结构中，从源头杜绝上一版误点赞「我的原评论」的问题。
 * - 三类回复复用既有点赞能力：帖子回复→ReplyLike、评论回复→DailyMessageCommentLike、
 *   留言墙→ProfileWallLike；feedback 无既有点赞能力且按需求不新增无关模型 → 不支持。
 */

export type ReplyLikeKind = 'post' | 'daily-message' | 'profile-wall'
export type ReplySourceKind = ReplyLikeKind | 'feedback'

/** 仅这三类具备既有点赞能力；feedback 等一律不展示快捷点赞。 */
export function isReplyLikeSupported(kind: string | null | undefined): kind is ReplyLikeKind {
  return kind === 'post' || kind === 'daily-message' || kind === 'profile-wall'
}

/**
 * 解析快捷点赞目标 ID：只取 focus（target.parentId = 对方新回复）。
 * 返回 null 表示「不展示可用点赞按钮」（无 target / 不支持类型 / focus 缺失或非法 / 疑似指向原内容）。
 */
export function resolveReplyLikeTargetId(target: NotificationReplyTarget | null | undefined): string | null {
  if (!target) return null
  if (!isReplyLikeSupported(target.kind)) return null
  const focusId = target.parentId
  if (!focusId) return null
  // 防御性不变量：focus 绝不能等于被回复的原内容 id（帖子 / 主留言 / 留言墙主人）。
  // 真实数据中二者类型/取值本就不同，此判断保证任何畸形链接都不会误点原内容。
  if (focusId === target.resourceId) return null
  return focusId
}

export type ReplyLikeEndpoint = { url: string; method: 'POST' | 'DELETE' }

/**
 * 按来源把点赞目标路由到既有点赞端点，并决定 HTTP 方法。
 * - 帖子回复 /api/replies/[replyId]/like：POST 点赞、DELETE 取消（与详情页一致）。
 * - 评论回复 /api/daily-message-comments/[commentId]/like：POST 点赞、DELETE 取消。
 * - 留言墙 /api/profile-wall/[messageId]/like：POST 幂等切换（无独立 DELETE），点赞/取消均 POST。
 */
export function resolveReplyLikeEndpoint(kind: ReplyLikeKind, targetId: string, nextLiked: boolean): ReplyLikeEndpoint {
  const encoded = encodeURIComponent(targetId)
  if (kind === 'post') {
    return { url: `/api/replies/${encoded}/like`, method: nextLiked ? 'POST' : 'DELETE' }
  }
  if (kind === 'profile-wall') {
    return { url: `/api/profile-wall/${encoded}/like`, method: 'POST' }
  }
  return { url: `/api/daily-message-comments/${encoded}/like`, method: nextLiked ? 'POST' : 'DELETE' }
}

/**
 * 归一化不同端点的返回字段名：帖子回复 / 评论回复用 isLiked，留言墙用 liked。
 * 结构不合法时返回 null（调用方保留乐观值，不写坏状态）。
 */
export function normalizeReplyLikeResponse(
  kind: ReplyLikeKind,
  data: unknown,
): { liked: boolean; likeCount: number } | null {
  if (!data || typeof data !== 'object') return null
  const row = data as { isLiked?: unknown; liked?: unknown; likeCount?: unknown }
  const rawLiked = kind === 'profile-wall' ? row.liked : row.isLiked
  if (typeof rawLiked !== 'boolean') return null
  if (typeof row.likeCount !== 'number' || !Number.isFinite(row.likeCount)) return null
  return { liked: rawLiked, likeCount: row.likeCount }
}
