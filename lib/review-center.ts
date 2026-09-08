import type { AdminPermissionKey } from '@/lib/admin-permission-config'
import { salonCategoryLabel } from '@/lib/salon-shared'

export const reviewSourceTypes = ['POST', 'SALON', 'CREATION', 'STICKER', 'CONCERT', 'TODAY'] as const
export type ReviewSourceType = typeof reviewSourceTypes[number]
export type ReviewStatus = 'PENDING' | 'APPROVED' | 'REJECTED'
export type ReviewDecision = 'APPROVE' | 'REJECT'
export const reviewStatuses = ['PENDING', 'APPROVED', 'REJECTED'] as const

/** Normalize review-center URL input; legacy `status=all` means the default queue. */
export function parseReviewStatus(value: unknown): ReviewStatus {
  const normalized = typeof value === 'string' ? value.trim().toUpperCase() : ''
  return reviewStatuses.includes(normalized as ReviewStatus) ? normalized as ReviewStatus : 'PENDING'
}

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

/**
 * Build the one canonical destination for an administrator review notice.
 *
 * The target id is optional because some historical notices only retained the
 * queue URL. New notices should always provide it when the source has one so
 * the review center can open the exact row instead of making an administrator
 * search for it again.
 */
export function buildReviewCenterUrl(type: ReviewSourceType, targetId?: string | null) {
  const definition = reviewSourceDefinitions.find((item) => item.type === type)
  const queryType = definition?.queryValues[0] || type.toLowerCase()
  const query = [`type=${encodeURIComponent(queryType)}`]
  const normalizedTargetId = targetId?.trim()
  if (normalizedTargetId) query.push(`targetId=${encodeURIComponent(normalizedTargetId)}`)
  return `/admin/review?${query.join('&')}`
}

export function parseReviewSourceType(value: unknown): ReviewSourceType | 'ALL' {
  if (typeof value !== 'string' || !value.trim()) return 'ALL'
  const normalized = value.trim().toLowerCase()
  return reviewSourceDefinitions.find((item) => item.queryValues.includes(normalized))?.type || 'ALL'
}

export function reviewSourceLabel(type: ReviewSourceType | 'ALL') {
  if (type === 'ALL') return '全部'
  return reviewSourceDefinitions.find((item) => item.type === type)?.label || type
}

const legacySalonCategoryLabels: Record<string, string> = {
  CONCERT: '演唱会记录',
  MOBILE_WALLPAPER: '手机壁纸',
  DESKTOP_WALLPAPER: '电脑壁纸',
  TIME_TRAVEL: '时光倒流二十年',
  '演唱会记录': '演唱会记录',
  '手机壁纸': '手机壁纸',
  '电脑壁纸': '电脑壁纸',
  '时光倒流二十年': '时光倒流二十年',
}

/** Resolve Salon's persisted category without exposing enum/code values. */
export function reviewSalonCategoryLabel(value: unknown) {
  const raw = typeof value === 'string' ? value.trim() : ''
  if (!raw) return '未分类'
  const configuredLabel = salonCategoryLabel(raw)
  if (configuredLabel !== raw) return configuredLabel
  return legacySalonCategoryLabels[raw] || '未分类'
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
  editUrl: string | null
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
