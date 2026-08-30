import type { Prisma } from '@prisma/client'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { formatDate } from '@/lib/format'
import { profileImageUrl } from '@/lib/images'
import { publicModerationText } from '@/lib/content-moderation'
import { publicContentImageMarkers } from '@/lib/content-images'
import { prisma } from '@/lib/prisma'
import { buildPublicMediaUrl } from '@/lib/media-url'
import { validateRichPostContent } from '@/lib/rich-text'
import { formatBeijingDateTimeDisplay } from '@/lib/registration-availability'
import { publicPostWhere } from '@/lib/post-moderation'
import { firstAbsoluteMetadataImageUrl, createActivityShareDescription, createPostShareDescription, createPostShareTitle, metadataImageVariantUrl, postContentPlainText } from '@/lib/share-metadata'
import { canonicalShareUrl, SHARE_CARD_CANONICAL_ORIGIN, SHARE_CARD_HEIGHT, SHARE_CARD_MIME_TYPE, SHARE_CARD_WIDTH, type ShareCardData } from '@/lib/share-card'
import { createShareCardContentHash } from '@/lib/share-card-hash'
import { renderShareCardPng, isTrustedShareCardImageUrl } from '@/lib/share-card-renderer'
import { headCosObject } from '@/lib/tencent-cos'
import { uploadSiteImage } from '@/lib/site-media-storage'

const shareCardIdPattern = /^[a-zA-Z0-9_-]{1,191}$/

const postShareCardSelect = {
  id: true,
  title: true,
  content: true,
  richContent: true,
  moderationStatus: true,
  createdAt: true,
  PostMedia: {
    where: { type: 'IMAGE' as const },
    orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }, { id: 'asc' as const }],
    take: 12,
    select: { url: true },
  },
  User: {
    select: {
      nickname: true,
      nicknameModerationStatus: true,
      nicknameViolationDisplay: true,
      status: true,
      isDeleted: true,
      avatarUrl: true,
      Profile: { select: { avatarUrl: true } },
    },
  },
  Board: { select: { name: true } },
} satisfies Prisma.PostSelect

const activityShareCardSelect = {
  id: true,
  title: true,
  description: true,
  startsAt: true,
  endsAt: true,
  locationName: true,
  locationAddress: true,
  bannerUrl: true,
  coverUrl: true,
  organizer: true,
  publishedAt: true,
  createdAt: true,
  status: true,
  CreatedBy: {
    select: {
      nickname: true,
      nicknameModerationStatus: true,
      nicknameViolationDisplay: true,
      status: true,
      isDeleted: true,
      avatarUrl: true,
      Profile: { select: { avatarUrl: true } },
    },
  },
} satisfies Prisma.ActivitySelect

type ShareCardResult = Readonly<{
  url: string
  cached: boolean
  hash: string
  width: typeof SHARE_CARD_WIDTH
  height: typeof SHARE_CARD_HEIGHT
  mimeType: typeof SHARE_CARD_MIME_TYPE
}>

export type ShareCardContentType = 'post' | 'activity'

export class ShareCardContentNotFoundError extends Error {
  constructor(type: ShareCardContentType, contentId: string) {
    super(`公开分享内容不存在：${type}/${contentId}`)
    this.name = 'ShareCardContentNotFoundError'
  }
}

export function isValidShareCardContentId(value: string) {
  return shareCardIdPattern.test(value)
}

function safeAuthorAvatar(value: string | null | undefined) {
  const candidate = publicImageVariantUrl(profileImageUrl(value), 'avatar-md')
  if (!candidate || !isTrustedShareCardImageUrl(candidate)) return null
  return new URL(candidate, SHARE_CARD_CANONICAL_ORIGIN).toString()
}

function activityShareDate(value: Date | null) {
  return value ? formatBeijingDateTimeDisplay(value) : ''
}

