import type { Prisma } from '@prisma/client'
import { getForumBoardDisplayName } from '@/lib/boards'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { formatDate } from '@/lib/format'
import { profileImageUrl } from '@/lib/images'
import { publicModerationText } from '@/lib/content-moderation'
import { publicContentImageMarkers } from '@/lib/content-images'
import { prisma } from '@/lib/prisma'
import { buildPublicMediaUrl } from '@/lib/media-url'
import { buildSalonFeedWhere, formatSalonSession, SALON_CATEGORY_LABELS } from '@/lib/salon'
import { validateRichPostContent } from '@/lib/rich-text'
import { formatBeijingDateTimeDisplay } from '@/lib/registration-availability'
import { publicPostWhere } from '@/lib/post-moderation'
import { firstShareCardImageCandidate, shareCardImageCandidates, createActivityShareCardDescription, createPostShareDescription, createPostShareTitle, postContentPlainText } from '@/lib/share-metadata'
import { canonicalShareUrl, SHARE_CARD_CANONICAL_ORIGIN, SHARE_CARD_MIME_TYPE, SHARE_CARD_WIDTH, type ShareCardData } from '@/lib/share-card'
import { calculateShareCardLayout } from '@/lib/share-card-layout'
import { createShareCardContentHash } from '@/lib/share-card-hash'
import { renderShareCardPngWithInfo, isTrustedShareCardImageUrl, type ShareCardRenderResult } from '@/lib/share-card-renderer'
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
    select: { url: true, width: true, height: true },
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
  Board: { select: { name: true, slug: true } },
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

const salonShareCardSelect = {
  id: true,
  category: true,
  title: true,
  content: true,
  createdAt: true,
  concert: {
    select: {
      id: true,
      title: true,
      concertDate: true,
      city: true,
      stageType: true,
      venue: true,
      sessionNumber: true,
      MusicTour: { select: { id: true, name: true, status: true } },
    },
  },
  author: {
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
  media: {
    orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }, { id: 'asc' as const }],
    select: { previewUrl: true, width: true, height: true },
  },
} satisfies Prisma.SalonPostSelect

type ShareCardResult = Readonly<{
  url: string
  cached: boolean
  hash: string
  width: typeof SHARE_CARD_WIDTH
  height: number
  mimeType: typeof SHARE_CARD_MIME_TYPE
}>

export type ShareCardContentType = 'post' | 'activity' | 'salon'

