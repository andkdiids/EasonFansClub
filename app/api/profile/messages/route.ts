import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { withDbTimeout } from '@/lib/db-timeout'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { publicImageUrl } from '@/lib/images'
import { getProfileRecordPagination } from '@/lib/profile-page'
import { prisma } from '@/lib/prisma'
import { publicModerationText } from '@/lib/content-moderation'
import { unauthenticatedResponse } from '@/lib/security'

export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user) return unauthenticatedResponse()

  const url = new URL(request.url)
  const requestedPage = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1)
  let messages
  let pagination
  try {
    const total = await withDbTimeout(
      'profile.messages.count',
      prisma.dailyMessage.count({ where: { userId: user.id, isDeleted: false } }),
      8000,
    )
    pagination = getProfileRecordPagination(total, requestedPage)
    messages = await withDbTimeout(
      'profile.messages',
      prisma.dailyMessage.findMany({
      where: { userId: user.id, isDeleted: false },
      orderBy: { createdAt: 'desc' },
      skip: (pagination.page - 1) * pagination.pageSize,
      take: pagination.pageSize,
      select: {
        id: true,
        mood: true,
        moodType: true,
        moodEmoji: true,
        moodText: true,
        content: true,
        moderationStatus: true,
        createdAt: true,
        ipRegion: true,
        likeCount: true,
        commentCount: true,
        DailyMessageComment: {
          where: { isDeleted: false },
          orderBy: { createdAt: 'asc' },
          select: {
            id: true,
            parentId: true,
            content: true,
            moderationStatus: true,
            createdAt: true,
            ipRegion: true,
            User: {
              select: {
                id: true,
                nickname: true,
                usernameModerationStatus: true,
                nicknameModerationStatus: true,
                nicknameViolationDisplay: true,
                avatarUrl: true,
                Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
              },
            },
          },
        },
      },
    }),
    )
  } catch (error) {
    console.error('[profile.messages]', error)
    return NextResponse.json(
      { message: '挂号留言暂时无法加载，请稍后重试' },
      { status: 503, headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } },
    )
  }

  const remarkMap = await loadFriendRemarkMap(user.id, messages.flatMap((message) => message.DailyMessageComment.map((comment) => comment.User.id)))
  const mapped = messages.map((message) => ({
    id: message.id,
    mood: message.mood,
    moodType: message.moodType,
    moodEmoji: message.moodEmoji,
    moodText: message.moodText,
    content: publicModerationText(message.content, message.moderationStatus),
    createdAt: message.createdAt,
    ipRegion: message.ipRegion,
    likeCount: message.likeCount,
    commentCount: message.commentCount,
    comments: message.DailyMessageComment.map((comment) => ({
      id: comment.id,
      parentId: comment.parentId,
      content: publicModerationText(comment.content, comment.moderationStatus),
      createdAt: comment.createdAt,
      ipRegion: comment.ipRegion,
      authorName: comment.User
        ? resolveFriendDisplayName({
            viewerId: user.id,
            targetUserId: comment.User.id,
            fallbackName: getPublicUserDisplayName(comment.User),
            remarkMap,
          })
        : '匿名用户',
      authorAvatarUrl: publicImageUrl(comment.User?.Profile?.avatarUrl || comment.User?.avatarUrl),
    })),
  }))

  return NextResponse.json({ messages: mapped, pagination }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' } })
}
