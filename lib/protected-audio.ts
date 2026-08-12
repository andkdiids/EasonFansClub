import { Readable, type Stream } from 'node:stream'
import {
  getGuessSongObjectMetadata,
  openGuessSongObjectStream,
} from '@/lib/guess-song-storage'

type ByteRange = {
  start: number
  end: number
}

type RangeParseResult = ByteRange | { invalid: true } | null

type ProtectedAudioOptions = {
  cacheControl?: string
}

function jsonError(message: string, code: string, status: number, headers?: HeadersInit) {
  const responseHeaders = new Headers(headers)
  responseHeaders.set('Cache-Control', 'private, no-store')
  responseHeaders.set('Content-Type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify({ ok: false, code, message }), {
    status,
    headers: responseHeaders,
  })
}

export function parseAudioRangeHeader(value: string | null, size: number): RangeParseResult {
  if (!value) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim())
  if (!match || size <= 0 || (!match[1] && !match[2])) return { invalid: true }

  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { invalid: true }
    return { start: Math.max(0, size - suffixLength), end: size - 1 }
  }

  const start = Number(match[1])
  const requestedEnd = match[2] ? Number(match[2]) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start >= size || requestedEnd < start) {
    return { invalid: true }
  }
  return { start, end: Math.min(requestedEnd, size - 1) }
}

function baseAudioHeaders(metadata: {
  contentType: string | null
  etag: string | null
  lastModified: string | null
}, contentLength: number, cacheControl = 'private, no-store') {
  const headers = new Headers()
  headers.set('Cache-Control', cacheControl)
  headers.set('Content-Disposition', 'inline')
  headers.set('Content-Type', metadata.contentType || 'audio/mpeg')
  headers.set('Content-Length', String(contentLength))
  headers.set('Accept-Ranges', 'bytes')
  if (metadata.etag) headers.set('ETag', metadata.etag)
  if (metadata.lastModified) headers.set('Last-Modified', metadata.lastModified)
  return headers
}

/**
 * Stream a private Guess Song/COS object without exposing a COS URL or
 * buffering the object in the application process.
 */
export async function streamProtectedGuessSongAudio(
  request: Request,
  key: string,
  options: ProtectedAudioOptions = {},
) {
  let metadata: Awaited<ReturnType<typeof getGuessSongObjectMetadata>>
  try {
    metadata = await getGuessSongObjectMetadata(key)
  } catch (error) {
    console.error('[protected-audio.metadata]', { key, error })
    return jsonError('音频服务暂时不可用，请稍后重试', 'AUDIO_STORAGE_UNAVAILABLE', 502)
  }

  const size = metadata?.contentLength
  if (!metadata || size === null || size === undefined || !Number.isSafeInteger(size) || size < 0) {
    return jsonError('音频文件不存在或暂时不可用', 'AUDIO_NOT_FOUND', 404)
  }

  const range = parseAudioRangeHeader(request.headers.get('range'), size)
  if (range && 'invalid' in range) {
    const headers = new Headers({
      'Accept-Ranges': 'bytes',
      'Content-Range': `bytes */${size}`,
      'Content-Length': '0',
      'Cache-Control': 'private, no-store',
    })
    return new Response(null, { status: 416, headers })
  }

  const start = range?.start ?? 0
  const end = range?.end ?? Math.max(0, size - 1)
  const contentLength = range ? end - start + 1 : size
  const headers = baseAudioHeaders(metadata, contentLength, options.cacheControl)
  const status = range ? 206 : 200
  if (range) headers.set('Content-Range', `bytes ${start}-${end}/${size}`)

  if (request.method === 'HEAD') return new Response(null, { status, headers })

  let stream: Stream
  try {
    stream = openGuessSongObjectStream(key, range ? `bytes=${start}-${end}` : undefined)
  } catch (error) {
    console.error('[protected-audio.stream]', { key, range, error })
    return jsonError('音频服务暂时不可用，请稍后重试', 'AUDIO_STREAM_UNAVAILABLE', 502)
  }

  const nodeStream = stream as Readable
  nodeStream.on('error', (error) => {
    console.error('[protected-audio.stream-error]', { key, range, error })
  })
  return new Response(Readable.toWeb(nodeStream) as unknown as ReadableStream, { status, headers })
}
