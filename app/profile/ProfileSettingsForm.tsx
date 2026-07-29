'use client'

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type PointerEvent } from 'react'
import { useRouter } from 'next/navigation'
import { SafeAvatar } from '@/components/SafeAvatar'
import { publicImageUrl } from '@/lib/images'

type InitialProfile = {
  nickname: string
  avatarUrl: string
  backgroundUrl: string
  bio: string
  email: string
  phone: string
  emailVerifiedAt: string | null
  phoneVerifiedAt: string | null
  wallVisibility: ProfileWallVisibility
}

type UploadKind = 'avatar' | 'background'
type ProfileWallVisibility = 'PUBLIC' | 'FRIENDS' | 'CLOSED'

type CropState = {
  file: File
  url: string
  scale: number
  x: number
  y: number
}

const maxAvatarSourceSize = 10 * 1024 * 1024
const allowedAvatarTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
const allowedAvatarExtensions = new Set(['jpg', 'jpeg', 'png', 'webp'])
const unsupportedAvatarExtensions = new Set(['heic', 'heif'])
const avatarProcessTimeoutMs = 12000
const avatarUploadTimeoutMs = 30000

function createCompatibleId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()

  const bytes = new Uint8Array(16)
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes)
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

function fileExtension(fileName: string) {
  return fileName.split('.').pop()?.toLowerCase() || ''
}

function isAllowedAvatarFile(file: File) {
  return allowedAvatarTypes.has(file.type) || allowedAvatarExtensions.has(fileExtension(file.name))
}

function isUnsupportedAvatarFile(file: File) {
  return file.type === 'image/heic' || file.type === 'image/heif' || unsupportedAvatarExtensions.has(fileExtension(file.name))
}

async function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    const timer = window.setTimeout(() => {
      image.onload = null
      image.onerror = null
      reject(new Error('图片加载超时，请重新选择图片'))
    }, avatarProcessTimeoutMs)
    image.onload = () => {
      window.clearTimeout(timer)
      resolve(image)
    }
    image.onerror = () => {
      window.clearTimeout(timer)
      reject(new Error('图片加载失败，请重新选择图片'))
    }
    image.src = src
  })
}

function dataUrlToBlob(dataUrl: string) {
  const [header, data] = dataUrl.split(',')
  const mime = header.match(/^data:(.*?);base64$/)?.[1]
  if (!mime || !data) throw new Error('图片处理失败，请重新选择图片')

  const binary = window.atob(data)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return new Blob([bytes], { type: mime })
}

async function canvasToBlobOfType(canvas: HTMLCanvasElement, type: 'image/webp' | 'image/jpeg') {
  if (typeof canvas.toBlob === 'function') {
    const blob = await new Promise<Blob | null>((resolve) => {
      let settled = false
      const timer = window.setTimeout(() => {
        settled = true
        resolve(null)
      }, avatarProcessTimeoutMs)

      canvas.toBlob(
        (result) => {
          if (settled) return
          window.clearTimeout(timer)
          settled = true
          resolve(result)
        },
        type,
        0.85,
      )
    })

    if (blob?.size && blob.type === type) return blob
  }

  return null
}

function canvasToDataUrlBlobOfType(canvas: HTMLCanvasElement, type: 'image/jpeg') {
  const dataUrl = canvas.toDataURL(type, 0.85)
  if (!dataUrl.startsWith(`data:${type};base64,`)) return null

  const blob = dataUrlToBlob(dataUrl)
  if (!blob.size || blob.type !== type) return null
  return blob
}

