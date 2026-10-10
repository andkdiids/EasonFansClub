import { NextResponse } from 'next/server'
import { getCosObject } from '@/lib/tencent-cos'
import { imageVariantObjectPath } from '@/lib/image-variants'
import {
  isTopicActivityOriginalObjectKey,
  topicActivityPreviewObjectPath,
  type TopicActivityImagePurpose,
} from '@/lib/topic-activity-image-original'

export type TopicActivityPreviewVariant = 'preview' | 'thumbnail'

export type TopicActivityPreviewAsset = {
  storageKey: string
}

const SAFE_LEGACY_KEY_PART = /^[A-Za-z0-9_-]{1,191}$/u

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store, max-age=0',
  'Vary': 'Cookie, Authorization',
  'X-Content-Type-Options': 'nosniff',
}

function deniedResponse() {
  return NextResponse.json({ message: '图片预览不存在' }, { status: 404, headers: NO_STORE_HEADERS })
}

function unavailableResponse() {
  return NextResponse.json({ message: '图片预览暂时无法加载，请重试' }, { status: 502, headers: NO_STORE_HEADERS })
}

export function parseTopicActivityPreviewVariant(value: string | null): TopicActivityPreviewVariant | null {
  if (value === null || value === '') return 'preview'
  if (value === 'thumbnail') return 'thumbnail'
  return null
}

/** Stable same-origin URL keyed by application asset identity, never by COS key. */
export function topicActivityAssetPreviewUrl(activityId: string, assetId: string, variant: TopicActivityPreviewVariant = 'preview') {
  const base = `/api/activities/${encodeURIComponent(activityId)}/assets/${encodeURIComponent(assetId)}/preview`
  return variant === 'thumbnail' ? `${base}?variant=thumbnail` : base
}

function legacySourceKeyParts(storageKey: string) {
  const normalized = storageKey.trim().replace(/^\/+/, '')
  const parts = normalized.split('/')
  if (
    parts.length !== 5
    || parts[0] !== 'topic-activity'
    || !SAFE_LEGACY_KEY_PART.test(parts[1])
    || !['submissions', 'replies'].includes(parts[2])
    || !SAFE_LEGACY_KEY_PART.test(parts[3])
    || parts[4] !== 'source.webp'
  ) return null
  return { normalized, parts }
}

/** Only the pre-V6.1.1 source layout emitted by the old topic uploader. */
export function isTopicActivityLegacySourceObjectKey(storageKey: string, activityId: string, purpose: TopicActivityImagePurpose) {
  const parsed = legacySourceKeyParts(storageKey)
  if (!parsed || parsed.parts[1] !== activityId) return false
  return parsed.parts[2] === (purpose === 'ADMIN_REPLY' ? 'replies' : 'submissions')
}

function legacyPreviewObjectPath(storageKey: string, variant: TopicActivityPreviewVariant) {
  const parsed = legacySourceKeyParts(storageKey)
  if (!parsed) return null
  try {
    return imageVariantObjectPath(parsed.normalized, variant === 'thumbnail' ? 'thumb-md' : 'large')
  } catch {
    return null
  }
}

/** Derive a fixed private derivative only after the DB row's activity/purpose namespace is validated. */
export function topicActivityPreviewObjectPathForAsset(
  storageKey: string,
  activityId: string,
  purpose: TopicActivityImagePurpose,
  variant: TopicActivityPreviewVariant,
) {
  if (isTopicActivityOriginalObjectKey(storageKey, activityId, purpose)) return topicActivityPreviewObjectPath(storageKey, variant)
  if (!isTopicActivityLegacySourceObjectKey(storageKey, activityId, purpose)) return null
  return legacyPreviewObjectPath(storageKey, variant)
}

/**
 * Read only the generated private derivative. The original download route is
 * deliberately separate so preview failures can never alter source bytes or
 * turn this response into an original-image disclosure.
 */
export async function downloadTopicActivityPreview(
  asset: TopicActivityPreviewAsset,
  activityId: string,
  assetId: string,
  purpose: TopicActivityImagePurpose,
  variant: TopicActivityPreviewVariant,
) {
  const previewKey = topicActivityPreviewObjectPathForAsset(asset.storageKey, activityId, purpose, variant)
  if (!previewKey) return deniedResponse()

  let body: Buffer
  try {
    body = await getCosObject(previewKey)
  } catch (error) {
    console.error('[topic-activity.preview.failed]', {
      activityId,
      assetId,
      variant,
      errorName: error instanceof Error ? error.name : 'UNKNOWN',
    })
    return unavailableResponse()
  }

  if (!body.byteLength) return unavailableResponse()

  return new NextResponse(body as unknown as BodyInit, {
    status: 200,
    headers: {
      ...NO_STORE_HEADERS,
      'Content-Type': 'image/webp',
      'Content-Length': String(body.byteLength),
    },
  })
}
