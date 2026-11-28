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
  cover: File
  video?: File | null
  requestId: string
  onProgress?: (percent: number) => void
  signal?: AbortSignal
}) {
  return new Promise<LivePhotoUploadResult>((resolve, reject) => {
    const form = new FormData()
    form.append('cover', params.cover)
    if (params.video) form.append('video', params.video)
    form.append('requestId', params.requestId)
    form.append('manual', params.video ? '1' : '0')

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