export async function loadPostShareCardData(postId: string): Promise<ShareCardData | null> {
  const post = await prisma.post.findFirst({
    where: {
      id: postId,
      ...publicPostWhere,
      User: { status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
    },
    select: postShareCardSelect,
  })
  if (!post) return null

  const publicContent = publicModerationText(publicContentImageMarkers(post.content), post.moderationStatus)
  const richResult = post.moderationStatus === 'VIOLATION' ? null : validateRichPostContent(post.richContent)
  const publicRichContent = richResult?.valid ? richResult.value : null
  const plainContent = postContentPlainText(publicContent, publicRichContent)
  const title = publicModerationText(post.title, post.moderationStatus)
  const safeContent = publicModerationText(plainContent, post.moderationStatus)
  return {
    type: 'post',
    contentId: post.id,
    title: createPostShareTitle(title, safeContent, publicRichContent),
    description: createPostShareDescription(safeContent, publicRichContent),
    image: firstAbsoluteMetadataImageUrl(post.PostMedia.map(({ url }) => metadataImageVariantUrl(url))),
    url: canonicalShareUrl(`/posts/${post.id}`),
    author: getPublicUserDisplayName(post.User),
    authorAvatar: safeAuthorAvatar(post.User.Profile?.avatarUrl || post.User.avatarUrl),
    date: formatDate(post.createdAt),
    meta: post.Board ? [{ label: '版块', value: post.Board.name }] : [],
  }
}

export async function loadActivityShareCardData(activityId: string): Promise<ShareCardData | null> {
  const activity = await prisma.activity.findFirst({
    where: { id: activityId, status: { in: ['PUBLISHED', 'CANCELLED'] } },
    select: activityShareCardSelect,
  })
  if (!activity) return null

  const creator = activity.CreatedBy && activity.CreatedBy.status === 'ACTIVE' && !activity.CreatedBy.isDeleted ? activity.CreatedBy : null
  const shareTime = activity.startsAt
    ? `${activityShareDate(activity.startsAt)}${activity.endsAt ? ` — ${activityShareDate(activity.endsAt)}` : ''}`
    : ''
  const shareLocation = [activity.locationName, activity.locationAddress].filter(Boolean).join('，')
  return {
    type: 'activity',
    contentId: activity.id,
    title: activity.title,
    description: createActivityShareDescription(activity),
    image: firstAbsoluteMetadataImageUrl([
      metadataImageVariantUrl(activity.bannerUrl),
      metadataImageVariantUrl(activity.coverUrl),
    ]),
    url: canonicalShareUrl(`/activities/${activity.id}`),
    author: creator ? getPublicUserDisplayName(creator) : activity.organizer || '私家E院',
    authorAvatar: creator ? safeAuthorAvatar(creator.Profile?.avatarUrl || creator.avatarUrl) : null,
    date: activity.publishedAt ? activityShareDate(activity.publishedAt) : activityShareDate(activity.createdAt),
    meta: [
      ...(shareTime ? [{ label: '活动时间', value: shareTime }] : []),
      ...(shareLocation ? [{ label: '活动地点', value: shareLocation }] : []),
    ],
  }
}

export async function loadPublicShareCardData(type: ShareCardContentType, contentId: string) {
  if (type === 'post') return loadPostShareCardData(contentId)
  return loadActivityShareCardData(contentId)
}

export function shareCardObjectKey(type: ShareCardContentType, contentId: string, hash: string) {
  if (!isValidShareCardContentId(contentId)) throw new Error('SHARE_CARD_CONTENT_ID_INVALID')
  if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error('SHARE_CARD_HASH_INVALID')
  return `share-cards/${type === 'post' ? 'posts' : 'activities'}/${contentId}/${hash}.png`
}

export function shareCardPublicUrl(objectKey: string) {
  const url = buildPublicMediaUrl(objectKey)
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new Error('SHARE_CARD_PUBLIC_URL_MUST_BE_HTTPS')
  return parsed.toString()
}

export type ShareCardCacheDependencies = Readonly<{
  headObject: (objectKey: string) => Promise<boolean>
  render: (data: ShareCardData) => Promise<Buffer>
  upload: (input: { objectKey: string; body: Buffer; contentType: typeof SHARE_CARD_MIME_TYPE }) => Promise<string>
}>

/** Deterministic COS cache with one in-process renderer per content version. */
export function createShareCardCache(dependencies: ShareCardCacheDependencies) {
  const pending = new Map<string, Promise<ShareCardResult>>()

  return {
    async getOrCreate(data: ShareCardData): Promise<ShareCardResult> {
      if (!data.contentId || (data.type !== 'post' && data.type !== 'activity')) throw new Error('SHARE_CARD_CONTENT_ID_REQUIRED')
      const hash = createShareCardContentHash(data)
      const objectKey = shareCardObjectKey(data.type, data.contentId, hash)
      const url = shareCardPublicUrl(objectKey)
      const existing = pending.get(objectKey)
      if (existing) return existing

      const work = (async () => {
        if (await dependencies.headObject(objectKey)) {
          return { url, cached: true, hash, width: SHARE_CARD_WIDTH, height: SHARE_CARD_HEIGHT, mimeType: SHARE_CARD_MIME_TYPE } satisfies ShareCardResult
        }
        const body = await dependencies.render(data)
        await dependencies.upload({ objectKey, body, contentType: SHARE_CARD_MIME_TYPE })
        return { url, cached: false, hash, width: SHARE_CARD_WIDTH, height: SHARE_CARD_HEIGHT, mimeType: SHARE_CARD_MIME_TYPE } satisfies ShareCardResult
      })()
      pending.set(objectKey, work)
      try {
        return await work
      } finally {
        if (pending.get(objectKey) === work) pending.delete(objectKey)
      }
    },
    pendingCount() {
      return pending.size
    },
  }
}

const defaultShareCardCache = createShareCardCache({
  headObject: (objectKey) => headCosObject(objectKey),
  render: (data) => renderShareCardPng(data),
  upload: ({ objectKey, body, contentType }) => uploadSiteImage({ key: objectKey, body, contentType }),
})

export async function getOrCreatePublicShareCard(type: ShareCardContentType, contentId: string) {
  const data = await loadPublicShareCardData(type, contentId)
  if (!data) throw new ShareCardContentNotFoundError(type, contentId)
  return defaultShareCardCache.getOrCreate(data)
}

export const shareCardCacheForTests = defaultShareCardCache
