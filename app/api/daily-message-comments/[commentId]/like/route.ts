import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { enforceApiRateLimit, requireRequestUser } from '@/lib/security'
import { removeDailyMessageCommentLike, toggleDailyMessageCommentLike } from '@/lib/daily-message-comment-like'

type RouteContext = { params: Promise<{ commentId: string }> }

// 每日留言评论点赞。通知中心「评论回复」快捷点赞直接调用本路由，
// 点赞目标是对方回复的那条评论本身（即通知的 focus / commentId），
// 绝不是被回复的原评论（focus 评论的 parentId）。
//
// 注意：刻意不在此触发「点赞通知」(like-notification) 对账/写入。
// 本路由的首要消费场景是通知中心快捷点赞，其点赞目标通常是接收者自己评论下
// 对方留下的回复；为避免改动 lib/like-notifications 的 LikeNotificationTargetKind
// 联合类型与对账逻辑，这里只负责点赞状态的幂等切换与权威计数返回。
export async function POST(request: Request, context: RouteContext) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
    endpoint: '/api/daily-message-comments/like',
  }, '点赞操作过于频繁，请稍后再试')
  if (limited) return limited

  const { commentId } = await context.params
  const result = await toggleDailyMessageCommentLike(prisma, commentId, guard.user.id)
  if (!result) return NextResponse.json({ message: '评论不存在或不可访问' }, { status: 404 })
  return NextResponse.json(result)
}

export async function DELETE(request: Request, context: RouteContext) {
  const guard = await requireRequestUser(request)
  if (!guard.user) return guard.response
  const limited = await enforceApiRateLimit(request, guard.user.id, {
    ip: { limit: 120, windowSeconds: 60 },
    user: { limit: 60, windowSeconds: 60 },
    endpoint: '/api/daily-message-comments/like',
  }, '点赞操作过于频繁，请稍后再试')
  if (limited) return limited

  const { commentId } = await context.params
  const result = await removeDailyMessageCommentLike(prisma, commentId, guard.user.id)
  if (!result) return NextResponse.json({ message: '评论不存在或不可访问' }, { status: 404 })
  return NextResponse.json(result)
}
