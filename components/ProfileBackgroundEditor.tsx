'use client'

import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent } from 'react'
import {
  constrainProfileBackgroundTransform,
  DEFAULT_PROFILE_BACKGROUND_TRANSFORM,
  getProfileBackgroundConstraints,
  normalizeProfileBackgroundTransform,
  profileBackgroundTransformStyle,
  updateProfileBackgroundTransformForDrag,
  type ProfileBackgroundDevice,
  type ProfileBackgroundGeometry,
  type ProfileBackgroundTransform,
} from '@/lib/profile-background'

const maxBackgroundSourceSize = 10 * 1024 * 1024
const backgroundUploadTimeoutMs = 30000
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])

type TransformDraft = {
  desktop: ProfileBackgroundTransform
  mobile: ProfileBackgroundTransform
}

function cloneTransform(value: ProfileBackgroundTransform | null | undefined) {
  return normalizeProfileBackgroundTransform(value || DEFAULT_PROFILE_BACKGROUND_TRANSFORM)
}

function createDraft(
  desktop: ProfileBackgroundTransform | null | undefined,
  mobile: ProfileBackgroundTransform | null | undefined,
): TransformDraft {
  return { desktop: cloneTransform(desktop), mobile: cloneTransform(mobile) }
}

function loadImage(src: string) {
  return new Promise<void>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve()
    image.onerror = () => reject(new Error('图片加载失败，请重新选择图片'))
    image.src = src
  })
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    window.clearTimeout(timer)
  }
}