async function canvasToBlobWithFallback(canvas: HTMLCanvasElement) {
  const webpBlob = await canvasToBlobOfType(canvas, 'image/webp')
  if (webpBlob) return { blob: webpBlob, type: 'image/webp' as const }

  const jpegBlob = (await canvasToBlobOfType(canvas, 'image/jpeg')) || canvasToDataUrlBlobOfType(canvas, 'image/jpeg')
  if (jpegBlob) return { blob: jpegBlob, type: 'image/jpeg' as const }

  throw new Error('图片处理失败，请重新选择 JPG、PNG 或 WebP 图片')
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

function maskPhone(phone: string) {
  if (!phone) return '未绑定'
  if (!/^1\d{10}$/.test(phone)) return phone
  return `${phone.slice(0, 3)}****${phone.slice(-4)}`
}

function maskEmail(email: string) {
  if (!email) return '未绑定'
  return email
}

async function cropAvatarToWebp(crop: CropState) {
  const image = await loadImage(crop.url)
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 512
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('浏览器暂时无法处理这张图片')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, 512, 512)

  const baseScale = Math.max(512 / image.naturalWidth, 512 / image.naturalHeight)
  const scale = baseScale * crop.scale
  const width = image.naturalWidth * scale
  const height = image.naturalHeight * scale
  const x = (512 - width) / 2 + crop.x
  const y = (512 - height) / 2 + crop.y
  ctx.drawImage(image, x, y, width, height)

  const output = await canvasToBlobWithFallback(canvas)
  if (!output.blob.size) throw new Error('图片处理失败，请重新选择 JPG、PNG 或 WebP 图片')

  const extension = output.type === 'image/webp' ? 'webp' : 'jpg'
  return { blob: output.blob, fileName: `avatar-${createCompatibleId()}.${extension}` }
}

