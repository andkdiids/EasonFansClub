'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ChangeEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { ImageEditor } from '@/components/ImageEditor'
import {
  ClipboardImageReadError,
  ContentImageClientError,
  isContentImageAbortError,
  readClipboardImageFiles,
  uploadContentImage,
  type ContentImageUploadPhase,
} from '@/lib/content-image-browser'
import {
  CONTENT_IMAGE_ACCEPT,
  CONTENT_IMAGE_ERROR_MESSAGES,
  CONTENT_IMAGE_MAX_RETRIES,
} from '@/lib/content-image-upload'
import type { ContentImageUploadErrorCode } from '@/lib/content-image-upload'
import { MAX_CONTENT_IMAGES, reorderContentImageUrls } from '@/lib/content-images'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { isLivePhotoMarker, livePhotoIdFromMarker, toLivePhotoMarker } from '@/lib/live-photo-markers'
import {
  LivePhotoClientError,
  detectSelectedMedia,
  uploadLivePhotoMedia,
  waitForLivePhotoAsset,
} from '@/lib/live-photo-browser'
import { LIVE_PHOTO_MISSING_VIDEO_NOTICE } from '@/lib/live-photo-probe'
import { LivePhotoSurface } from '@/components/live-photo/LivePhotoSurface'

type PointerDragState = {
  pointerId: number
  url: string
  currentIndex: number
}

type PendingUploadPhase = ContentImageUploadPhase | 'failed'

export type UploadEntry = 'picker' | 'clipboard' | 'editor'

/**
 * Non-sensitive facts about one upload attempt. Enough to tell "the browser
 * never gave us the clip" apart from "our extractor or transcoder failed",
 * without ever carrying photo content, EXIF, GPS or storage paths.
 */
export type UploadDiagnostic = {
  entry: UploadEntry
  userAgent: string
  fileType: string
  fileSize: number
  kind: string
  pairing?: string
  imageContainer: string
  videoContainer: string
  trailerBytes?: number
  motionPhotoClaimed?: boolean
  /** Any XMP packet at all, even when no motion-photo marker was recognised. */
  hasXmp?: boolean
  /** Presence only. The identifier value itself is a pairing token and is
   * never copied into a report. */
  appleIdentifier?: boolean
  missingPairedVideo?: boolean
  requestId: string
  assetId?: string
  assetStatus?: string
  assetStage?: string
  errorCode?: string
  /** Server-side verdict, filled in once the asset reports READY. */
  serverPairing?: string | null
  serverWidth?: number | null
  serverHeight?: number | null
  serverDurationMs?: number | null
  serverVideoCodec?: string | null
  serverAudioCodec?: string | null
  serverHasAudio?: boolean | null
  serverVideoBytes?: number | null
  serverCoverBytes?: number | null
  /** What the draft/post payload actually kept for this slot. */
  mediaValue?: 'live-marker' | 'image-url'
}

type PendingUpload = {
  id: string
  file: File
  previewUrl: string
  phase: PendingUploadPhase
  error?: string
  errorCode?: ContentImageUploadErrorCode
  retryCount: number
  previewFailed?: boolean
  /** A native live photo occupies a single media slot, like any other image. */
  kind: 'image' | 'live-photo'
  pairing?: 'MOTION_PHOTO' | 'APPLE'
  pairedVideo?: File
  /** Real upload percentage for the live photo path (0-100). */
  progress?: number
  liveStage?: string
  diagnostic?: UploadDiagnostic
  /** False only for failures that retrying cannot change (wrong container,
   * over-long clip). The user still gets the static-photo escape hatch. */
  retryable?: boolean
}

type LocalUploadedFile = {
  file: File
  previewUrl: string
}

type EditingImage = {
  kind: 'pending' | 'uploaded'
  id: string
  file: File
  url?: string
}

