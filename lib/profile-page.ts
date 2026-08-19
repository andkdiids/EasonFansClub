import { profileImageUrl } from '@/lib/images'
import { getPublicUserDisplayName, loadFriendRemarkMap, resolveFriendDisplayName } from '@/lib/friend-remarks'
import { prisma } from '@/lib/prisma'
import { publicModerationText } from '@/lib/content-moderation'

export type ProfileWallVisibility = 'PUBLIC' | 'FRIENDS' | 'CLOSED'

export const PROFILE_RECORD_PAGE_SIZE = 10

export type ProfileRecordPagination = {
  page: number
  pageSize: number
  total: number
  totalPages: number
  hasMore: boolean
}

export type ProfileRecentMessage = {
  id: string
  mood: string | null
  moodType: string | null
  moodEmoji: string | null
  moodText: string | null
  content: string
  moderationStatus: string
  createdAt: string
  ipRegion: string | null
  likeCount: number
  commentCount: number
  comments: Array<{
    id: string
    parentId: string | null
    content: string
    moderationStatus: string
    createdAt: string
    ipRegion: string | null
    authorName: string
    authorAvatarUrl: string | null
  }>
}

type ProfileRecentMessageRow = {
  id: string
  mood: string | null
  moodType: string | null
  moodEmoji: string | null
  moodText: string | null
  content: string
  moderationStatus: string
  createdAt: Date
  ipRegion: string | null
  likeCount: number
  commentCount: number
  DailyMessageComment: Array<{
    id: string
    parentId: string | null
    content: string
    moderationStatus: string
    createdAt: Date
    ipRegion: string | null
    User: {
      id: string
      nickname: string
      usernameModerationStatus: string
      nicknameModerationStatus: string
      avatarUrl: string | null
      Profile: { displayName: string | null; displayNameModerationStatus: string; avatarUrl: string | null } | null
    }
  }>
}

export function getProfileRecordPagination(total: number, requestedPage: number, pageSize = PROFILE_RECORD_PAGE_SIZE): ProfileRecordPagination {
  const safePageSize = Math.min(50, Math.max(1, Math.trunc(pageSize) || PROFILE_RECORD_PAGE_SIZE))
  const safeTotal = Math.max(0, Math.trunc(total) || 0)
  const totalPages = Math.max(1, Math.ceil(safeTotal / safePageSize))
  const page = Math.min(Math.max(1, Math.trunc(requestedPage) || 1), totalPages)
  return { page, pageSize: safePageSize, total: safeTotal, totalPages, hasMore: page < totalPages }
}

async function mapProfileRecentMessages(rows: ProfileRecentMessageRow[], viewerId?: string | null): Promise<ProfileRecentMessage[]> {
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
    moodType: message.moodType,
    moodEmoji: message.moodEmoji,
    moodText: message.moodText,
    content: publicModerationText(message.content, message.moderationStatus),
    moderationStatus: message.moderationStatus,
    createdAt: message.createdAt.toISOString(),
    ipRegion: message.ipRegion,
    likeCount: message.likeCount,
    commentCount: message.commentCount,
    comments: message.DailyMessageComment.map((comment) => ({
      id: comment.id,
      parentId: comment.parentId,
      content: publicModerationText(comment.content, comment.moderationStatus),
      moderationStatus: comment.moderationStatus,
      createdAt: comment.createdAt.toISOString(),
      ipRegion: comment.ipRegion,
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

export async function loadProfileRecentMessagesPage(
  userId: string,
  viewerId?: string | null,
  requestedPage = 1,
  pageSize = PROFILE_RECORD_PAGE_SIZE,
): Promise<{ messages: ProfileRecentMessage[]; pagination: ProfileRecordPagination }> {
  try {
    const total = await prisma.dailyMessage.count({ where: { userId, isDeleted: false } })
    const pagination = getProfileRecordPagination(total, requestedPage, pageSize)
    const rows = await prisma.dailyMessage.findMany({
      where: { userId, isDeleted: false },
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
    })

    return { messages: await mapProfileRecentMessages(rows), pagination }
  } catch (error) {
    console.error('[profile-page.recentMessages.page]', error)
    return { messages: [], pagination: getProfileRecordPagination(0, requestedPage, pageSize) }
  }
}

export async function loadProfileRecentMessages(userId: string, viewerId?: string | null): Promise<ProfileRecentMessage[]> {
  try {
    const result = await loadProfileRecentMessagesPage(userId, viewerId)
    return result.messages
  } catch (error) {
    console.error('[profile-page.recentMessages]', error)
    return []
  }
}
