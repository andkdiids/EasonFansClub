import type { FeedbackStatus, FeedbackType, Prisma } from '@prisma/client'
import { publicImageUrl } from '@/lib/images'

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
      avatarUrl: true,
      Profile: { select: { displayName: true, avatarUrl: true } },
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
          avatarUrl: true,
          role: true,
          Profile: { select: { displayName: true, avatarUrl: true } },
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
  User: {
    select: {
      id: true,
      uid: true,
      nickname: true,
      Profile: { select: { displayName: true } },
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
  Profile?: { displayName: string | null; avatarUrl?: string | null } | null
}) {
  return {
    id: user.id,
    uid: user.uid,
    nickname: user.Profile?.displayName || user.nickname,
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

export function serializeFeedbackListItem(item: FeedbackListItem) {
  return {
    id: item.id,
    title: item.title,
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
    user: displayUser(item.User),
  }
}

export function serializeFeedback(item: FeedbackWithThread, options: { includeContact: boolean }) {
  const user = displayUser(item.User)
  const serializedReplies = item.FeedbackReply.map((reply) => ({
    id: reply.id,
    content: reply.content,
    authorRole: reply.authorRole,
    isReadByUser: reply.isReadByUser,
    isReadByAdmin: reply.isReadByAdmin,
    createdAt: reply.createdAt,
    author: displayUser(reply.User),
    attachments: reply.FeedbackAttachment.map(serializeAttachment).filter((attachment) => attachment.url),
  }))
  const hasStoredInitialMessage = serializedReplies.some((reply) => (
    reply.authorRole === 'USER' &&
    reply.content === item.content &&
    Math.abs(new Date(reply.createdAt).getTime() - item.createdAt.getTime()) < 10_000
  ))
  const initialMessage = {
    id: `initial-${item.id}`,
    content: item.content,
    authorRole: 'USER',
    isReadByUser: true,
    isReadByAdmin: !item.adminUnread,
    createdAt: item.createdAt,
    author: user,
    attachments: item.FeedbackAttachment.map(serializeAttachment).filter((attachment) => attachment.url),
  }

  return {
    id: item.id,
    title: item.title,
    type: item.type,
    typeLabel: feedbackTypeLabels[item.type],
    content: item.content,
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
      url: publicImageUrl(typeof item?.url === 'string' ? item.url : '') || '',
      mimeType: typeof item?.mimeType === 'string' ? item.mimeType.slice(0, 80) : null,
    }))
    .filter((item) => item.url)
}
