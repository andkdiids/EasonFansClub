import {
  classifySelection,
  detectVideoContainer,
  summarizeSelection,
  type ClassifiedSelection,
  type SelectionSummary,
} from './live-photo-probe'

export class LivePhotoClientError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'LivePhotoClientError'
    this.code = code
  }
}

export type LivePhotoUploadResult = { assetId: string; status: string }

/** XHR is used deliberately: fetch has no reliable upload progress in browsers. */
export function uploadLivePhotoMedia(params: {
  cover: File | Blob
  video?: File | Blob | null
  requestId: string
  onProgress?: (percent: number) => void
  signal?: AbortSignal
}) {
  return new Promise<LivePhotoUploadResult>((resolve, reject) => {
    const form = new FormData()
    const coverName = params.cover instanceof File ? params.cover.name : 'cover.jpg'
    form.append('cover', params.cover, coverName)
    if (params.video) {
      const videoName = params.video instanceof File ? params.video.name : 'paired.mov'
      form.append('video', params.video, videoName)
    }
    form.append('requestId', params.requestId)
    // Native motion photos carry their own embedded clip; the server extracts
    // and verifies it, so this is never a user-made pairing.
    form.append('manual', '0')

    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/media/live-photo', true)
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) params.onProgress?.(Math.min(99, Math.round(event.loaded / event.total * 100)))
    }
    xhr.onerror = () => reject(new LivePhotoClientError('NETWORK', '网络异常，请重试'))
    xhr.onabort = () => reject(new LivePhotoClientError('ABORTED', '上传已取消'))
    xhr.onload = () => {
      let payload: { asset?: { id?: string; status?: string }; code?: string; message?: string } = {}
      try {
        payload = JSON.parse(xhr.responseText || '{}')
      } catch {
        payload = {}
      }
      if (xhr.status < 200 || xhr.status >= 300 || !payload.asset?.id) {
        reject(new LivePhotoClientError(payload.code || 'UPLOAD_FAILED', payload.message || '实况照片上传失败，请重试'))
        return
      }
      params.onProgress?.(100)
      resolve({ assetId: payload.asset.id, status: payload.asset.status || 'PROCESSING' })
    }
    params.signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.send(form)
  })
}

export async function waitForLivePhotoAsset(
  assetId: string,
  params: { signal?: AbortSignal; onStatus?: (status: string) => void } = {},
) {
  const deadline = Date.now() + 180_000
  while (Date.now() < deadline) {
    if (params.signal?.aborted) throw new LivePhotoClientError('ABORTED', '处理已取消')
    const response = await fetch(`/api/media/live-photo/${assetId}`, { cache: 'no-store', signal: params.signal })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new LivePhotoClientError(payload.code || 'STATUS_FAILED', payload.message || '无法读取媒体处理状态')
    }
    const status = String(payload.asset?.status || 'PENDING')
    params.onStatus?.(status)
    if (status === 'READY') return payload.asset
    if (status === 'FAILED' || status === 'CANCELLED') {
      throw new LivePhotoClientError('TRANSCODE_FAILED', '实况照片处理失败，请重新上传')
    }
    await new Promise((resolve) => setTimeout(resolve, 1200))
  }
  throw new LivePhotoClientError('TIMEOUT', '媒体处理超时，请在实况照片管理中查看结果')
}

const DETECTION_HEAD_BYTES = 512 * 1024
const DETECTION_TAIL_BYTES = 1024 * 1024

async function readHead(file: File) {
  return new Uint8Array(await file.slice(0, Math.min(file.size, DETECTION_HEAD_BYTES)).arrayBuffer())
}

async function readTail(file: File) {
  if (file.size <= DETECTION_HEAD_BYTES) return undefined
  const start = Math.max(DETECTION_HEAD_BYTES, file.size - DETECTION_TAIL_BYTES)
  return new Uint8Array(await file.slice(start).arrayBuffer())
}

export type DetectedMedia = ClassifiedSelection & {
  file: File
  /** MOV/MP4 that belongs to this still (Apple pairing across one selection). */
  pairedVideo?: File
}

/**
 * Inspect the files exactly as the picker returned them, before the existing
 * image compressor touches them. Nothing here guesses from names: motion
 * photos are recognised from their XMP offset, Apple pairs from the shared
 * content identifier.
 */
export async function detectSelectedMedia(files: readonly File[]): Promise<{ items: DetectedMedia[]; summary: SelectionSummary }> {
  const heads = await Promise.all(files.map(readHead))
  const tails = await Promise.all(heads.map((head, index) => (
    detectVideoContainer(head) === 'unknown' ? undefined : readTail(files[index])
  )))
  const classified = classifySelection(heads.map((head, index) => ({
    head,
    tail: tails[index],
    size: files[index].size,
    mime: files[index].type,
  })))
  const items = classified.map((item, index) => ({
    ...item,
    file: files[index],
    pairedVideo: item.pairedVideoIndex === undefined ? undefined : files[item.pairedVideoIndex],
  }))
  return { items, summary: summarizeSelection(classified) }
}
