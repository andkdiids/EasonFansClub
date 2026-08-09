import { profileImageUrl } from '@/lib/images'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { prisma } from '@/lib/prisma'

export type ProfileWallVisibility = 'PUBLIC' | 'FRIENDS' | 'CLOSED'

export type ProfileRecentMessage = {
  id: string
  mood: string | null
  content: string
  createdAt: string
  likeCount: number
  commentCount: number
  comments: Array<{
    id: string
    content: string
    createdAt: string
    authorName: string
    authorAvatarUrl: string | null
  }>
}

export async function loadProfileRecentMessages(userId: string, viewerId?: string | null): Promise<ProfileRecentMessage[]> {
  let rows: Array<{
    id: string
    mood: string | null
    content: string
    createdAt: Date
    likeCount: number
    commentCount: number
    DailyMessageComment: Array<{
      id: string
      content: string
      createdAt: Date
      User: {
        id: string
        nickname: string
        avatarUrl: string | null
        Profile: { displayName: string | null; avatarUrl: string | null } | null
      }
    }>
  }> = []

  try {
    rows = await prisma.dailyMessage.findMany({
      where: { userId, isDeleted: false },
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
    })
  } catch (error) {
    console.error('[profile-page.recentMessages]', error)
    return []
  }

  const remarkTargetIds = rows.flatMap((row) => row.DailyMessageComment.map((comment) => comment.User.id))
  let remarkMap: ReadonlyMap<string, string> = new Map()
  try {
    remarkMap = await loadFriendRemarkMap(viewerId, remarkTargetIds)
  } catch (error) {
    console.error('[profile-page.recentMessages.remarks]', error)
  }

  return rows.map((message) => ({
    id: message.id,
    mood: message.mood,
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    likeCount: message.likeCount,
    commentCount: message.commentCount,
    comments: message.DailyMessageComment.map((comment) => ({
      id: comment.id,
      content: comment.content,
      createdAt: comment.createdAt.toISOString(),
      authorName: resolveFriendDisplayName({
        viewerId,
        targetUserId: comment.User.id,
        fallbackName: getPublicUserDisplayName(comment.User),
        remarkMap,
      }),
      authorAvatarUrl: profileImageUrl(comment.User.Profile?.avatarUrl || comment.User.avatarUrl),
    })),
  }))
}
