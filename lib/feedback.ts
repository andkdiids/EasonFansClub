import type { FeedbackStatus, FeedbackType, Prisma } from '@prisma/client'
import { publicImageUrl, storedImageUrl } from '@/lib/images'
import { getPublicUserDisplayName } from '@/lib/friend-display'
import { publicModerationText } from '@/lib/content-moderation'

export const FEEDBACK_DESCRIPTION_MIN_LENGTH = 10
export const FEEDBACK_MAX_ATTACHMENTS = 5
export const FEEDBACK_MAX_FILE_SIZE = 10 * 1024 * 1024
export const FEEDBACK_ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const

export const feedbackTypeLabels: Record<FeedbackType, string> = {
  BUG: '问题反馈',
  EXPERIENCE: '体验建议',
  SUGGESTION: '功能建议',
  CONTENT: '内容问题',
  ACCOUNT: '账号问题',
  OTHER: '其他',
}

export const feedbackStatusLabels: Record<FeedbackStatus, string> = {
  OPEN: '未处理',
  PROCESSING: '处理中',
  REPLIED: '已回复',
  RESOLVED: '已完成',
  CLOSED: '已完成',
}

export const feedbackTypes = Object.keys(feedbackTypeLabels) as FeedbackType[]
export const feedbackStatuses = Object.keys(feedbackStatusLabels) as FeedbackStatus[]
export const feedbackVisibleStatuses = ['OPEN', 'PROCESSING', 'REPLIED', 'RESOLVED'] as const satisfies readonly FeedbackStatus[]

export const feedbackInclude = {
  User: {
    select: {
      id: true,
      uid: true,
      nickname: true,
      usernameModerationStatus: true,
      nicknameModerationStatus: true,
      nicknameViolationDisplay: true,
      avatarUrl: true,
      Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
    },
  },
  FeedbackAttachment: {
    where: { replyId: null },
    orderBy: { createdAt: 'asc' },
  },
  FeedbackReply: {
    orderBy: { createdAt: 'asc' },
    include: {
      User: {
        select: {
          id: true,
          uid: true,
          nickname: true,
          usernameModerationStatus: true,
          nicknameModerationStatus: true,
          nicknameViolationDisplay: true,
          avatarUrl: true,
          role: true,
          Profile: { select: { displayName: true, displayNameModerationStatus: true, avatarUrl: true } },
        },
      },
      FeedbackAttachment: { orderBy: { createdAt: 'asc' } },
    },
  },
} satisfies Prisma.FeedbackInclude

export const feedbackListSelect = {
  id: true,
  title: true,
  type: true,
  status: true,
  adminUnread: true,
  userUnread: true,
  lastReplyAt: true,
  createdAt: true,
  updatedAt: true,
  moderationStatus: true,
  User: {
    select: {
      id: true,
      uid: true,
      nickname: true,
      usernameModerationStatus: true,
      nicknameModerationStatus: true,
      nicknameViolationDisplay: true,
      Profile: { select: { displayName: true, displayNameModerationStatus: true } },
    },
  },
  _count: { select: { FeedbackReply: true, FeedbackAttachment: true } },
} satisfies Prisma.FeedbackSelect

type FeedbackWithThread = Prisma.FeedbackGetPayload<{ include: typeof feedbackInclude }>
type FeedbackListItem = Prisma.FeedbackGetPayload<{ select: typeof feedbackListSelect }>

function displayUser(user: {
  id: string
  uid: number
  nickname: string
  avatarUrl?: string | null
  role?: string
  usernameModerationStatus?: string | null
  nicknameModerationStatus?: string | null
  Profile?: { displayName: string | null; displayNameModerationStatus?: string | null; avatarUrl?: string | null } | null
  forAdmin?: boolean
}) {
  return {
    id: user.id,
    uid: user.uid,
    nickname: user.forAdmin ? (user.nickname || 'E院用户') : getPublicUserDisplayName(user),
    avatarUrl: publicImageUrl(user.Profile?.avatarUrl || user.avatarUrl || null),
    role: user.role,
  }
}

function serializeAttachment(item: { id: string; url: string; mimeType: string | null; createdAt: Date }) {
  return {
    id: item.id,
    url: publicImageUrl(item.url),
    mimeType: item.mimeType,
    createdAt: item.createdAt,
  }
}