export function ProfileSettingsForm({
  initialProfile,
  onCancel,
  onSaved,
}: {
  initialProfile: InitialProfile
  onCancel?: () => void
  onSaved?: () => void
}) {
  const router = useRouter()
  const [form, setForm] = useState(initialProfile)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState<UploadKind | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [crop, setCrop] = useState<CropState | null>(null)
  const dragRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null)
  const mountedRef = useRef(true)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const backgroundInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => {
    return () => {
      if (crop?.url) URL.revokeObjectURL(crop.url)
    }
  }, [crop?.url])

  function update<K extends keyof InitialProfile>(key: K, value: InitialProfile[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function resetCrop() {
    if (crop?.url) URL.revokeObjectURL(crop.url)
    setCrop(null)
    if (avatarInputRef.current) avatarInputRef.current.value = ''
  }

  function openAvatarCrop(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setMessage('')
    setError('')

    if (isUnsupportedAvatarFile(file)) {
      setError('暂不支持 HEIC/HEIF 图片，请先在相册中导出为 JPG、PNG 或 WebP 后再上传。')
      event.target.value = ''
      return
    }

    if (!isAllowedAvatarFile(file)) {
      setError('头像仅支持 JPG、PNG 或 WebP。')
      event.target.value = ''
      return
    }

    if (file.size > maxAvatarSourceSize) {
      setError('原始头像图片不能超过 10MB。')
      event.target.value = ''
      return
    }

    if (crop?.url) URL.revokeObjectURL(crop.url)
    setCrop({ file, url: URL.createObjectURL(file), scale: 1, x: 0, y: 0 })
  }

  function onCropPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!crop) return
    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = { x: event.clientX, y: event.clientY, startX: crop.x, startY: crop.y }
  }

  function onCropPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current
    if (!crop || !drag) return
    setCrop({ ...crop, x: drag.startX + event.clientX - drag.x, y: drag.startY + event.clientY - drag.y })
  }

  function onCropPointerUp(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.releasePointerCapture(event.pointerId)
    dragRef.current = null
  }

  async function confirmAvatarUpload() {
    if (!crop || uploading) return
    setUploading('avatar')
    setError('')
    setMessage('')

    try {
      const cropped = await cropAvatarToWebp(crop)
      const body = new FormData()
      body.append('file', cropped.blob, cropped.fileName)
      body.append('kind', 'avatar')

      const response = await fetchWithTimeout('/api/uploads/profile-image', { method: 'POST', body }, avatarUploadTimeoutMs)
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '头像上传失败，请稍后再试')
      if (!data?.url) throw new Error('头像已上传，但资料更新失败')

      setForm((current) => ({ ...current, avatarUrl: data.url }))
      setMessage('头像已更新，页面中的头像会使用新文件名立即刷新。')
      resetCrop()
      if (typeof CustomEvent === 'function') {
        window.dispatchEvent(new CustomEvent('profile-avatar-updated', { detail: { avatarUrl: data.url } }))
      }
      router.refresh()
    } catch (uploadError) {
      if (!mountedRef.current) return
      const message =
        uploadError instanceof DOMException && uploadError.name === 'AbortError'
          ? '头像上传超时，请稍后重试'
          : uploadError instanceof Error
            ? uploadError.message
            : '头像上传失败，请换一张图片再试'
      setError(message)
    } finally {
      if (mountedRef.current) setUploading(null)
    }
  }

  async function uploadBackground(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    setMessage('')
    setError('')
    setUploading('background')

    const body = new FormData()
    body.append('file', file)
    body.append('kind', 'background')

    const response = await fetch('/api/uploads/profile-image', { method: 'POST', body })
    const data = await response.json().catch(() => null)
    setUploading(null)

    if (!response.ok) {
      setError(data?.message || '背景图上传失败，请换一张图片再试')
      event.target.value = ''
      return
    }

    setForm((current) => ({ ...current, backgroundUrl: data.url }))
    setMessage('背景图已更新。')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setIsSaving(true)
    setMessage('')
    setError('')

    const response = await fetch('/api/users/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const data = await response.json().catch(() => null)

    setIsSaving(false)
    if (!response.ok) {
      setError(data?.message || '保存失败，请稍后再试')
      return
    }

    if (data?.profile) {
      setForm((current) => ({
        ...current,
        email: data.profile.email || '',
        phone: data.profile.phone || '',
        emailVerifiedAt: data.profile.emailVerifiedAt || null,
        phoneVerifiedAt: data.profile.phoneVerifiedAt || null,
        wallVisibility: data.profile.wallVisibility || current.wallVisibility,
      }))
    }
    setMessage(data?.emailVerificationSent ? '资料已保存，新邮箱需要查收邮件完成验证。' : data?.nicknameMessage || '资料已保存。')
    router.refresh()
    onSaved?.()
  }

  const avatarPreview = publicImageUrl(form.avatarUrl)
  const backgroundPreview = publicImageUrl(form.backgroundUrl)

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-5 rounded-[28px] border border-sky-100 bg-white/88 p-6 shadow-sm">
        <div>
          <p className="text-sm font-black tracking-[0.18em] text-sky-700">个人资料编辑器</p>
          <h2 className="mt-2 text-2xl font-black text-brand-950">编辑资料</h2>
          <p className="mt-2 text-sm font-bold text-slate-500">编辑内容只会更新你的个人资料；手机号和邮箱仅在这里自己可见。</p>
        </div>

        <section className="space-y-4 rounded-[24px] border border-sky-100 bg-sky-50/45 p-4">
          <div>
            <p className="text-xs font-black tracking-[0.18em] text-sky-700">个人资料</p>
            <h3 className="mt-1 text-lg font-black text-brand-950">个人资料</h3>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white bg-white/78 p-4">
              <p className="text-sm font-black text-slate-700">头像</p>
              <div className="mt-3 flex items-center gap-4">
                <span className="grid h-20 w-20 place-items-center overflow-hidden rounded-full bg-brand-950 text-2xl font-black text-white">
                  <SafeAvatar src={avatarPreview} name={form.nickname} className="h-full w-full" textClassName="text-2xl" />
                </span>
                <div className="min-w-0">
                  <button type="button" onClick={() => avatarInputRef.current?.click()} className="rounded-xl bg-sky-50 px-4 py-2 text-sm font-black text-brand-950 shadow-sm">
                    {uploading === 'avatar' ? '上传中...' : '选择头像'}
                  </button>
                  <p className="mt-2 text-xs font-bold leading-5 text-slate-500">自动裁剪为 512 × 512，优先 WebP，原图最大 10MB。</p>
                  <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png,image/webp,.heic,.heif" onChange={openAvatarCrop} className="hidden" />
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-white bg-white/78 p-4">
              <p className="text-sm font-black text-slate-700">主页背景图</p>
              <div className="mt-3 overflow-hidden rounded-2xl bg-white">
                <div
                  className="grid aspect-[16/7] place-items-center bg-gradient-to-r from-sky-100 via-white to-cyan-50 text-sm font-black text-slate-400"
                  style={backgroundPreview ? { backgroundImage: `url(${backgroundPreview})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined}
                >
                  {backgroundPreview ? '' : '背景预览'}
                </div>
              </div>
              <button type="button" onClick={() => backgroundInputRef.current?.click()} className="mt-3 rounded-xl bg-sky-50 px-4 py-2 text-sm font-black text-brand-950 shadow-sm">
                {uploading === 'background' ? '上传中...' : '上传背景图'}
              </button>
              <input ref={backgroundInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={uploadBackground} className="hidden" />
            </div>
          </div>

          <label className="block">
            <span className="text-sm font-black text-slate-700">昵称</span>
            <input
              value={form.nickname}
              onChange={(event) => update('nickname', event.target.value)}
              minLength={2}
              maxLength={32}
              className="mt-2 w-full rounded-2xl border border-sky-100 bg-white px-4 py-2 text-sm font-bold outline-none transition focus:border-brand-700"
              placeholder="请输入昵称"
            />
          </label>

          <label className="block">
            <span className="text-sm font-black text-slate-700">个人简介</span>
            <textarea
              value={form.bio}
              onChange={(event) => update('bio', event.target.value)}
              rows={5}
              maxLength={300}
              className="mt-2 w-full resize-none rounded-2xl border border-sky-100 bg-white px-4 py-2 text-sm font-bold leading-7 outline-none transition focus:border-brand-700"
              placeholder="写一点关于你的 Eason 故事"
            />
          </label>
        </section>

        <section className="space-y-4 rounded-[24px] border border-sky-100 bg-white p-4">
          <div>
            <p className="text-xs font-black tracking-[0.18em] text-sky-700">隐私设置</p>
            <h3 className="mt-1 text-lg font-black text-brand-950">留言墙隐私</h3>
            <p className="mt-1 text-sm font-bold leading-6 text-slate-500">选择谁可以查看你的个人主页留言墙并发布留言。</p>
          </div>
          <label className="block rounded-2xl border border-sky-100 bg-sky-50/50 p-4">
            <span className="text-sm font-black text-slate-700">留言墙可见范围</span>
            <select
              value={form.wallVisibility}
              onChange={(event) => update('wallVisibility', event.target.value as ProfileWallVisibility)}
              className="mt-3 w-full rounded-xl border border-sky-100 bg-white px-4 py-2 text-sm font-bold outline-none"
            >
              <option value="PUBLIC">公开</option>
              <option value="FRIENDS">仅好友</option>
              <option value="CLOSED">关闭</option>
            </select>
          </label>
        </section>

        <section className="space-y-4 rounded-[24px] border border-sky-100 bg-white p-4">
          <div>
            <p className="text-xs font-black tracking-[0.18em] text-sky-700">账户安全</p>
            <h3 className="mt-1 text-lg font-black text-brand-950">账户安全</h3>
            <p className="mt-1 text-sm font-bold leading-6 text-slate-500">邮箱和手机号只在编辑资料中可见；修改邮箱后仍沿用现有验证规则。</p>
          </div>

          {!form.emailVerifiedAt ? (
            <p className="rounded-2xl bg-amber-50 px-4 py-2 text-sm font-black leading-6 text-amber-800">
              建议绑定并验证邮箱，提高账户安全性。未验证手机号不能用于找回密码或高风险操作验证。
            </p>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block rounded-2xl border border-sky-100 bg-sky-50/50 p-4">
              <span className="text-sm font-black text-slate-700">邮箱</span>
              <span className="mt-2 block text-sm font-black text-brand-950">{maskEmail(form.email)}</span>
              <span className={`mt-2 inline-flex rounded-full px-3 py-1 text-xs font-black ${form.emailVerifiedAt ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                {form.email ? (form.emailVerifiedAt ? '已验证' : '未验证') : '未绑定'}
              </span>
              <input
                value={form.email}
                onChange={(event) => update('email', event.target.value)}
                type="email"
                className="mt-3 w-full rounded-xl border border-sky-100 bg-white px-4 py-2 text-sm font-bold outline-none"
                placeholder={form.email ? '更换邮箱' : '绑定邮箱'}
              />
            </label>

            <label className="block rounded-2xl border border-sky-100 bg-sky-50/50 p-4">
              <span className="text-sm font-black text-slate-700">手机号</span>
              <span className="mt-2 block text-sm font-black text-brand-950">{maskPhone(form.phone)}</span>
              <span className="mt-2 inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-black text-slate-500">
                {form.phone ? (form.phoneVerifiedAt ? '已验证' : '未验证，仅作为已绑定登录标识') : '未绑定'}
              </span>
              <input
                value={form.phone}
                onChange={(event) => update('phone', event.target.value)}
                type="tel"
                className="mt-3 w-full rounded-xl border border-sky-100 bg-white px-4 py-2 text-sm font-bold outline-none"
                placeholder={form.phone ? '更换手机号' : '绑定手机号'}
              />
            </label>
          </div>
        </section>

        {message ? <p className="rounded-2xl bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700">{message}</p> : null}
        {error ? <p className="rounded-2xl bg-red-50 px-4 py-2 text-sm font-black text-red-600">{error}</p> : null}

        <div className="profile-settings-actions sticky bottom-0 -mx-6 -mb-6 flex gap-3 border-t border-sky-100 bg-white/95 p-4 backdrop-blur">
          {onCancel ? (
            <button type="button" onClick={onCancel} disabled={isSaving || uploading !== null} className="flex-1 rounded-2xl bg-sky-50 px-5 py-3 text-sm font-black text-brand-700 transition hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-60">
              取消
            </button>
          ) : null}
          <button disabled={isSaving || uploading !== null} className="flex-1 rounded-2xl bg-brand-950 px-5 py-3 text-sm font-black text-white transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-60">
            {isSaving ? '保存中...' : '保存资料'}
          </button>
        </div>
      </form>

      {crop ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 px-4">
          <section className="w-full max-w-md rounded-[28px] bg-white p-5 shadow-2xl">
            <h3 className="text-xl font-black text-brand-950">调整头像</h3>
            <p className="mt-1 text-sm font-bold text-slate-500">拖动图片调整位置，使用滑块缩放。</p>
            <div
              className="relative mx-auto mt-5 h-72 w-72 touch-none overflow-hidden rounded-full bg-sky-50"
              onPointerDown={onCropPointerDown}
              onPointerMove={onCropPointerMove}
              onPointerUp={onCropPointerUp}
            >
              <img
                src={crop.url}
                alt="头像裁剪"
                className="absolute left-1/2 top-1/2 max-w-none select-none"
                style={{
                  width: `${100 * crop.scale}%`,
                  transform: `translate(calc(-50% + ${crop.x / 2}px), calc(-50% + ${crop.y / 2}px))`,
                }}
                draggable={false}
              />
              <div className="pointer-events-none absolute inset-0 rounded-full ring-4 ring-white/80" />
            </div>
            <label className="mt-5 block">
              <span className="text-sm font-black text-slate-700">缩放</span>
              <input
                type="range"
                min="1"
                max="3"
                step="0.01"
                value={crop.scale}
                onChange={(event) => setCrop({ ...crop, scale: Number(event.target.value) })}
                className="mt-2 w-full"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={resetCrop} className="rounded-full bg-sky-50 px-5 py-2 text-sm font-black text-brand-700">取消</button>
              <button type="button" onClick={confirmAvatarUpload} disabled={uploading === 'avatar'} className="rounded-full bg-brand-950 px-5 py-2 text-sm font-black text-white disabled:opacity-60">
                {uploading === 'avatar' ? '上传中...' : '使用此头像'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}
