import type { AdminPermissionKey } from '@/lib/admin-permission-config'

export const reviewSourceTypes = ['POST', 'SALON', 'CREATION', 'STICKER', 'CONCERT', 'TODAY'] as const
export type ReviewSourceType = typeof reviewSourceTypes[number]
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED'
export type ReviewDecision = 'APPROVE' | 'REJECT'

export type ReviewSourceDefinition = {
  type: ReviewSourceType
  queryValues: readonly string[]
  label: string
  permission: AdminPermissionKey
}

export const reviewSourceDefinitions: readonly ReviewSourceDefinition[] = [
  { type: 'POST', queryValues: ['post', 'posts'], label: '帖子', permission: 'post_manage' },
  { type: 'SALON', queryValues: ['salon'], label: '沙龙', permission: 'post_manage' },
  { type: 'CREATION', queryValues: ['creation', 'studio'], label: '创作平台', permission: 'studio_manage' },
  { type: 'STICKER', queryValues: ['sticker', 'stickers'], label: '表情包', permission: 'sticker_manage' },
  { type: 'CONCERT', queryValues: ['concert', 'contribution', 'contributions'], label: '演唱会投稿', permission: 'music_manage' },
  { type: 'TODAY', queryValues: ['today'], label: '今日内容', permission: 'today_manage' },
] as const

export function parseReviewSourceType(value: unknown): ReviewSourceType | 'ALL' {
  if (typeof value !== 'string' || !value.trim()) return 'ALL'
  const normalized = value.trim().toLowerCase()
  return reviewSourceDefinitions.find((item) => item.queryValues.includes(normalized))?.type || 'ALL'
}

export function reviewSourceLabel(type: ReviewSourceType | 'ALL') {
  if (type === 'ALL') return '全部'
  return reviewSourceDefinitions.find((item) => item.type === type)?.label || type
}

/** Shared decision availability for the unified queue and server adapters. */
export function canApplyReviewDecision(status: unknown, decision: ReviewDecision) {
  if (status === 'PENDING') return decision === 'APPROVE' || decision === 'REJECT'
  return status === 'APPROVED' && decision === 'REJECT'
}

export type ReviewItemActions = {
  approve: boolean
  reject: boolean
  edit: boolean
  delete: boolean
  detailUrl: string | null
}

export type ReviewMedia = {
  id: string
  src: string
  previewSrc?: string
  alt: string
}

export type ReviewBoardOption = {
  id: string
  name: string
  slug: string
}

export type ReviewPostDetails = {
  boardId: string
  boardName: string
  boards: ReviewBoardOption[]
}

export type ReviewItem = {
  id: string
  sourceType: ReviewSourceType
  sourceId: string
  title: string
  author: { id: string | null; uid: number | null; name: string }
  authorId: string | null
  createdAt: string
  status: ReviewStatus
  cover: string | null
  summary: string
  category: string | null
  relatedEntity: string | null
  reviewer: { id?: string | null; uid?: number | null; name: string } | null
  reviewedAt: string | null
  rejectReason: string | null
  media?: ReviewMedia[]
  postDetails?: ReviewPostDetails
  actions: ReviewItemActions
}