export function serializeFeedbackListItem(item: FeedbackListItem, options: { forAdmin?: boolean } = {}) {
  const forAdmin = options.forAdmin === true
  return {
    id: item.id,
    title: forAdmin ? item.title : publicModerationText(item.title, item.moderationStatus),
    type: item.type,
    typeLabel: feedbackTypeLabels[item.type],
    status: item.status,
    statusLabel: feedbackStatusLabels[item.status],
    adminUnread: item.adminUnread,
    userUnread: item.userUnread,
    lastReplyAt: item.lastReplyAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    replyCount: item._count.FeedbackReply,
    attachmentCount: item._count.FeedbackAttachment,
    user: displayUser({ ...item.User, forAdmin }),
  }
}

export function serializeFeedback(item: FeedbackWithThread, options: { includeContact: boolean; forAdmin?: boolean }) {
  const forAdmin = options.forAdmin === true
  const user = displayUser({ ...item.User, forAdmin })
  const serializedReplies = item.FeedbackReply.map((reply) => ({
    id: reply.id,
    content: forAdmin ? reply.content : publicModerationText(reply.content, reply.moderationStatus),
    authorRole: reply.authorRole,
    isReadByUser: reply.isReadByUser,
    isReadByAdmin: reply.isReadByAdmin,
    createdAt: reply.createdAt,
    author: displayUser({ ...reply.User, forAdmin }),
    attachments: reply.FeedbackAttachment.map(serializeAttachment).filter((attachment) => attachment.url),
  }))
  const hasStoredInitialMessage = item.FeedbackReply.some((reply) => (
    reply.authorRole === 'USER' &&
    reply.content === item.content &&
    Math.abs(new Date(reply.createdAt).getTime() - item.createdAt.getTime()) < 10_000
  ))
  const initialMessage = {
    id: `initial-${item.id}`,
    content: forAdmin ? item.content : publicModerationText(item.content, item.moderationStatus),
    authorRole: 'USER',
    isReadByUser: true,
    isReadByAdmin: !item.adminUnread,
    createdAt: item.createdAt,
    author: user,
    attachments: item.FeedbackAttachment.map(serializeAttachment).filter((attachment) => attachment.url),
  }

  return {
    id: item.id,
    title: forAdmin ? item.title : publicModerationText(item.title, item.moderationStatus),
    type: item.type,
    typeLabel: feedbackTypeLabels[item.type],
    content: forAdmin ? item.content : publicModerationText(item.content, item.moderationStatus),
    contact: options.includeContact ? item.contact : null,
    status: item.status,
    statusLabel: feedbackStatusLabels[item.status],
    adminUnread: item.adminUnread,
    userUnread: item.userUnread,
    lastReplyAt: item.lastReplyAt,
    lastUserReplyAt: item.lastUserReplyAt,
    lastAdminReplyAt: item.lastAdminReplyAt,
    closedAt: item.closedAt,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    user,
    attachments: item.FeedbackAttachment.map(serializeAttachment).filter((attachment) => attachment.url),
    replies: hasStoredInitialMessage ? serializedReplies : [initialMessage, ...serializedReplies],
  }
}

export function parseFeedbackType(value: unknown): FeedbackType | null {
  const type = String(value || '').toUpperCase()
  if (type === 'FEATURE') return 'SUGGESTION'
  return feedbackTypes.includes(type as FeedbackType) ? (type as FeedbackType) : null
}

export function parseFeedbackStatus(value: unknown): FeedbackStatus | null {
  const status = String(value || '').toUpperCase()
  if (status === 'PENDING') return 'OPEN'
  if (status === 'COMPLETED') return 'RESOLVED'
  return feedbackStatuses.includes(status as FeedbackStatus) ? (status as FeedbackStatus) : null
}

export function parseFeedbackStatusFilter(value: unknown): FeedbackStatus[] | null {
  const status = String(value || '').toUpperCase()
  if (!status) return null
  if (status === 'PENDING' || status === 'OPEN') return ['OPEN']
  if (status === 'COMPLETED' || status === 'RESOLVED' || status === 'CLOSED') return ['RESOLVED', 'CLOSED']
  const parsed = parseFeedbackStatus(status)
  return parsed ? [parsed] : null
}

export function parseFeedbackAttachments(value: unknown) {
  if (!Array.isArray(value)) return []

  return value
    .slice(0, 5)
    .map((item) => ({
      url: storedImageUrl(typeof item?.url === 'string' ? item.url : '') || '',
      mimeType: typeof item?.mimeType === 'string' ? item.mimeType.slice(0, 80) : null,
    }))
    .filter((item) => item.url)
}