function createUploadId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return `content-image-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function isBusyPhase(phase: PendingUploadPhase) {
  return phase !== 'failed'
}

function busyLabel(items: readonly PendingUpload[]) {
  if (items.some((item) => item.phase === 'uploading')) return '上传中…'
  if (items.some((item) => item.phase === 'compressing')) return '正在压缩…'
  if (items.some((item) => item.phase === 'queued')) return '排队中…'
  return '处理中…'
}

function failureCode(reason: unknown): ContentImageUploadErrorCode {
  return reason instanceof ContentImageClientError ? reason.code : 'UPLOAD_FAILED'
}

function failureMessage(reason: unknown) {
  if (reason instanceof ContentImageClientError && CONTENT_IMAGE_ERROR_MESSAGES[reason.code]) return CONTENT_IMAGE_ERROR_MESSAGES[reason.code]
  return CONTENT_IMAGE_ERROR_MESSAGES.UPLOAD_FAILED
}

function liveFailureMessage(reason: unknown) {
  if (reason instanceof LivePhotoClientError && reason.code !== 'ABORTED') return reason.message
  if (reason instanceof Error && reason.message.trim()) return reason.message
  return '实况照片上传失败，请重试'
}

/** Upload-time rejections the server can be specific about. */
const LIVE_PHOTO_UPLOAD_MESSAGES: Record<string, string> = {
  MOTION_PHOTO_INVALID: '未能从这张照片中读取动态视频，可改为普通图片上传',
  INVALID_DIMENSIONS: '实况视频格式暂不支持，可改为普通图片上传',
  UNSUPPORTED_VIDEO: '实况视频格式暂不支持，可改为普通图片上传',
  DURATION_UNKNOWN: '未能读取实况视频时长，可改为普通图片上传',
  VIDEO_TOO_LONG: '实况视频超过时长上限，可改为普通图片上传',
  TOO_LARGE: '照片体积超过上传上限，请压缩后重试',
  FEATURE_DISABLED: '实况照片功能暂未开放，将作为普通图片上传',
}

function livePhotoErrorMessage(reason: unknown) {
  if (reason instanceof LivePhotoClientError) {
    return LIVE_PHOTO_UPLOAD_MESSAGES[reason.code] || reason.message
  }
  return liveFailureMessage(reason)
}

/** Repeating these produces the same rejection, so the retry entry point is
 * replaced by the static fallback instead of inviting a useless loop. */
const DETERMINISTIC_LIVE_CODES = new Set([
  'MOTION_PHOTO_INVALID',
  'UNSUPPORTED_VIDEO',
  'UNSUPPORTED_IMAGE',
  'INVALID_DIMENSIONS',
  'DURATION_UNKNOWN',
  'VIDEO_TOO_LONG',
  'TOO_LARGE',
  'EMPTY_FILE',
])

function diagnosticStage(diagnostic: UploadDiagnostic | undefined, hasError: boolean) {
  if (!hasError) return '-'
  if (!diagnostic?.assetId) return '上传或服务端媒体校验'
  if (diagnostic.assetStatus === 'FAILED') return '服务端转码'
  return '状态查询或转码'
}

/**
 * `video=unknown` alone proves nothing: a browser can hand back a perfectly
 * normal JPEG because it stripped the clip, or hand back a motion photo whose
 * container we still have to parse. These verdicts keep those cases apart, so
 * a failure is never blamed on the browser without evidence.
 */
export type UploadResourceVerdict =
  | 'LIVE_PHOTO_READY'
  | 'DYNAMIC_RESOURCE_UNPARSABLE'
  | 'DYNAMIC_RESOURCE_PROCESSING_FAILED'
  | 'NO_DYNAMIC_RESOURCE'
  | 'STATIC_IMAGE'
  | 'UNSUPPORTED_FILE'
  | 'PENDING'

const UNPARSABLE_ERROR_CODES = new Set([
  'MOTION_PHOTO_INVALID',
  'UNSUPPORTED_VIDEO',
  'UNSUPPORTED_IMAGE',
  'INVALID_DIMENSIONS',
  'DURATION_UNKNOWN',
])

export function uploadResourceVerdict(diagnostic: UploadDiagnostic | undefined, kind: string): UploadResourceVerdict {
  if (!diagnostic) return 'PENDING'
  if (diagnostic.assetStatus === 'READY') return 'LIVE_PHOTO_READY'
  const code = diagnostic.errorCode || ''
  if (diagnostic.assetStatus === 'FAILED' || code) {
    return UNPARSABLE_ERROR_CODES.has(code) ? 'DYNAMIC_RESOURCE_UNPARSABLE' : 'DYNAMIC_RESOURCE_PROCESSING_FAILED'
  }
  if (kind === 'live-photo') return 'PENDING'
  if (kind === 'unsupported') return 'UNSUPPORTED_FILE'
  // A still that names its paired clip but arrived without one: the browser
  // kept the photo and dropped the video.
  if (diagnostic.appleIdentifier || diagnostic.missingPairedVideo) return 'NO_DYNAMIC_RESOURCE'
  return 'STATIC_IMAGE'
}

const VERDICT_LABELS: Record<UploadResourceVerdict, string> = {
  LIVE_PHOTO_READY: 'LIVE_PHOTO_READY（已识别动态资源并转为可播放实况）',
  DYNAMIC_RESOURCE_UNPARSABLE: 'DYNAMIC_RESOURCE_UNPARSABLE（文件含动态资源，但容器无法解析）',
  DYNAMIC_RESOURCE_PROCESSING_FAILED: 'DYNAMIC_RESOURCE_PROCESSING_FAILED（已提取，转码或存储失败）',
  NO_DYNAMIC_RESOURCE: 'NO_DYNAMIC_RESOURCE（照片声明有配对视频，浏览器未提供）',
  STATIC_IMAGE: 'STATIC_IMAGE（普通静态照片，不涉及动态资源）',
  UNSUPPORTED_FILE: 'UNSUPPORTED_FILE（既不是可解析图片也不是实况照片）',
  PENDING: 'PENDING（尚未得到服务端结论）',
}

function buildDiagnosticReport(item: PendingUpload, completed = false) {
  const diagnostic = item.diagnostic
  const verdict = uploadResourceVerdict(diagnostic, diagnostic?.kind ?? item.kind)
  const number = (value: number | null | undefined) => value === null || value === undefined ? '-' : String(value)
  const liveBadge = item.kind !== 'live-photo'
    ? '不适用'
    : completed
      ? '已显示'
      : item.phase === 'failed' ? '未显示' : '处理中，尚未出现'
  const lines = [
    '[私家E院 实况照片上传诊断]',
    `时间: ${new Date().toISOString()}`,
    `入口: ${diagnostic?.entry ?? '-'}`,
    `浏览器: ${diagnostic?.userAgent ?? '-'}`,
    `原始文件: ${diagnostic?.fileType || '(未提供 MIME)'} / ${number(diagnostic?.fileSize ?? item.file.size)} bytes`,
    `客户端识别: kind=${diagnostic?.kind ?? item.kind} pairing=${diagnostic?.pairing ?? '-'} image=${diagnostic?.imageContainer ?? '-'} video=${diagnostic?.videoContainer ?? '-'} trailer=${number(diagnostic?.trailerBytes)} claimed=${diagnostic?.motionPhotoClaimed ?? false}`,
    `运动照片标记: xmp=${diagnostic?.hasXmp ?? false} motionPhoto=${diagnostic?.motionPhotoClaimed ?? false} appleIdentifier=${diagnostic?.appleIdentifier ?? false} missingPairedVideo=${diagnostic?.missingPairedVideo ?? false}`,
    `服务端判定: pairing=${diagnostic?.serverPairing ?? '-'} size=${number(diagnostic?.serverVideoBytes)} coverSize=${number(diagnostic?.serverCoverBytes)} ${number(diagnostic?.serverWidth)}x${number(diagnostic?.serverHeight)} durationMs=${number(diagnostic?.serverDurationMs)}`,
    `转码结果: v=${diagnostic?.serverVideoCodec ?? '-'} a=${diagnostic?.serverAudioCodec ?? '-'} hasAudio=${diagnostic?.serverHasAudio ?? '-'}`,
    `最终类型: ${item.kind === 'live-photo' ? 'LIVE_PHOTO' : 'IMAGE'}（表单内=${diagnostic?.mediaValue ?? '-'}）`,
    `LIVE 标识: ${liveBadge}`,
    `请求 ID: ${diagnostic?.requestId || '-'}`,
    `媒体任务: ${diagnostic?.assetId ?? '-'} status=${diagnostic?.assetStatus ?? '-'} stage=${diagnostic?.assetStage ?? '-'} error=${diagnostic?.errorCode ?? '-'}`,
    `资源判定: ${VERDICT_LABELS[verdict]}`,
    `失败阶段: ${completed ? '-' : diagnosticStage(diagnostic, item.phase === 'failed')}`,
    `界面提示: ${item.error ?? '-'}`,
  ]
  return lines.join('\n')
}

export type ContentImageUploadState = Readonly<{
  pendingCount: number
  failedCount: number
  blocked: boolean
}>

export type ContentImageUploaderHandle = {
  addFiles: (files: File[]) => void
  getUploadState: () => ContentImageUploadState
}

type ContentImageUploaderProps = Readonly<{
  value: string[]
  onChange: (urls: string[]) => void
  existingCount?: number
  onBusyChange?: (busy: boolean) => void
  onUploadStateChange?: (state: ContentImageUploadState) => void
}>

export const ContentImageUploader = forwardRef<ContentImageUploaderHandle, ContentImageUploaderProps>(function ContentImageUploader({
  value,
  onChange,
  existingCount = 0,
  onBusyChange,
  onUploadStateChange,
}, ref) {
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([])
  const [error, setError] = useState('')
  const [draggingUrl, setDraggingUrl] = useState<string | null>(null)
  const [clipboardReading, setClipboardReading] = useState(false)
  const [editingImage, setEditingImage] = useState<EditingImage | null>(null)
  const [replacingUrl, setReplacingUrl] = useState<string | null>(null)
  /** Shown only when the photo is objectively a live photo but the browser
   * handed us no clip. Plain photos never trigger it. */
  const [liveNotice, setLiveNotice] = useState('')
  /** Diagnostics stay hidden from ordinary users; the flag is only granted by
   * the server, and only asked for after a live photo upload fails. */
  const [canDiagnose, setCanDiagnose] = useState(false)
  const diagnosticsCheckedRef = useRef(false)
  const [diagnosticCopied, setDiagnosticCopied] = useState('')
  const scrollAnchorRef = useRef<number | null>(null)
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  const onBusyChangeRef = useRef(onBusyChange)
  const onUploadStateChangeRef = useRef(onUploadStateChange)
  const pendingUploadsRef = useRef(pendingUploads)
  const clipboardReadingRef = useRef(false)
  const draggingUrlRef = useRef<string | null>(null)
  const pointerDragRef = useRef<PointerDragState | null>(null)
  const itemRefs = useRef(new Map<string, HTMLDivElement>())
  const localUploadedFilesRef = useRef(new Map<string, LocalUploadedFile>())
  const editingImageRef = useRef<EditingImage | null>(null)
  const replacingUrlRef = useRef(replacingUrl)
  const uploadControllersRef = useRef(new Map<string, AbortController>())
  /** Finished uploads, keyed by the value URL they produced. */
  const completedUploadsRef = useRef(new Map<string, PendingUpload>())
  const disposedRef = useRef(false)

  function getUploadState(): ContentImageUploadState {
    const pendingCount = pendingUploadsRef.current.filter((item) => isBusyPhase(item.phase)).length
    const failedCount = pendingUploadsRef.current.filter((item) => item.phase === 'failed').length
    const blocked = pendingCount > 0 || failedCount > 0 || Boolean(editingImageRef.current) || Boolean(replacingUrlRef.current)
    return { pendingCount, failedCount, blocked }
  }

  useEffect(() => {
    valueRef.current = value
  }, [value])

  useEffect(() => {
    onChangeRef.current = onChange
    onBusyChangeRef.current = onBusyChange
    onUploadStateChangeRef.current = onUploadStateChange
  }, [onBusyChange, onChange, onUploadStateChange])

  useEffect(() => {
    pendingUploadsRef.current = pendingUploads
    editingImageRef.current = editingImage
    replacingUrlRef.current = replacingUrl
    onBusyChangeRef.current?.(pendingUploads.some((item) => isBusyPhase(item.phase)) || Boolean(editingImage) || Boolean(replacingUrl))
    onUploadStateChangeRef.current?.(getUploadState())
  }, [editingImage, pendingUploads, replacingUrl])

  useEffect(() => {
    const currentUrls = new Set(value)
    for (const [url, local] of localUploadedFilesRef.current) {
      if (!currentUrls.has(url)) {
        URL.revokeObjectURL(local.previewUrl)
        localUploadedFilesRef.current.delete(url)
      }
    }
  }, [value])

  useEffect(() => {
    disposedRef.current = false
    return () => {
      disposedRef.current = true
      uploadControllersRef.current.forEach((controller) => controller.abort())
      uploadControllersRef.current.clear()
      pendingUploadsRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
      localUploadedFilesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl))
    }
  }, [])

  function updatePendingUpload(id: string, update: Partial<PendingUpload>) {
    if (disposedRef.current) return
    const next = pendingUploadsRef.current.map((item) => item.id === id ? { ...item, ...update } : item)
    pendingUploadsRef.current = next
    setPendingUploads(next)
  }

  function removePendingUpload(id: string) {
    uploadControllersRef.current.get(id)?.abort()
    uploadControllersRef.current.delete(id)
    const target = pendingUploadsRef.current.find((item) => item.id === id)
    if (target) URL.revokeObjectURL(target.previewUrl)
    const next = pendingUploadsRef.current.filter((item) => item.id !== id)
    pendingUploadsRef.current = next
    setPendingUploads(next)
  }

  function completePendingUpload(item: PendingUpload, url: string) {
    const next = pendingUploadsRef.current.filter((current) => current.id !== item.id)
    pendingUploadsRef.current = next
    setPendingUploads(next)
    // Keep the finished record so an admin can still explain a photo that was
    // accepted as a plain still instead of a live photo.
    completedUploadsRef.current.set(url, { ...item, diagnostic: { ...item.diagnostic, mediaValue: item.kind === 'live-photo' ? 'live-marker' : 'image-url' } })
    const previous = localUploadedFilesRef.current.get(url)
    if (previous && previous.previewUrl !== item.previewUrl) URL.revokeObjectURL(previous.previewUrl)
    localUploadedFilesRef.current.set(url, { file: item.file, previewUrl: item.previewUrl })
    const editing = editingImageRef.current
    if (editing?.kind === 'pending' && editing.id === item.id) {
      setEditingImage({ kind: 'uploaded', id: url, url, file: item.file })
    }
  }

  function appendUploadedUrl(url: string) {
    const current = valueRef.current
    if (current.includes(url)) return
    const next = [...current, url]
    valueRef.current = next
    onChangeRef.current(next)
  }

  function patchDiagnostic(id: string, patch: Partial<UploadDiagnostic>) {
    const current = pendingUploadsRef.current.find((candidate) => candidate.id === id)
    if (!current?.diagnostic) return
    updatePendingUpload(id, { diagnostic: { ...current.diagnostic, ...patch } })
  }

  async function ensureDiagnosticsPermission() {
    if (diagnosticsCheckedRef.current) return
    diagnosticsCheckedRef.current = true
    try {
      // The endpoint already answers `canManage`; a normal member simply never
      // gets the button, so no extra permission surface is introduced.
      const response = await fetch('/api/media/live-photo', { cache: 'no-store' })
      if (!response.ok) return
      const payload: { canManage?: boolean } = await response.json().catch(() => ({}))
      if (payload?.canManage === true && !disposedRef.current) setCanDiagnose(true)
    } catch {
      // Diagnostics are optional; never surface a second error for them.
    }
  }

  async function copyDiagnostics(item: PendingUpload) {
    const report = buildDiagnosticReport(item)
    try {
      await navigator.clipboard.writeText(report)
      setDiagnosticCopied(item.id)
      window.setTimeout(() => setDiagnosticCopied(''), 2000)
    } catch {
      setError('复制失败，请手动选择诊断文本')
    }
  }

  /** One report covering every slot that was ever selected, finished or not. */
  async function copyAllDiagnostics() {
    const completed = valueRef.current
      .map((url) => completedUploadsRef.current.get(url))
      .filter((item): item is PendingUpload => Boolean(item))
    const reports = [
      ...completed.map((item) => buildDiagnosticReport(item, true)),
      ...pendingUploadsRef.current.map((item) => buildDiagnosticReport(item)),
    ]
    if (!reports.length) {
      setError('还没有可诊断的图片，请先选择图片。')
      return
    }
    try {
      await navigator.clipboard.writeText(reports.join('\n\n'))
      setDiagnosticCopied('all')
      window.setTimeout(() => setDiagnosticCopied(''), 2000)
    } catch {
      setError('复制失败，请手动选择诊断文本')
    }
  }

  /** Explicit downgrade chosen by the user; the original file is reused, never
   * a recompressed copy, so the still keeps its full quality. */
  function uploadAsImage(item: PendingUpload) {
    const current = pendingUploadsRef.current.find((candidate) => candidate.id === item.id)
    if (!current) return
    const next: PendingUpload = {
      ...current,
      kind: 'image',
      pairedVideo: undefined,
      pairing: undefined,
      phase: 'processing',
      error: undefined,
      errorCode: undefined,
      progress: undefined,
      liveStage: undefined,
    }
    updatePendingUpload(item.id, next)
    void uploadItem(next)
  }

  async function submitLivePhotoAsset(item: PendingUpload, controller: AbortController) {
    const requestId = `${item.id}-r${item.retryCount}`
    const { assetId } = await uploadLivePhotoMedia({
      cover: item.file,
      video: item.pairedVideo,
      // Retries must create a fresh task: the server dedupes by request key, so
      // reusing it would return the failed asset instead of re-transcoding.
      requestId,
      onProgress: (percent) => updatePendingUpload(item.id, { progress: percent, phase: 'uploading', liveStage: `上传中 ${percent}%` }),
      signal: controller.signal,
    })
    patchDiagnostic(item.id, { requestId, assetId, assetStatus: 'PENDING' })
    updatePendingUpload(item.id, { phase: 'processing', progress: 100, liveStage: '媒体处理中…' })
    const asset = (await waitForLivePhotoAsset(assetId, {
      signal: controller.signal,
      onStatus: (status) => {
        patchDiagnostic(item.id, { assetStatus: status })
        updatePendingUpload(item.id, {
          phase: 'processing',
          liveStage: status === 'READY' ? '处理完成' : '媒体处理中…',
        })
      },
    })) as Record<string, unknown> | undefined
    // The server's own verdict is the only trustworthy record of what the clip
    // really was; keep it in the diagnostics for successful uploads too.
    const numberOrNull = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : null
    const textOrNull = (value: unknown) => typeof value === 'string' && value ? value : null
    patchDiagnostic(item.id, {
      assetStatus: 'READY',
      serverPairing: textOrNull(asset?.pairing),
      serverWidth: numberOrNull(asset?.width),
      serverHeight: numberOrNull(asset?.height),
      serverDurationMs: numberOrNull(asset?.durationMs),
      serverVideoCodec: textOrNull(asset?.videoCodec),
      serverAudioCodec: textOrNull(asset?.audioCodec),
      serverHasAudio: typeof asset?.hasAudio === 'boolean' ? asset.hasAudio : null,
      serverVideoBytes: numberOrNull(asset?.size),
      serverCoverBytes: numberOrNull(asset?.coverSize),
      mediaValue: 'live-marker',
    })
    return toLivePhotoMarker(assetId)
  }

  async function convertLiveToStatic(url: string) {
    const id = livePhotoIdFromMarker(url)
    if (!id) return
    setError('')
    try {
      // The private cover is not readable by visitors, so the server must
      // re-publish it as a normal content image before the marker is dropped.
      const response = await fetch(`/api/media/live-photo/${id}/convert`, { method: 'POST' })
      const payload: { url?: string; message?: string } = await response.json().catch(() => ({}))
      if (!response.ok || !payload.url) throw new Error(payload.message || '关闭实况失败，请重试')
      const next = valueRef.current.map((item) => item === url ? payload.url! : item)
      valueRef.current = next
      onChangeRef.current(next)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '关闭实况失败，请重试')
    }
  }

  function removeUploadedUrl(url: string) {
    uploadControllersRef.current.get(`replace:${url}`)?.abort()
    uploadControllersRef.current.delete(`replace:${url}`)
    const local = localUploadedFilesRef.current.get(url)
    if (local) {
      URL.revokeObjectURL(local.previewUrl)
      localUploadedFilesRef.current.delete(url)
    }
    const next = valueRef.current.filter((item) => item !== url)
    valueRef.current = next
    onChangeRef.current(next)
  }

  async function uploadItem(item: PendingUpload) {
    if (uploadControllersRef.current.has(item.id)) return
    const current = pendingUploadsRef.current.find((candidate) => candidate.id === item.id)
    if (!current || disposedRef.current) return
    // A retry reuses its own slot, so it never needs spare capacity.
    if (current.phase === 'failed' && current.retryCount >= CONTENT_IMAGE_MAX_RETRIES) {
      updatePendingUpload(item.id, { error: `重试次数已达上限（${CONTENT_IMAGE_MAX_RETRIES} 次），请删除后重新选择图片` })
      return
    }
    const retryCount = current.phase === 'failed' ? current.retryCount + 1 : current.retryCount
    const runItem = { ...current, phase: 'processing' as const, error: undefined, errorCode: undefined, retryCount, progress: undefined, liveStage: undefined }
    updatePendingUpload(item.id, runItem)
    const controller = new AbortController()
    uploadControllersRef.current.set(item.id, controller)
    try {
      // Plain images keep the existing form.set('file', file) multipart contract;
      // only detected live photos take the separate media route.
      const url = runItem.kind === 'live-photo'
        ? await submitLivePhotoAsset(runItem, controller)
        : (await uploadContentImage(item.file, (phase) => {
          updatePendingUpload(item.id, { phase })
        }, { signal: controller.signal })).url
      if (!pendingUploadsRef.current.some((current) => current.id === item.id)) return
      patchDiagnostic(item.id, { mediaValue: runItem.kind === 'live-photo' ? 'live-marker' : 'image-url' })

      appendUploadedUrl(url)
      const completed = pendingUploadsRef.current.find((current) => current.id === item.id)
      if (completed) completePendingUpload(completed, url)
    } catch (reason) {
      if (!pendingUploadsRef.current.some((current) => current.id === item.id)) return
      if (isContentImageAbortError(reason)) return
      if (reason instanceof LivePhotoClientError && reason.code === 'ABORTED') return
      if (runItem.kind === 'live-photo') {
        const details = reason instanceof LivePhotoClientError ? reason.details : undefined
        patchDiagnostic(item.id, {
          errorCode: details?.errorCode ?? (reason instanceof LivePhotoClientError ? reason.code : 'UNKNOWN'),
          ...(details?.assetId ? { assetId: details.assetId } : {}),
          ...(details?.status ? { assetStatus: details.status } : {}),
          ...(details?.stage ? { assetStage: details.stage } : {}),
        })
        void ensureDiagnosticsPermission()
      }
      updatePendingUpload(item.id, {
        phase: 'failed',
        error: runItem.kind === 'live-photo' ? livePhotoErrorMessage(reason) : failureMessage(reason),
        errorCode: runItem.kind === 'live-photo' ? 'UPLOAD_FAILED' : failureCode(reason),
        retryable: runItem.kind === 'live-photo'
          ? !(reason instanceof LivePhotoClientError && DETERMINISTIC_LIVE_CODES.has(reason.code))
          : true,
        progress: undefined,
        liveStage: undefined,
      })
    } finally {
      if (uploadControllersRef.current.get(item.id) === controller) uploadControllersRef.current.delete(item.id)
    }
  }

  function completePendingEdit(id: string, editedFile: File) {
    const current = pendingUploadsRef.current.find((item) => item.id === id)
    if (!current) {
      const editing = editingImageRef.current
      if (editing?.kind === 'uploaded' && editing.url) void completeUploadedEdit(editing.url, editedFile)
      return
    }
    uploadControllersRef.current.get(id)?.abort()
    uploadControllersRef.current.delete(id)
    const previewUrl = URL.createObjectURL(editedFile)
    URL.revokeObjectURL(current.previewUrl)
    const replacement: PendingUpload = { ...current, file: editedFile, previewUrl, phase: 'processing', error: undefined }
    updatePendingUpload(id, replacement)
    setEditingImage(null)
    void uploadItem(replacement)
  }

  async function completeUploadedEdit(url: string, editedFile: File) {
    const current = localUploadedFilesRef.current.get(url)
    if (!current) return
    setEditingImage(null)
    replacingUrlRef.current = url
    setReplacingUrl(url)
    setError('')
    const controller = new AbortController()
    uploadControllersRef.current.set(`replace:${url}`, controller)
    try {
      const { url: nextUrl } = await uploadContentImage(editedFile, () => undefined, { signal: controller.signal })
      if (disposedRef.current) return
      const previewUrl = URL.createObjectURL(editedFile)
      if (nextUrl === url) {
        URL.revokeObjectURL(current.previewUrl)
        localUploadedFilesRef.current.set(url, { file: editedFile, previewUrl })
        return
      }
      const next = valueRef.current.map((item) => item === url ? nextUrl : item)
      valueRef.current = next
      onChangeRef.current(next)
      localUploadedFilesRef.current.delete(url)
      URL.revokeObjectURL(current.previewUrl)
      localUploadedFilesRef.current.set(nextUrl, { file: editedFile, previewUrl })
    } catch (reason) {
      localUploadedFilesRef.current.set(url, current)
      if (!isContentImageAbortError(reason) && !disposedRef.current) setError(failureMessage(reason))
    } finally {
      if (uploadControllersRef.current.get(`replace:${url}`) === controller) uploadControllersRef.current.delete(`replace:${url}`)
      replacingUrlRef.current = null
      if (!disposedRef.current) setReplacingUrl(null)
    }
  }

  async function addFiles(files: readonly File[], entry: UploadEntry = 'picker') {
    const nextFiles = Array.from(files)
    if (!nextFiles.length) return

    // Every pending card, failed ones included, already holds a media slot.
    const currentCount = existingCount + valueRef.current.length + pendingUploadsRef.current.length
    const remaining = MAX_CONTENT_IMAGES - currentCount
    if (remaining <= 0) {
      setError(`最多只能添加 ${MAX_CONTENT_IMAGES} 张图片。`)
      return
    }

    setError('')
    // Classification reads the original bytes. It must happen before the
    // compressor runs, because Canvas/EXIF rewriting drops the embedded clip.
    setLiveNotice('')
    let detected: Awaited<ReturnType<typeof detectSelectedMedia>>
    try {
      detected = await detectSelectedMedia(nextFiles)
    } catch {
      setError('无法读取所选文件的媒体信息，请重新选择。')
      return
    }
    if (disposedRef.current) return

    const accepted = detected.items
      .map((item, index) => ({ item, index }))
      .filter((entry) => entry.item.kind === 'image' || entry.item.kind === 'live-photo')
    if (!accepted.length) {
      setError(detected.summary.skippedVideos
        ? '暂不支持直接上传视频，请选择照片或实况照片。'
        : '所选文件不是可用的图片，请重新选择。')
      return
    }

    // Detection awaited, so another selection may have landed meanwhile; the
    // slot count has to be read again before accepting this batch.
    const freshCount = existingCount + valueRef.current.length + pendingUploadsRef.current.length
    const freshRemaining = Math.max(0, MAX_CONTENT_IMAGES - freshCount)
    if (!freshRemaining) {
      setError(`最多只能添加 ${MAX_CONTENT_IMAGES} 张图片。`)
      return
    }

    const limited = accepted.slice(0, freshRemaining)
    const truncated = accepted.length > limited.length
    const newItems = limited.map(({ item }): PendingUpload => {
      const file = item.file
      return {
        id: createUploadId(),
        file,
        // Local preview is created before any compression/network work starts.
        previewUrl: URL.createObjectURL(file),
        phase: 'queued',
        retryCount: 0,
        kind: item.kind === 'live-photo' ? 'live-photo' : 'image',
        ...(item.pairing ? { pairing: item.pairing } : {}),
        ...(item.pairedVideo ? { pairedVideo: item.pairedVideo } : {}),
        diagnostic: {
          entry,
          userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
          fileType: file.type,
          fileSize: file.size,
          kind: item.kind,
          ...(item.pairing ? { pairing: item.pairing } : {}),
          imageContainer: item.imageContainer,
          videoContainer: item.videoContainer,
          ...(item.trailerBytes ? { trailerBytes: item.trailerBytes } : {}),
          ...(item.motionPhotoClaimed ? { motionPhotoClaimed: true } : {}),
          ...(item.hasXmp ? { hasXmp: true } : {}),
          ...(item.appleIdentifier ? { appleIdentifier: true } : {}),
          ...(item.missingPairedVideo ? { missingPairedVideo: true } : {}),
          requestId: '',
        },
      }
    })
    const nextPending = [...pendingUploadsRef.current, ...newItems]
    pendingUploadsRef.current = nextPending
    setPendingUploads(nextPending)
    setError(truncated || detected.summary.unsupported
      ? `最多只能添加 ${MAX_CONTENT_IMAGES} 张图片。`
      : '')
    if (detected.summary.missingVideoNotice) setLiveNotice(LIVE_PHOTO_MISSING_VIDEO_NOTICE)
    // Diagnostics are asked for as soon as a file is selected, so a successful
    // upload that silently stayed static is still inspectable.
    void ensureDiagnosticsPermission()

    // Each item owns its own status/error. A failed image never aborts the
    // remaining files, so successful uploads stay visible.
    void (async () => {
      for (const item of newItems) await uploadItem(item)
    })()
  }

  useImperativeHandle(ref, () => ({ addFiles, getUploadState }))

  function rememberScrollAnchor() {
    if (typeof window === 'undefined') return
    scrollAnchorRef.current = window.scrollY
    // iOS/WeChat may swallow the change event when the picker is cancelled, so
    // restore as soon as the window comes back instead of waiting for a file.
    const onFocus = () => {
      window.removeEventListener('focus', onFocus)
      if (scrollAnchorRef.current !== null) restoreScrollAnchor()
    }
    window.addEventListener('focus', onFocus, { once: true })
  }

  /**
   * Opening the OS picker on iOS/WeChat can scroll the document. Restoring the
   * anchor keeps the editor exactly where the user left it instead of jumping
   * to the bottom when the picker closes or the selection is cancelled.
   */
  function restoreScrollAnchor() {
    const anchor = scrollAnchorRef.current
    scrollAnchorRef.current = null
    if (anchor === null || typeof window === 'undefined') return
    const apply = () => {
      if (Math.abs(window.scrollY - anchor) < 40) return
      window.scrollTo({ top: anchor, left: window.scrollX })
    }
    requestAnimationFrame(() => {
      apply()
      window.setTimeout(apply, 80)
    })
  }

  function selectFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || [])
    // Reset immediately so selecting the same photo again is still observable
    // after a failed upload on iOS Safari/Android WebView.
    event.target.value = ''
    if (!files.length) {
      restoreScrollAnchor()
      return
    }
    void addFiles(files).finally(restoreScrollAnchor)
  }

  async function pasteFromClipboard() {
    if (clipboardReadingRef.current) return
    clipboardReadingRef.current = true
    setClipboardReading(true)
    setError('')
    try {
      const files = await readClipboardImageFiles()
      if (!files.length) {
        setError('剪贴板中没有可用图片。')
        return
      }
      void addFiles(files, 'clipboard')
    } catch (reason) {
      if (reason instanceof ClipboardImageReadError && reason.code === 'UNSUPPORTED') {
        setError('当前浏览器不支持直接读取剪贴板，请按 Ctrl+V 粘贴图片。')
      } else {
        setError('无法读取剪贴板，请允许剪贴板权限，或按 Ctrl+V 粘贴图片。')
      }
    } finally {
      clipboardReadingRef.current = false
      setClipboardReading(false)
    }
  }

  function markPreviewFailed(id: string) {
    updatePendingUpload(id, { previewFailed: true })
  }

  function setDragging(url: string | null) {
    draggingUrlRef.current = url
    setDraggingUrl(url)
  }

  function moveDraggedImage(targetIndex: number) {
    const dragged = draggingUrlRef.current
    if (!dragged) return
    const current = valueRef.current
    const fromIndex = current.indexOf(dragged)
    if (fromIndex < 0) return
    const next = reorderContentImageUrls(current, fromIndex, targetIndex)
    if (next.every((url, index) => url === current[index])) return
    valueRef.current = next
    onChangeRef.current(next)
    const nextIndex = next.indexOf(dragged)
    if (pointerDragRef.current) pointerDragRef.current.currentIndex = nextIndex
  }

  function getTargetIndex(clientX: number, clientY: number) {
    const current = valueRef.current
    for (let index = 0; index < current.length; index += 1) {
      const element = itemRefs.current.get(current[index])
      if (!element) continue
      const rect = element.getBoundingClientRect()
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) continue
      return index + (clientY > rect.top + rect.height / 2 ? 1 : 0)
    }
    return null
  }

  function beginPointerDrag(url: string, event: ReactPointerEvent<HTMLDivElement>) {
    // Desktop mouse dragging uses the native HTML5 path below. Pointer capture
    // is reserved for touch/pen so the two drag implementations do not compete.
    if (event.pointerType === 'mouse') return
    const index = valueRef.current.indexOf(url)
    if (index < 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    pointerDragRef.current = { pointerId: event.pointerId, url, currentIndex: index }
    setDragging(url)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = pointerDragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const targetIndex = getTargetIndex(event.clientX, event.clientY)
    if (targetIndex === null || targetIndex === drag.currentIndex || targetIndex === drag.currentIndex + 1) return
    event.preventDefault()
    moveDraggedImage(targetIndex)
  }

  function finishPointerDrag(event?: ReactPointerEvent<HTMLDivElement>) {
    const drag = pointerDragRef.current
    if (!drag || (event && drag.pointerId !== event.pointerId)) return
    const element = itemRefs.current.get(drag.url)
    if (element?.hasPointerCapture(drag.pointerId)) element.releasePointerCapture(drag.pointerId)
    pointerDragRef.current = null
    setDragging(null)
  }

  function handleHtmlDragStart(url: string, event: React.DragEvent<HTMLDivElement>) {
    draggingUrlRef.current = url
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', url)
    setDragging(url)
  }

  function handleHtmlDragOver(url: string, event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
    const element = itemRefs.current.get(url)
    if (!element) return
    const rect = element.getBoundingClientRect()
    moveDraggedImage(valueRef.current.indexOf(url) + (event.clientY > rect.top + rect.height / 2 ? 1 : 0))
  }

  function finishHtmlDrag() {
    setDragging(null)
  }

  const busy = pendingUploads.some((item) => isBusyPhase(item.phase)) || Boolean(editingImage) || Boolean(replacingUrl)
  // Every pending card owns a media slot, including a failed one: otherwise a
  // run of failures lets the user add far more than the limit, and the counter
  // (which used to exclude them) disagrees with what is on screen.
  const totalCount = existingCount + value.length + pendingUploads.length
  const canAddMore = totalCount < MAX_CONTENT_IMAGES

  return (
    <div className="post-content-image-uploader w-full min-w-0 max-w-full space-y-2">
      <div className="flex min-w-0 max-w-full flex-wrap gap-2">
        <label
          className="post-content-image-uploader-trigger flex min-w-0 flex-1 basis-52 cursor-pointer box-border items-center rounded-lg border border-sky-100 bg-sky-50 px-4 py-2 text-sm font-black text-brand-700"
          onClick={rememberScrollAnchor}
        >
          {busy ? `${busyLabel(pendingUploads)}（${totalCount}/${MAX_CONTENT_IMAGES}）` : `添加图片（${totalCount}/${MAX_CONTENT_IMAGES}）`}
          <input
            type="file"
            accept={CONTENT_IMAGE_ACCEPT}
            multiple
            disabled={busy}
            onChange={selectFiles}
            className="sr-only"
          />
        </label>
        <button
          type="button"
          disabled={!canAddMore || clipboardReading}
          onClick={() => void pasteFromClipboard()}
          className="min-w-0 max-w-full flex-1 basis-52 rounded-lg border border-sky-100 bg-white px-4 py-2 text-sm font-black text-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {clipboardReading ? '读取剪贴板…' : '从剪贴板添加'}
        </button>
      </div>

      {pendingUploads.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-live="polite">
          {pendingUploads.map((item) => (
            <article key={item.id} className="overflow-hidden rounded-xl border border-sky-100 bg-white">
              <div className="relative">
                {item.previewFailed ? (
                  <div className="flex h-24 items-center justify-center bg-slate-100 px-2 text-center text-xs font-bold text-slate-500">
                    {item.file.name || '图片'}
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.previewUrl}
                    alt={item.file.name || '待上传图片'}
                    className="pointer-events-none h-24 w-full bg-slate-50 object-cover"
                    onError={() => markPreviewFailed(item.id)}
                  />
                )}
                {isBusyPhase(item.phase) ? (
                  <span className="absolute inset-x-1 bottom-1 rounded bg-slate-950/70 px-1 py-0.5 text-center text-[11px] font-black text-white">
                    {item.liveStage || (item.phase === 'queued' ? '排队中…' : item.phase === 'compressing' ? '正在压缩…' : item.phase === 'uploading' ? '上传中…' : '处理中…')}
                  </span>
                ) : null}
                {item.kind === 'live-photo' && isBusyPhase(item.phase) ? (
                  <span className="absolute left-1 top-1 rounded bg-slate-950/75 px-1.5 py-0.5 text-[10px] font-black tracking-wide text-white">
                    实况
                  </span>
                ) : null}
              </div>
              <div className="space-y-1 p-2 text-xs font-bold">
                <p className={item.phase === 'failed' ? 'text-red-600' : 'text-sky-700'} role="status">
                  {item.phase === 'failed'
                    ? item.kind === 'live-photo'
                      ? '实况照片处理失败'
                      : `上传失败（${item.retryCount}/${CONTENT_IMAGE_MAX_RETRIES} 次重试）`
                    : item.liveStage || (item.phase === 'queued' ? '排队中…' : item.phase === 'compressing' ? '正在压缩…' : item.phase === 'uploading' ? '上传中…' : '处理中…')}
                </p>
                {item.kind === 'live-photo' && isBusyPhase(item.phase) && item.progress !== undefined ? (
                  <div className="h-1.5 overflow-hidden rounded bg-slate-100" role="progressbar" aria-valuenow={item.progress} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full bg-amber-500 transition-all" style={{ width: `${item.progress}%` }} />
                  </div>
                ) : null}
                {item.phase === 'failed' && item.error ? <p className="break-words text-red-600">{item.error}</p> : null}
                <div className="flex flex-wrap gap-2">
                  {item.kind === 'live-photo' ? null : (
                    <button type="button" onClick={() => setEditingImage({ kind: 'pending', id: item.id, file: item.file })} disabled={isBusyPhase(item.phase)} className="text-brand-700 disabled:opacity-40">编辑</button>
                  )}
                  {item.phase === 'failed' && item.retryable !== false ? <button type="button" disabled={item.retryCount >= CONTENT_IMAGE_MAX_RETRIES} onClick={() => void uploadItem(item)} className="text-brand-700 disabled:cursor-not-allowed disabled:opacity-40">{item.retryCount >= CONTENT_IMAGE_MAX_RETRIES ? '重试次数已达上限' : '重试'}</button> : null}
                  {/* The still image is always valid, so a failed clip can be
                      posted as a plain photo — but only when the user says so. */}
                  {item.phase === 'failed' && item.kind === 'live-photo' ? <button type="button" onClick={() => uploadAsImage(item)} className="text-amber-700">作为普通图片上传</button> : null}
                  {/* Available for every attempt, not only failures: the silent
                      "uploaded but stayed a still photo" case is the one that
                      needs a verdict. */}
                  {canDiagnose ? <button type="button" onClick={() => void copyDiagnostics(item)} className="text-slate-500">{diagnosticCopied === item.id ? '已复制' : '复制诊断信息'}</button> : null}
                  <button type="button" onClick={() => removePendingUpload(item.id)} className="text-red-600">删除</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : null}

      {value.length ? (
        <div
          className="grid grid-cols-2 gap-2 sm:grid-cols-4"
          onPointerMove={handlePointerMove}
          onPointerUp={finishPointerDrag}
          onPointerCancel={finishPointerDrag}
        >
          {value.map((url) => {
            const local = localUploadedFilesRef.current.get(url)
            return <div
              key={url}
              ref={(element) => {
                if (element) itemRefs.current.set(url, element)
                else itemRefs.current.delete(url)
              }}
              draggable
              aria-grabbed={draggingUrl === url}
              onPointerDown={(event) => beginPointerDrag(url, event)}
              onDragStart={(event) => handleHtmlDragStart(url, event)}
              onDragOver={(event) => handleHtmlDragOver(url, event)}
              onDrop={(event) => {
                event.preventDefault()
                finishHtmlDrag()
              }}
              onDragEnd={finishHtmlDrag}
              className={`relative cursor-grab select-none ${draggingUrl === url ? 'z-10 opacity-60' : ''}`}
              style={{ touchAction: 'none' }}
            >
              {isLivePhotoMarker(url) ? (
                <LivePhotoSurface
                  coverUrl={`/api/media/live-photo/${livePhotoIdFromMarker(url)}/cover`}
                  videoUrl={`/api/media/live-photo/${livePhotoIdFromMarker(url)}/video`}
                  alt="已上传实况照片，点击 LIVE 可预览"
                  loading="lazy"
                  imageClassName="pointer-events-none h-24 w-full rounded-xl object-cover"
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={local?.previewUrl || publicImageVariantUrl(url, 'thumb-md') || url} alt="已上传内容，拖拽可调整顺序" className="pointer-events-none h-24 w-full rounded-xl object-cover" loading="lazy" />
              )}
              <span className="absolute inset-x-1 bottom-1 rounded bg-emerald-700/85 px-1 py-0.5 text-center text-[11px] font-black text-white" role="status">上传成功</span>
              {isLivePhotoMarker(url) ? (
                <button
                  type="button"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => void convertLiveToStatic(url)}
                  className="absolute bottom-8 left-1 rounded-full bg-amber-700/90 px-2 py-1 text-xs text-white"
                >关闭实况</button>
              ) : null}
              {local && !isLivePhotoMarker(url) ? <button
                type="button"
                disabled={replacingUrl === url}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => setEditingImage({ kind: 'uploaded', id: url, url, file: local.file })}
                className="absolute left-1 top-1 rounded-full bg-sky-600/90 px-2 py-1 text-xs text-white disabled:opacity-50"
              >{replacingUrl === url ? '处理中…' : '编辑'}</button> : null}
              <button
                type="button"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => removeUploadedUrl(url)}
                className="absolute right-1 top-1 rounded-full bg-slate-950/80 px-2 py-1 text-xs text-white"
              >
                删除
              </button>
            </div>
          })}
        </div>
      ) : null}
      {error ? <p className="text-sm font-bold text-red-600" role="alert">{error}</p> : null}
      {liveNotice ? (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900" role="status">{liveNotice}</p>
      ) : null}
      {busy ? <p className="text-xs font-bold text-slate-500" role="status">图片处理完成后才能发布帖子。</p> : null}
      {canDiagnose ? <button type="button" onClick={() => void copyAllDiagnostics()} className="text-xs font-bold text-slate-500 underline underline-offset-2">{diagnosticCopied === 'all' ? '已复制全部诊断' : '复制全部诊断信息'}</button> : null}
      {pendingUploads.some((item) => item.phase === 'failed') ? <p className="text-xs font-bold text-red-600" role="alert">有图片上传失败，请重试或删除失败图片后再发布。</p> : null}
      {editingImage ? <ImageEditor file={editingImage.file} onCancel={() => setEditingImage(null)} onComplete={(editedFile) => editingImage.kind === 'pending' ? completePendingEdit(editingImage.id, editedFile) : void completeUploadedEdit(editingImage.url!, editedFile)} /> : null}
    </div>
  )
})