export function ProfileBackgroundEditor({
  sourceUrl,
  desktopTransform,
  mobileTransform,
  disabled = false,
  onChange,
  onUploaded,
  onUploadingChange,
}: {
  sourceUrl: string
  desktopTransform?: ProfileBackgroundTransform | null
  mobileTransform?: ProfileBackgroundTransform | null
  disabled?: boolean
  onChange: (desktop: ProfileBackgroundTransform, mobile: ProfileBackgroundTransform) => void
  onUploaded: (url: string, desktop: ProfileBackgroundTransform, mobile: ProfileBackgroundTransform) => void
  onUploadingChange?: (uploading: boolean) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    clientX: number
    clientY: number
    transform: ProfileBackgroundTransform
    width: number
    height: number
    geometry: ProfileBackgroundGeometry | null
  } | null>(null)
  const activeImageRef = useRef<HTMLImageElement>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [device, setDevice] = useState<ProfileBackgroundDevice>('desktop')
  const [draft, setDraft] = useState(() => createDraft(desktopTransform, mobileTransform))
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [pendingPreviewUrl, setPendingPreviewUrl] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [editorGeometry, setEditorGeometry] = useState<ProfileBackgroundGeometry | null>(null)

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)')
    const update = () => setDevice(media.matches ? 'desktop' : 'mobile')
    update()
    media.addEventListener?.('change', update)
    return () => media.removeEventListener?.('change', update)
  }, [])

  useEffect(() => () => {
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl)
  }, [pendingPreviewUrl])

  useEffect(() => {
    setEditorGeometry(null)
  }, [pendingPreviewUrl, sourceUrl, device])

  useEffect(() => {
    if (!isOpen) return
    const frame = frameRef.current
    if (!frame) return

    const measure = () => {
      const image = activeImageRef.current
      const rect = frame.getBoundingClientRect()
      if (!image || image.naturalWidth <= 0 || image.naturalHeight <= 0 || rect.width <= 0 || rect.height <= 0) return
      const nextGeometry: ProfileBackgroundGeometry = {
        device,
        imageSize: { width: image.naturalWidth, height: image.naturalHeight },
        containerSize: { width: rect.width, height: rect.height },
      }
      setEditorGeometry((current) => {
        if (
          current?.device === nextGeometry.device &&
          current.imageSize.width === nextGeometry.imageSize.width &&
          current.imageSize.height === nextGeometry.imageSize.height &&
          current.containerSize.width === nextGeometry.containerSize.width &&
          current.containerSize.height === nextGeometry.containerSize.height
        ) return current
        return nextGeometry
      })
    }

    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(frame)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [pendingPreviewUrl, sourceUrl, device, isOpen])

  const activeSourceUrl = pendingPreviewUrl || sourceUrl
  const activeTransform = draft[device]
  const activeConstraints = getProfileBackgroundConstraints({
    device,
    imageSize: editorGeometry?.imageSize,
    containerSize: editorGeometry?.containerSize,
  })

  useEffect(() => {
    if (!editorGeometry) return
    setDraft((current) => {
      const currentTransform = current[device]
      const constrained = constrainProfileBackgroundTransform(currentTransform, editorGeometry)
      if (
        constrained.scale === currentTransform.scale &&
        constrained.x === currentTransform.x &&
        constrained.y === currentTransform.y
      ) return current
      return { ...current, [device]: constrained }
    })
  }, [device, editorGeometry])

  function constrainActiveTransform(next: ProfileBackgroundTransform) {
    return constrainProfileBackgroundTransform(next, editorGeometry)
  }

  function setTransform(next: ProfileBackgroundTransform) {
    setDraft((current) => ({ ...current, [device]: constrainActiveTransform(next) }))
  }

  function openEditor() {
    setError('')
    setDraft(createDraft(desktopTransform, mobileTransform))
    setIsOpen(true)
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setError('')

    if (!allowedTypes.has(file.type)) {
      setError('背景图仅支持 JPG、PNG 或 WebP。')
      event.target.value = ''
      return
    }
    if (file.size > maxBackgroundSourceSize) {
      setError('原始背景图片不能超过 10MB。')
      event.target.value = ''
      return
    }

    const nextPreviewUrl = URL.createObjectURL(file)
    try {
      await loadImage(nextPreviewUrl)
    } catch (loadError) {
      URL.revokeObjectURL(nextPreviewUrl)
      setError(loadError instanceof Error ? loadError.message : '图片加载失败，请重新选择图片')
      event.target.value = ''
      return
    }

    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl)
    setPendingFile(file)
    setPendingPreviewUrl(nextPreviewUrl)
    // A new source must never inherit a crop tuned for a different image.
    setDraft(createDraft(null, null))
    setIsOpen(true)
    event.target.value = ''
  }

  function cancelEditor() {
    if (uploading) return
    if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl)
    setPendingFile(null)
    setPendingPreviewUrl(null)
    setError('')
    setIsOpen(false)
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!activeSourceUrl) return
    const frame = frameRef.current
    if (!frame) return
    const rect = frame.getBoundingClientRect()
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      transform: activeTransform,
      width: rect.width,
      height: rect.height,
      geometry: editorGeometry,
    }
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!drag) return
    setTransform(updateProfileBackgroundTransformForDrag(
      drag.transform,
      event.clientX - drag.clientX,
      event.clientY - drag.clientY,
      drag.width,
      drag.height,
      drag.geometry,
    ))
  }

  function onPointerUp(event: PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    dragRef.current = null
  }

  function saveSettings() {
    if (pendingFile) {
      void uploadNewSource()
      return
    }
    onChange(draft.desktop, draft.mobile)
    setIsOpen(false)
  }

  async function uploadNewSource() {
    if (!pendingFile || uploading) return
    setUploading(true)
    onUploadingChange?.(true)
    setError('')
    try {
      const body = new FormData()
      // Upload the original file. Desktop/mobile composition is persisted as
      // transforms, never as two separately cropped COS objects.
      body.append('file', pendingFile, pendingFile.name)
      body.append('kind', 'background')
      const response = await fetchWithTimeout('/api/uploads/profile-image', { method: 'POST', body }, backgroundUploadTimeoutMs)
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '背景图上传失败，请稍后重试')
      if (typeof data?.url !== 'string' || !data.url) throw new Error('背景图已上传，但服务器没有返回有效地址')

      onUploaded(data.url, draft.desktop, draft.mobile)
      if (pendingPreviewUrl) URL.revokeObjectURL(pendingPreviewUrl)
      setPendingFile(null)
      setPendingPreviewUrl(null)
      setIsOpen(false)
    } catch (uploadError) {
      setError(
        uploadError instanceof DOMException && uploadError.name === 'AbortError'
          ? '背景图上传超时，请稍后重试'
          : uploadError instanceof Error
            ? uploadError.message
            : '背景图上传失败，请稍后重试',
      )
    } finally {
      setUploading(false)
      onUploadingChange?.(false)
    }
  }

  return (
    <div className="profile-background-editor">
      <div className="profile-background-editor-preview overflow-hidden rounded-none border border-[var(--border)] bg-black">
        {sourceUrl ? (
          <div className="relative aspect-[9/2] overflow-hidden">
            {/* The same transform helper is used by the real profile hero. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={sourceUrl} alt="当前背景图预览" className="profile-background-image" style={profileBackgroundTransformStyle(desktopTransform || null)} />
          </div>
        ) : (
          <div className="grid aspect-[9/2] place-items-center bg-gradient-to-r from-sky-100 via-white to-cyan-50 text-sm font-black text-slate-400">背景预览</div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => inputRef.current?.click()} disabled={disabled || uploading} className="rounded-sm border border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-2 text-sm font-black text-[var(--foreground)] disabled:cursor-not-allowed disabled:opacity-60">
          {uploading ? '上传中…' : sourceUrl ? '更换背景图片' : '上传背景图'}
        </button>
        {sourceUrl ? <button type="button" onClick={openEditor} disabled={disabled || uploading} className="rounded-sm border border-[var(--primary)] bg-[var(--surface)] px-4 py-2 text-sm font-black text-[var(--primary)] disabled:cursor-not-allowed disabled:opacity-60">调整背景显示</button> : null}
      </div>
      <p className="mt-2 text-xs font-bold leading-5 text-slate-500">桌面端和移动端共用同一张原图，可分别调整缩放与位置；缩小后允许自然留黑，最终保存资料后生效。</p>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled || uploading} onChange={handleFileChange} className="sr-only" />
      {error ? <p className="mt-2 text-xs font-black leading-5 text-rose-600">{error}</p> : null}

      {isOpen ? (
        <div className="profile-background-crop-overlay fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55">
          <section className="profile-background-crop flex max-h-[calc(100dvh-24px)] w-full max-w-lg min-w-0 flex-col rounded-sm p-5 shadow-none" role="dialog" aria-modal="true" aria-label="设置个人主页背景">
            <div className="profile-background-crop-content min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain">
              <h3 className="text-xl font-black text-brand-950">设置个人主页背景</h3>
              <p className="profile-background-crop-description mt-1 text-sm font-bold text-slate-500">同一张原图分别保存桌面端与移动端构图。拖动图片调整位置，滑块可缩小到 cover 以下并保留黑边。</p>
              <div className="mt-4 grid grid-cols-2 gap-2" role="tablist" aria-label="背景显示设备">
                {(['desktop', 'mobile'] as const).map((value) => (
                  <button key={value} type="button" role="tab" aria-selected={device === value} onClick={() => setDevice(value)} className={`min-h-10 rounded-sm border px-3 py-2 text-sm font-black ${device === value ? 'border-[var(--primary)] bg-[var(--navigation-active)] text-[var(--primary)]' : 'border-[var(--border)] bg-[var(--surface)] text-[var(--foreground-muted)]'}`}>
                    {value === 'desktop' ? '桌面端' : '移动端'}
                  </button>
                ))}
              </div>
              <div
                ref={frameRef}
                className="profile-background-crop-frame relative mx-auto mt-5 w-full max-w-[450px] min-w-0 touch-none overflow-hidden rounded-none bg-black"
                style={{ aspectRatio: device === 'desktop' ? '9 / 2' : '12 / 7' }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
              >
                {activeSourceUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img ref={activeImageRef} src={activeSourceUrl} alt="背景图裁切预览" className="profile-background-image select-none" style={profileBackgroundTransformStyle(activeTransform, editorGeometry)} onLoad={() => {
                    const frame = frameRef.current
                    const image = activeImageRef.current
                    if (!frame || !image || image.naturalWidth <= 0 || image.naturalHeight <= 0) return
                    const rect = frame.getBoundingClientRect()
                    setEditorGeometry({
                      device,
                      imageSize: { width: image.naturalWidth, height: image.naturalHeight },
                      containerSize: { width: rect.width, height: rect.height },
                    })
                  }} draggable={false} />
                ) : <span className="absolute inset-0 grid place-items-center text-sm font-black text-white/60">背景预览</span>}
                <div className="pointer-events-none absolute inset-0 ring-2 ring-white/70" />
              </div>
              <label className="mt-5 block min-w-0">
                <span className="flex items-center justify-between gap-2 text-sm font-black text-slate-700"><span>缩放</span><span>{Math.max(activeTransform.scale, activeConstraints.minScale).toFixed(2)}×</span></span>
                <input type="range" min={activeConstraints.minScale} max={activeConstraints.maxScale} step="0.01" value={Math.max(activeTransform.scale, activeConstraints.minScale)} onChange={(event) => setTransform({ ...activeTransform, scale: Number(event.target.value) })} className="profile-background-crop-range mt-2 w-full max-w-full min-w-0" />
              </label>
              <p className="mt-2 text-xs font-bold leading-5 text-slate-500">最小缩放会保留一部分图片可见；缩小后没有图片覆盖的区域显示纯黑。</p>
            </div>
            <div className="profile-background-crop-actions mt-5 flex shrink-0 min-w-0 justify-between gap-2">
              <button type="button" onClick={() => setTransform(DEFAULT_PROFILE_BACKGROUND_TRANSFORM)} disabled={uploading} className="profile-background-crop-cancel min-w-0 rounded-sm border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-black text-[var(--foreground)] disabled:opacity-60">恢复默认</button>
              <div className="flex min-w-0 gap-2">
                <button type="button" onClick={cancelEditor} disabled={uploading} className="profile-background-crop-cancel min-w-0 rounded-sm border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-black text-[var(--foreground)] disabled:opacity-60">取消</button>
                <button type="button" onClick={saveSettings} disabled={uploading || !activeSourceUrl} className="profile-background-crop-confirm min-w-0 rounded-sm border border-[var(--primary)] bg-[var(--primary)] px-4 py-2 text-sm font-black text-[var(--primary-foreground)] disabled:opacity-60">{pendingFile ? '上传并保存' : '保存设置'}</button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  )
}
