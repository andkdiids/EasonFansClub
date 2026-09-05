import type { LikeAvatarUser } from '@/components/LikeAvatars'
import type { CheckInMessageItem } from '@/lib/checkin-messages'

export type AnonymousCheckInMessageItem = {
  id: string
  date: string
  mood: string | null
  moodType: string | null
  moodEmoji: string | null
  moodText: string | null
  content: string
  isPinned: boolean
  isFeatured: boolean
  likeCount: number
  favoriteCount: number
  commentCount: number
  createdAt: string
  ipRegion: string | null
  liked: boolean
  favorited: boolean
  canDelete: boolean
  /** 最新点赞用户（最多 10 个，朋友圈式头像展示）。 */
  likers: LikeAvatarUser[]
  author: { type: 'anonymous'; name: '匿名E友' }
  comments: Array<{
    id: string
    parentId: string | null
    content: string
    createdAt: string
    ipRegion: string | null
    canDelete: boolean
    author: { type: 'anonymous'; name: '匿名E友' }
  }>
}

export function anonymizeCheckInMessages(messages: CheckInMessageItem[]): AnonymousCheckInMessageItem[] {
  return messages.map((item) => ({
    id: item.id,
    date: item.date,
    mood: item.mood,
    moodType: item.moodType,
    moodEmoji: item.moodEmoji,
    moodText: item.moodText,
    content: item.content,
    isPinned: item.isPinned,
    isFeatured: item.isFeatured,
    likeCount: item.likeCount,
    favoriteCount: item.favoriteCount,
    commentCount: item.commentCount,
    createdAt: item.createdAt,
    ipRegion: item.ipRegion,
    liked: item.likes.length > 0,
    favorited: item.favorites.length > 0,
    canDelete: item.canDelete,
    // 匿名墙不返回点赞者身份，保护点赞者隐私（点赞数量仍通过 likeCount 公开）。
    likers: [],
    author: { type: 'anonymous', name: '匿名E友' },
    comments: item.comments.map((comment) => ({
      id: comment.id,
      parentId: comment.parentId,
      content: comment.content,
      createdAt: comment.createdAt,
      ipRegion: comment.ipRegion,
      canDelete: comment.canDelete,
      author: { type: 'anonymous', name: '匿名E友' },
    })),
  }))
}