function isShareCardContentType(type: ShareCardData['type']): type is ShareCardContentType {
  return type === 'post' || type === 'activity' || type === 'salon'
}

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
  const plainContent = postContentPlainText(publicContent, publicRichContent, { preserveLineBreaks: true })
  const title = publicModerationText(post.title, post.moderationStatus)
  const safeContent = publicModerationText(plainContent, post.moderationStatus)
  const image = firstShareCardImageCandidate(post.PostMedia.map(({ url, width, height }) => ({ url, width, height })))
  const imageCandidates = shareCardImageCandidates(post.PostMedia.map(({ url, width, height }) => ({ url, width, height })))
  return {
    type: 'post',
    contentId: post.id,
    title: createPostShareTitle(title, safeContent, publicRichContent),
    description: safeContent || createPostShareDescription(safeContent, publicRichContent),
    image: image?.url || null,
    imageWidth: image?.width,
    imageHeight: image?.height,
    imageCandidates,
    url: canonicalShareUrl(`/posts/${post.id}`),
    author: getPublicUserDisplayName(post.User),
    authorAvatar: safeAuthorAvatar(post.User.Profile?.avatarUrl || post.User.avatarUrl),
    date: formatDate(post.createdAt),
    meta: post.Board ? [{ label: '版块', value: getForumBoardDisplayName(post.Board) }] : [],
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
  const image = firstShareCardImageCandidate([{ url: activity.bannerUrl }, { url: activity.coverUrl }])
  const imageCandidates = shareCardImageCandidates([{ url: activity.bannerUrl }, { url: activity.coverUrl }])
  return {
    type: 'activity',
    contentId: activity.id,
    title: activity.title,
    description: createActivityShareCardDescription(activity),
    image: image?.url || null,
    imageCandidates,
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

export async function loadSalonShareCardData(postId: string): Promise<ShareCardData | null> {
  const post = await prisma.salonPost.findFirst({
    where: {
      id: postId,
      ...buildSalonFeedWhere(),
      author: { status: 'ACTIVE', isDeleted: false },
    },
    select: salonShareCardSelect,
  })
  if (!post) return null

  const sessionDescription = post.concert ? formatSalonSession({
    city: post.concert.city,
    concertDate: post.concert.concertDate.toISOString(),
    venue: post.concert.venue,
    title: post.concert.title,
    sessionNumber: post.concert.sessionNumber,
  }) : ''
  const title = post.title?.trim() || (post.concert ? `${post.concert.MusicTour.name} · ${post.concert.city}` : SALON_CATEGORY_LABELS[post.category])
  const description = post.content?.trim() || sessionDescription || SALON_CATEGORY_LABELS[post.category]
  const firstMedia = firstShareCardImageCandidate(post.media.map((media) => ({ url: media.previewUrl, width: media.width, height: media.height })))
  const imageCandidates = shareCardImageCandidates(post.media.map((media) => ({ url: media.previewUrl, width: media.width, height: media.height })))
  return {
    type: 'salon',
    contentId: post.id,
    title,
    description: postContentPlainText(description, null, { preserveLineBreaks: true }),
    image: firstMedia?.url || null,
    imageWidth: firstMedia?.width,
    imageHeight: firstMedia?.height,
    imageCandidates,
    url: canonicalShareUrl(`/salon/${post.id}`),
    author: getPublicUserDisplayName(post.author),
    authorAvatar: safeAuthorAvatar(post.author.Profile?.avatarUrl || post.author.avatarUrl),
    date: formatDate(post.createdAt),
    meta: [
      { label: '沙龙', value: SALON_CATEGORY_LABELS[post.category] },
      ...(post.concert ? [
        { label: '演唱会', value: post.concert.MusicTour.name },
        { label: '场次', value: sessionDescription },
      ] : []),
    ],
  }
}

export async function loadPublicShareCardData(type: ShareCardContentType, contentId: string) {
  if (type === 'post') return loadPostShareCardData(contentId)
  if (type === 'activity') return loadActivityShareCardData(contentId)
  return loadSalonShareCardData(contentId)
}

export function shareCardObjectKey(type: ShareCardContentType, contentId: string, hash: string) {
  if (!isValidShareCardContentId(contentId)) throw new Error('SHARE_CARD_CONTENT_ID_INVALID')
  if (!/^[a-f0-9]{64}$/i.test(hash)) throw new Error('SHARE_CARD_HASH_INVALID')
  const folder = type === 'post' ? 'posts' : type === 'activity' ? 'activities' : 'salon'
  return `share-cards/${folder}/${contentId}/${hash}.png`
}

export function shareCardPublicUrl(objectKey: string) {
  const url = buildPublicMediaUrl(objectKey)
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:') throw new Error('SHARE_CARD_PUBLIC_URL_MUST_BE_HTTPS')
  return parsed.toString()
}

export type ShareCardCacheDependencies = Readonly<{
  headObject: (objectKey: string) => Promise<boolean>
  render: (data: ShareCardData) => Promise<Buffer | ShareCardRenderResult>
  upload: (input: { objectKey: string; body: Buffer; contentType: typeof SHARE_CARD_MIME_TYPE }) => Promise<string>
}>

/** Deterministic COS cache with one in-process renderer per content version. */
export function createShareCardCache(dependencies: ShareCardCacheDependencies) {
  const pending = new Map<string, Promise<ShareCardResult>>()

  return {
    async getOrCreate(data: ShareCardData): Promise<ShareCardResult> {
      const contentType = data.type
      if (!data.contentId || !isShareCardContentType(contentType)) throw new Error('SHARE_CARD_CONTENT_ID_REQUIRED')
      const hash = createShareCardContentHash(data)
      const objectKey = shareCardObjectKey(contentType, data.contentId, hash)
      const url = shareCardPublicUrl(objectKey)
      const existing = pending.get(objectKey)
      if (existing) return existing

      const work = (async () => {
        const fallbackHeight = calculateShareCardLayout(data).height
        if (await dependencies.headObject(objectKey)) {
          return { url, cached: true, hash, width: SHARE_CARD_WIDTH, height: fallbackHeight, mimeType: SHARE_CARD_MIME_TYPE } satisfies ShareCardResult
        }
        const rendered = await dependencies.render(data)
        const body = Buffer.isBuffer(rendered) ? rendered : rendered.body
        const height = Buffer.isBuffer(rendered) ? fallbackHeight : rendered.height
        await dependencies.upload({ objectKey, body, contentType: SHARE_CARD_MIME_TYPE })
        return { url, cached: false, hash, width: SHARE_CARD_WIDTH, height, mimeType: SHARE_CARD_MIME_TYPE } satisfies ShareCardResult
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
  render: (data) => renderShareCardPngWithInfo(data),
  upload: ({ objectKey, body, contentType }) => uploadSiteImage({ key: objectKey, body, contentType }),
})

export async function getOrCreatePublicShareCard(type: ShareCardContentType, contentId: string) {
  const data = await loadPublicShareCardData(type, contentId)
  if (!data) throw new ShareCardContentNotFoundError(type, contentId)
  return defaultShareCardCache.getOrCreate(data)
}

export const shareCardCacheForTests = defaultShareCardCache
