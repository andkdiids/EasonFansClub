import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { safeDb } from '@/lib/db-timeout'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const user = await getCurrentUser()
  if (!user) return NextResponse.json({ message: '请先登录' }, { status: 401 })

  const messages = await safeDb(
    'profile.messages',
    prisma.dailyMessage.findMany({
      where: { userId: user.id, isDeleted: false },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: {
        id: true,
        mood: true,
        content: true,
        createdAt: true,
        likeCount: true,
        commentCount: true,
        DailyMessageComment: {
          where: { isDeleted: false },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            content: true,
            createdAt: true,
            User: {
              select: {
                id: true,
                nickname: true,
                avatarUrl: true,
                Profile: { select: { displayName: true, avatarUrl: true } },
              },
            },
          },
        },
      },
    }),
    [],
  )

  const remarkMap = await loadFriendRemarkMap(user.id, messages.flatMap((message) => message.DailyMessageComment.map((comment) => comment.User.id)))
  const mapped = messages.map((message) => ({
    id: message.id,
    mood: message.mood,
    content: message.content,
    createdAt: message.createdAt,
    likeCount: message.likeCount,
    commentCount: message.commentCount,
    comments: message.DailyMessageComment.map((comment) => ({
      id: comment.id,
      content: comment.content,
      createdAt: comment.createdAt,
      authorName: comment.User
        ? resolveFriendDisplayName({
            viewerId: user.id,
            targetUserId: comment.User.id,
            fallbackName: getPublicUserDisplayName(comment.User),
            remarkMap,
          })
        : '匿名用户',
      authorAvatarUrl: comment.User?.Profile?.avatarUrl || comment.User?.avatarUrl || null,
    })),
  }))

  return NextResponse.json({ messages: mapped })
}
