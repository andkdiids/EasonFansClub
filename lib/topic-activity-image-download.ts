import { NextResponse } from 'next/server'
import { getCosObject } from '@/lib/tencent-cos'
import { topicActivityOriginalFilename } from '@/lib/topic-activity-image-original'

const MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif'])

export type TopicActivityOriginalDownloadAsset = {
  storageKey: string
  mimeType: string
  size: number
}

export type TopicActivityOriginalDownloadLogContext = {
  activityId: string
  submissionId: string
  assetId: string
  replyId?: string
}

function safeAsciiFilename(filename: string) {
  return filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_').replace(/[\r\n]/g, '_').slice(0, 180) || 'topic-activity-image'
}

function encodedFilename(filename: string) {
  // RFC 5987 attr-char excludes these five printable characters even though
  // encodeURIComponent leaves them unchanged.
  return encodeURIComponent(filename).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
}

function unavailableResponse() {
  return NextResponse.json({ message: '原图暂时无法下载，请稍后重试' }, {
    status: 502,
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
}

/**
 * Read one server-selected private original and return a controlled attachment
 * response. Callers must perform authentication and all relation checks before
 * invoking this helper. It intentionally does not expose COS URLs or keys.
 */
export async function downloadTopicActivityOriginal(
  asset: TopicActivityOriginalDownloadAsset,
  fallbackFilename: string,
  logContext?: TopicActivityOriginalDownloadLogContext,
  disposition: 'attachment' | 'inline' = 'attachment',
) {
  let body: Buffer
  try {
    body = await getCosObject(asset.storageKey)
  } catch (error) {
    console.error('[topic-activity.original-download.failed]', {
      ...logContext,
      errorName: error instanceof Error ? error.name : 'UNKNOWN',
    })
    return unavailableResponse()
  }

  // Never send a body under the size promised by the database. This protects
  // against an empty/truncated object and avoids leaking storage behavior.
  if (!body.byteLength || body.byteLength !== asset.size) {
    console.error('[topic-activity.original-download.size-mismatch]', logContext)
    return unavailableResponse()
  }

  const mimeType = MIME_TYPES.has(asset.mimeType) ? asset.mimeType : 'application/octet-stream'
  const filename = topicActivityOriginalFilename(asset.storageKey, fallbackFilename, mimeType)
  const asciiFilename = safeAsciiFilename(filename)
  return new NextResponse(body as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': mimeType,
      'Content-Length': String(body.byteLength),
      'Content-Disposition': `${disposition}; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename(filename)}`,
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      Vary: 'Cookie, Authorization',
    },
  })
}
