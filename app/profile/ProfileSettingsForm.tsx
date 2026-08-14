'use client'

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type PointerEvent } from 'react'
import { useRouter } from 'next/navigation'
import { InternationalPhoneInput } from '@/components/InternationalPhoneInput'
import { SafeAvatar } from '@/components/SafeAvatar'
import { UserLocationPicker } from '@/components/UserLocationPicker'
import { profileImageUrl } from '@/lib/images'
import { validateLoginAccountValue } from '@/lib/login-account'
import { getPhoneInputParts, normalizePhoneNumber, type PhoneCountryCode } from '@/lib/phone-number'
import type { UserLocation } from '@/lib/user-location'

type InitialProfile = {
  username: string
  usernameChange: {
    lastChangedAt: string | null
    nextAllowedAt: string | null
    canChange: boolean
  }
  nickname: string
  avatarUrl: string
  defaultAvatarOptions: Array<{ id: string; url: string }>
  backgroundUrl: string
  bio: string
  location: UserLocation | null
  email: string
  phone: string
  emailVerifiedAt: string | null
  phoneVerifiedAt: string | null
  wallVisibility: ProfileWallVisibility
  birthMonth: number | null
  birthDay: number | null
  birthdaySetAt: string | null
}

type UploadKind = 'avatar' | 'background'
type ProfileWallVisibility = 'PUBLIC' | 'FRIENDS' | 'CLOSED'

type CropState = {
  file: File
  url: string
  scale: number
  x: number
  y: number
  naturalWidth?: number
  naturalHeight?: number
}

const maxAvatarSourceSize = 10 * 1024 * 1024
const allowedAvatarTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
const allowedAvatarExtensions = new Set(['jpg', 'jpeg', 'png', 'webp'])
const unsupportedAvatarExtensions = new Set(['heic', 'heif'])
const avatarProcessTimeoutMs = 12000
const avatarUploadTimeoutMs = 30000

const maxBackgroundSourceSize = 10 * 1024 * 1024
const backgroundUploadTimeoutMs = 30000
const BACKGROUND_MAX_WIDTH = 1920
const BACKGROUND_TARGET_ASPECT = 4.5
// 裁剪弹窗的固定像素尺寸（9:2 = 4.5:1），导出时按相同比例放大，保证预览与导出区域完全一致。
const BACKGROUND_FRAME_WIDTH = 450
const BACKGROUND_FRAME_HEIGHT = 100

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
  const normalized = normalizePhoneNumber(phone)
  if (!normalized) return phone
  return `${normalized.dialCode}${normalized.nationalNumber.slice(0, 3)}****${normalized.nationalNumber.slice(-4)}`
}

function maskEmail(email: string) {
  if (!email) return '未绑定'
  return email
}

function daysForMonth(month: number | null): number {
  if (!month || month < 1 || month > 12) return 31
  // 二月返回 29，允许闰年 2 月 29 日生日；由服务端最终校验日期合法性。
  const days = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return days[month - 1]
}

function formatUsernameChangeDate(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''

  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value || ''
  const month = parts.find((part) => part.type === 'month')?.value || ''
  const day = parts.find((part) => part.type === 'day')?.value || ''
  const currentYear = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric' }).format(new Date())
  return `${year === currentYear ? '' : `${year}年`}${month}月${day}日`
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

function computeBackgroundLayout(
  crop: CropState,
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
) {
  // 预览与导出共用的唯一坐标系：
  // 1) 先按 cover 适配（scale=1 时铺满裁剪框，不拉伸变形）；
  // 2) 再按 crop.scale 整体缩放；
  // 3) 最后按 crop.x / crop.y 平移（单位与所在坐标系一致，未乘 scale，避免预览/导出偏移不一致）。
  const baseScale = Math.max(frameWidth / imageWidth, frameHeight / imageHeight)
  const drawWidth = imageWidth * baseScale * crop.scale
  const drawHeight = imageHeight * baseScale * crop.scale
  const translateX = (frameWidth - drawWidth) / 2 + crop.x
  const translateY = (frameHeight - drawHeight) / 2 + crop.y
  return { baseScale, drawWidth, drawHeight, translateX, translateY }
}

async function cropBackgroundToWebp(crop: CropState) {
  const image = await loadImage(crop.url)

  const IW = image.naturalWidth
  const IH = image.naturalHeight

  if (!IW || !IH) {
    throw new Error('图片尺寸异常，请重新选择图片')
  }

  const targetWidth = Math.min(BACKGROUND_MAX_WIDTH, IW)
  const targetHeight = Math.round(targetWidth / BACKGROUND_TARGET_ASPECT)

  // 预览裁剪框固定为 BACKGROUND_FRAME_WIDTH 像素，导出时按相同比例放大到 targetWidth，
  // 保证「预览看到的区域 === 导出保存的区域」。因此 crop.x/y 需同步换算到导出坐标系。
  const factor = targetWidth / BACKGROUND_FRAME_WIDTH
  const canvasCrop: CropState = {
    ...crop,
    x: crop.x * factor,
    y: crop.y * factor,
  }

  const layout = computeBackgroundLayout(canvasCrop, IW, IH, targetWidth, targetHeight)

  const canvas = document.createElement('canvas')
  canvas.width = targetWidth
  canvas.height = targetHeight

  const ctx = canvas.getContext('2d')
  if (!ctx) {
    throw new Error('浏览器暂时无法处理这张图片')
  }

  ctx.drawImage(image, layout.translateX, layout.translateY, layout.drawWidth, layout.drawHeight)

  const output = await canvasToBlobWithFallback(canvas)

  if (!output.blob.size) {
    throw new Error('图片处理失败')
  }

  const extension =
    output.type === 'image/webp'
      ? 'webp'
      : 'jpg'

  return {
    blob: output.blob,
    fileName: `background-${createCompatibleId()}.${extension}`,
  }
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
  const initialPhoneParts = getPhoneInputParts(initialProfile.phone)
  const [phoneCountry, setPhoneCountry] = useState<PhoneCountryCode>(initialPhoneParts.country)
  const [phoneValue, setPhoneValue] = useState(initialPhoneParts.value)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [usernameChange, setUsernameChange] = useState(initialProfile.usernameChange)
  const [usernameDraft, setUsernameDraft] = useState(initialProfile.username)
  const [usernameError, setUsernameError] = useState('')
  const [isEditingUsername, setIsEditingUsername] = useState(false)
  const [showUsernameConfirm, setShowUsernameConfirm] = useState(false)
  const [isSavingUsername, setIsSavingUsername] = useState(false)
  const [uploading, setUploading] = useState<UploadKind | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [crop, setCrop] = useState<CropState | null>(null)
  const [backgroundCrop, setBackgroundCrop] = useState<CropState | null>(null)
  const dragRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null)
  const backgroundDragRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null)
  const mountedRef = useRef(true)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const backgroundInputRef = useRef<HTMLInputElement>(null)
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false)
  const [pendingDefaultAvatarUrl, setPendingDefaultAvatarUrl] = useState<string | null>(null)
  const [backgroundPreview, setBackgroundPreview] = useState(initialProfile.backgroundUrl || '')
  

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

  useEffect(() => {
    return () => {
      if (backgroundCrop?.url) URL.revokeObjectURL(backgroundCrop.url)
    }
  }, [backgroundCrop?.url])

  function update<K extends keyof InitialProfile>(key: K, value: InitialProfile[K]) {
    setForm((current) => ({ ...current, [key]: value }))
  }

  function openDefaultAvatarPicker() {
    const currentUrl = profileImageUrl(form.avatarUrl)
    const currentDefault = initialProfile.defaultAvatarOptions.find((item) => profileImageUrl(item.url) === currentUrl)
    setPendingDefaultAvatarUrl(currentDefault?.url || null)
    setAvatarPickerOpen(true)
  }

  function applyDefaultAvatar() {
    if (!pendingDefaultAvatarUrl) return
    if (crop?.url) resetCrop()
    update('avatarUrl', pendingDefaultAvatarUrl)
    setAvatarPickerOpen(false)
    setMessage('已选择默认头像，点击“保存资料”后生效。')
    setError('')
  }

  function resetCrop() {
    if (crop?.url) URL.revokeObjectURL(crop.url)
    setCrop(null)
    if (avatarInputRef.current) avatarInputRef.current.value = ''
  }

  function resetBackgroundCrop() {
    if (backgroundCrop?.url) URL.revokeObjectURL(backgroundCrop.url)
    setBackgroundCrop(null)
    if (backgroundInputRef.current) backgroundInputRef.current.value = ''
  }

  async function openBackgroundCrop(event: ChangeEvent<HTMLInputElement>) {
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
      setError('背景图仅支持 JPG、PNG 或 WebP。')
      event.target.value = ''
      return
    }

    if (file.size > maxBackgroundSourceSize) {
      setError('原始背景图片不能超过 10MB。')
      event.target.value = ''
      return
    }

    if (backgroundCrop?.url) URL.revokeObjectURL(backgroundCrop.url)
    const objectUrl = URL.createObjectURL(file)
    let naturalWidth: number | undefined
    let naturalHeight: number | undefined
    try {
      const loaded = await loadImage(objectUrl)
      naturalWidth = loaded.naturalWidth
      naturalHeight = loaded.naturalHeight
    } catch {
      // 自然尺寸获取失败时仍允许进入裁剪，导出时再读取。
    }
    setBackgroundCrop({
  file,
  url: objectUrl,
  scale: 1.2,
  x: 0,
  y: 0,
  naturalWidth,
  naturalHeight,
})
  }

  function onBackgroundCropPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (!backgroundCrop) return
    event.currentTarget.setPointerCapture(event.pointerId)
    backgroundDragRef.current = { x: event.clientX, y: event.clientY, startX: backgroundCrop.x, startY: backgroundCrop.y }
  }

  function onBackgroundCropPointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = backgroundDragRef.current
    if (!backgroundCrop || !drag) return
    setBackgroundCrop({ ...backgroundCrop, x: drag.startX + event.clientX - drag.x, y: drag.startY + event.clientY - drag.y })
  }

  function onBackgroundCropPointerUp(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.releasePointerCapture(event.pointerId)
    backgroundDragRef.current = null
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

  async function confirmBackgroundUpload() {
    if (!backgroundCrop || uploading) return
    

    setUploading('background')
    setError('')
    setMessage('')

    try {
      const cropped = await cropBackgroundToWebp(backgroundCrop)
      const body = new FormData()
      body.append('file', cropped.blob, cropped.fileName)
      body.append('kind', 'background')

      const response = await fetchWithTimeout('/api/uploads/profile-image', { method: 'POST', body }, backgroundUploadTimeoutMs)
      const data = await response.json().catch(() => null)
      if (!response.ok) throw new Error(data?.message || '背景图上传失败，请换一张图片再试')
      if (!data?.url) throw new Error('背景图已上传，但服务器没有返回有效地址')

      setForm((current) => ({ ...current, backgroundUrl: data.url }))
      setBackgroundPreview(data.url)
      setMessage('背景图已更新。')
      resetBackgroundCrop()
      router.refresh()
    } catch (uploadError) {
      if (!mountedRef.current) return
      const uploadMessage =
        uploadError instanceof DOMException && uploadError.name === 'AbortError'
          ? '背景图上传超时，请稍后重试'
          : uploadError instanceof TypeError
            ? '网络连接中断，请检查网络后重试'
            : uploadError instanceof Error ? uploadError.message : '背景图上传失败，请稍后重试'
      setError(uploadMessage)
    } finally {
      if (mountedRef.current) setUploading(null)
    }
  }

  function beginUsernameEdit() {
    if (!usernameChange.canChange || isSavingUsername) return
    setUsernameDraft(form.username)
    setUsernameError('')
    setIsEditingUsername(true)
  }

  function cancelUsernameEdit() {
    if (isSavingUsername) return
    setUsernameDraft(form.username)
    setUsernameError('')
    setShowUsernameConfirm(false)
    setIsEditingUsername(false)
  }

  function requestUsernameChange() {
    const validation = validateLoginAccountValue(usernameDraft)
    if (validation.error) {
      setUsernameError(validation.error)
      return
    }
    if (validation.usernameNormalized === validateLoginAccountValue(form.username).usernameNormalized) {
      setUsernameError('新用户名不能与当前用户名相同')
      return
    }
    setUsernameError('')
    setShowUsernameConfirm(true)
  }

  async function confirmUsernameChange() {
    if (isSavingUsername) return

    const validation = validateLoginAccountValue(usernameDraft)
    if (validation.error) {
      setUsernameError(validation.error)
      setShowUsernameConfirm(false)
      return
    }

    setIsSavingUsername(true)
    setUsernameError('')
    try {
      const response = await fetch('/api/users/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newUsername: validation.account }),
      })
      const data = await response.json().catch(() => null)

      if (!response.ok) {
        if (data?.code === 'USERNAME_CHANGE_COOLDOWN' && data?.nextAllowedAt) {
          setUsernameChange((current) => ({
            ...current,
            nextAllowedAt: data.nextAllowedAt,
            canChange: false,
          }))
        }
        setUsernameError(data?.message || '用户名修改失败，请稍后重试')
        return
      }

      const nextUsername = typeof data?.profile?.username === 'string' ? data.profile.username : ''
      const nextUsernameChange = data?.usernameChange
      if (!nextUsername || !nextUsernameChange || typeof nextUsernameChange.canChange !== 'boolean') {
        setUsernameError('用户名已提交，但页面没有收到最新状态，请刷新后确认')
        return
      }

      setForm((current) => ({
        ...current,
        username: nextUsername,
        usernameChange: nextUsernameChange,
      }))
      setUsernameChange(nextUsernameChange)
      setUsernameDraft(nextUsername)
      setIsEditingUsername(false)
      setShowUsernameConfirm(false)
      setMessage('用户名已更新，下次可修改时间为一个月后')
      router.refresh()
    } catch {
      setUsernameError('网络连接中断，用户名未修改，请稍后重试')
    } finally {
      setIsSavingUsername(false)
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const nicknameValidation = form.nickname !== initialProfile.nickname
      ? validateLoginAccountValue(form.nickname)
      : null
    if (nicknameValidation?.error) {
      setError(nicknameValidation.error)
      return
    }
    const rawPhone = phoneValue.trim()
    const normalizedPhone = rawPhone ? normalizePhoneNumber(rawPhone, phoneCountry) : null
    if (rawPhone && !normalizedPhone) {
      setError('手机号格式不正确')
      return
    }
    setIsSaving(true)
    setMessage('')
    setError('')

    const response = await fetch('/api/users/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nickname: form.nickname,
        bio: form.bio,
        location: form.location,
        avatarUrl: form.avatarUrl,
        backgroundUrl: form.backgroundUrl,
        email: form.email,
        phone: normalizedPhone?.e164 || '',
        phoneCountry: normalizedPhone?.country || phoneCountry,
        wallVisibility: form.wallVisibility,
        // 生日仅在未设置时提交；已设置则由服务端忽略。
        ...(form.birthdaySetAt
          ? {}
          : { birthMonth: form.birthMonth, birthDay: form.birthDay }),
      }),
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
        location: data.profile.location || null,
      }))
      const nextPhone = data.profile.phone || ''
      const nextPhoneParts = getPhoneInputParts(nextPhone, phoneCountry)
      setPhoneCountry(nextPhoneParts.country)
      setPhoneValue(nextPhoneParts.value)
    }
    if (typeof CustomEvent === 'function') {
      window.dispatchEvent(new CustomEvent('profile-avatar-updated', {
        detail: { avatarUrl: data?.profile?.avatarUrl || form.avatarUrl },
      }))
    }
    setMessage(data?.emailVerificationSent ? '资料已保存，新邮箱需要查收邮件完成验证。' : data?.nicknameMessage || '资料已保存。')
    router.refresh()
    onSaved?.()
  }

  const avatarPreview = profileImageUrl(form.avatarUrl)

  // 预览裁剪框固定 450×100（9:2），与导出使用完全相同的坐标系，确保「所见即所得」。
  const backgroundLayout = backgroundCrop?.naturalWidth
    ? computeBackgroundLayout(
        backgroundCrop,
        backgroundCrop.naturalWidth,
        backgroundCrop.naturalHeight ?? 0,
        BACKGROUND_FRAME_WIDTH,
        BACKGROUND_FRAME_HEIGHT,
      )
    : null

  return (
    <>
      <form onSubmit={handleSubmit} className="profile-settings-form space-y-5 rounded-[28px] border p-6 shadow-sm">
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

          <div className="grid items-start gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white bg-white/78 p-4">
              <p className="text-sm font-black text-slate-700">头像</p>
              <div className="mt-3 flex items-center gap-4">
                <span className="block h-20 w-20 shrink-0 overflow-hidden rounded-full border-2 border-slate-200 shadow">
                  <SafeAvatar src={avatarPreview} name={form.nickname} className="h-full w-full" textClassName="text-2xl" />
                </span>
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => avatarInputRef.current?.click()} disabled={uploading !== null} className="rounded-xl bg-sky-50 px-4 py-2 text-sm font-black text-brand-950 shadow-sm disabled:cursor-not-allowed disabled:opacity-60">
                      {uploading === 'avatar' ? '上传中...' : '上传头像'}
                    </button>
                    <button type="button" onClick={openDefaultAvatarPicker} disabled={uploading !== null} className="rounded-xl border border-sky-100 bg-white px-4 py-2 text-sm font-black text-brand-700 shadow-sm disabled:cursor-not-allowed disabled:opacity-60">
                      默认头像图库
                    </button>
                  </div>
                  <p className="mt-2 text-xs font-bold leading-5 text-slate-500">自动裁剪为 512 × 512，优先 WebP，原图最大 10MB。</p>
                  <input ref={avatarInputRef} type="file" accept="image/jpeg,image/png,image/webp,.heic,.heif" onChange={openAvatarCrop} className="hidden" />
                </div>
              </div>
              {avatarPickerOpen ? (
                <div className="mt-4 rounded-2xl border border-sky-100 bg-sky-50/55 p-3" role="dialog" aria-label="默认头像图库">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-black text-brand-950">默认头像图库</p>
                      <p className="mt-1 text-xs font-bold text-slate-500">头像来自网站当前启用的默认头像池。</p>
                    </div>
                    <button type="button" onClick={() => setAvatarPickerOpen(false)} className="rounded-full bg-white px-3 py-1.5 text-xs font-black text-slate-500">关闭</button>
                  </div>
                  {initialProfile.defaultAvatarOptions.length ? (
                    <>
                      <div className="mt-3 grid max-h-64 grid-cols-3 gap-2 overflow-y-auto pr-1 sm:grid-cols-4 md:grid-cols-6">
                        {initialProfile.defaultAvatarOptions.map((item) => {
                          const selected = pendingDefaultAvatarUrl === item.url
                          return (
                            <button
                              key={item.id}
                              type="button"
                              aria-pressed={selected}
                              onClick={() => setPendingDefaultAvatarUrl(item.url)}
                              className={`aspect-square overflow-hidden rounded-full border-4 bg-white transition ${selected ? 'border-brand-700 ring-2 ring-brand-200' : 'border-white ring-1 ring-sky-100 hover:border-sky-200'}`}
                            >
                              <SafeAvatar src={profileImageUrl(item.url)} name="默认头像" className="h-full w-full" />
                            </button>
                          )
                        })}
                      </div>
                      <button type="button" onClick={applyDefaultAvatar} disabled={!pendingDefaultAvatarUrl} className="mt-3 min-h-10 w-full rounded-xl bg-brand-950 px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50">
                        使用此头像
                      </button>
                    </>
                  ) : (
                    <p className="mt-3 rounded-xl bg-white px-3 py-3 text-sm font-bold leading-6 text-slate-500">暂无可用默认头像，请联系管理员先补充头像图库。</p>
                  )}
                </div>
              ) : null}
            </div>

            <div className="rounded-2xl border border-white bg-white/78 p-4">
              <p className="text-sm font-black text-slate-700">个人病历背景图</p>
              <div className="mt-3 overflow-hidden rounded-2xl bg-slate-100">
                {backgroundPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={backgroundPreview}
                    alt="当前背景图预览"
                    className="aspect-[16/7] w-full object-cover"
                  />
                ) : (
                  <div className="grid aspect-[16/7] place-items-center bg-gradient-to-r from-sky-100 via-white to-cyan-50 text-sm font-black text-slate-400">
                    背景预览
                  </div>
                )}
              </div>
              <label
                htmlFor="profile-background-upload"
                aria-disabled={uploading !== null}
                className={`mt-3 inline-flex min-h-11 cursor-pointer items-center rounded-xl bg-sky-50 px-4 py-2 text-sm font-black text-brand-950 shadow-sm ${uploading !== null ? 'pointer-events-none opacity-60' : ''}`}
              >
                {uploading === 'background' ? '上传中…' : '上传背景图'}
              </label>
              <p className="mt-2 text-xs font-bold leading-5 text-slate-500">选择后会进入裁切，可拖动位置、缩放调整显示区域，导出为 WebP（宽≤1920px）。</p>
              <input
                id="profile-background-upload"
                ref={backgroundInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                disabled={uploading !== null}
                onChange={openBackgroundCrop}
                className="sr-only"
              />
            </div>
          </div>

          <div className="rounded-2xl border border-sky-100 bg-white/78 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-black text-slate-700">用户名</p>
                <p className="mt-2 break-all text-base font-black text-brand-950" aria-readonly="true">{form.username}</p>
              </div>
              <button
                type="button"
                onClick={beginUsernameEdit}
                disabled={!usernameChange.canChange || isSavingUsername}
                className={`shrink-0 rounded-xl px-4 py-2 text-sm font-black transition ${usernameChange.canChange ? 'bg-sky-100 text-brand-950 hover:bg-sky-200' : 'cursor-not-allowed bg-slate-100 text-slate-400'}`}
              >
                更改用户名
              </button>
            </div>

            {usernameChange.canChange ? (
              <p className="mt-2 text-xs font-bold leading-5 text-slate-500">用户名用于登录，不是昵称。每个月只能修改一次。</p>
            ) : usernameChange.nextAllowedAt ? (
              <p className="mt-2 text-xs font-black leading-5 text-slate-500">下次更名时间为：{formatUsernameChangeDate(usernameChange.nextAllowedAt)}</p>
            ) : null}

            {isEditingUsername ? (
              <div className="mt-4 rounded-2xl border border-sky-100 bg-sky-50/55 p-3">
                <label className="block">
                  <span className="text-xs font-black text-slate-600">新的用户名</span>
                  <input
                    value={usernameDraft}
                    onChange={(event) => {
                      setUsernameDraft(event.target.value)
                      setUsernameError(validateLoginAccountValue(event.target.value).error || '')
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        requestUsernameChange()
                      }
                    }}
                    minLength={2}
                    maxLength={16}
                    autoComplete="off"
                    autoFocus
                    className="mt-2 w-full rounded-xl border border-sky-100 bg-white px-3 py-2 text-sm font-bold outline-none transition focus:border-brand-700"
                    placeholder="请输入新的用户名"
                  />
                </label>
                {usernameError ? <p className="mt-2 text-xs font-black leading-5 text-red-600">{usernameError}</p> : null}
                <div className="mt-3 flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={cancelUsernameEdit} disabled={isSavingUsername} className="rounded-full bg-white px-4 py-2 text-xs font-black text-brand-700 disabled:opacity-60">
                    取消
                  </button>
                  <button type="button" onClick={requestUsernameChange} disabled={isSavingUsername} className="rounded-full bg-brand-950 px-4 py-2 text-xs font-black text-white disabled:opacity-60">
                    确认修改
                  </button>
                </div>
              </div>
            ) : null}
          </div>

          <label className="block">
            <span className="text-sm font-black text-slate-700">昵称</span>
            <input
              value={form.nickname}
              onChange={(event) => {
                update('nickname', event.target.value)
                setError(event.target.value === initialProfile.nickname ? '' : validateLoginAccountValue(event.target.value).error || '')
              }}
              minLength={2}
              maxLength={16}
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

          <label className="block">
            <span className="text-sm font-black text-slate-700">地区</span>
            <UserLocationPicker value={form.location} onChange={(value) => update('location', value)} />
            <span className="mt-2 block text-xs font-bold leading-5 text-slate-500">地区由你自行设置，与系统显示的 IP 属地无关。</span>
          </label>
        </section>

        <section className="space-y-4 rounded-[24px] border border-sky-100 bg-white p-4">
          <div>
            <p className="text-xs font-black tracking-[0.18em] text-sky-700">隐私设置</p>
            <h3 className="mt-1 text-lg font-black text-brand-950">留言墙隐私</h3>
            <p className="mt-1 text-sm font-bold leading-6 text-slate-500">选择谁可以查看你的个人病历留言墙并发布留言。</p>
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

        <section className="space-y-4 rounded-[24px] border border-sky-100 bg-sky-50/45 p-4">
          <div>
            <p className="text-xs font-black tracking-[0.18em] text-sky-700">生日纪念</p>
            <h3 className="mt-1 text-lg font-black text-brand-950">我的生日</h3>
            <p className="mt-1 text-sm font-bold leading-6 text-slate-500">生日仅用于「生日纪念」徽章与今日生日统计，填写后不可修改，不会向其他用户展示具体日期。</p>
          </div>

          {form.birthdaySetAt ? (
            <div className="rounded-2xl border border-white bg-white/78 p-4">
              <p className="text-sm font-black text-slate-700">生日已设置</p>
              <p className="mt-2 text-2xl font-black text-brand-950">{form.birthMonth}月{form.birthDay}日</p>
              <p className="mt-2 text-xs font-bold text-slate-500">已设置，不可再次修改。</p>
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              <label className="block rounded-2xl border border-white bg-white/78 p-4">
                <span className="text-sm font-black text-slate-700">月份</span>
                <select
                  value={form.birthMonth ?? ''}
                  onChange={(event) => update('birthMonth', event.target.value ? Number(event.target.value) : null)}
                  className="mt-3 w-full rounded-xl border border-sky-100 bg-white px-4 py-2 text-sm font-bold outline-none"
                >
                  <option value="">请选择月份</option>
                  {Array.from({ length: 12 }, (_, index) => index + 1).map((month) => (
                    <option key={month} value={month}>{month}月</option>
                  ))}
                </select>
              </label>
              <label className="block rounded-2xl border border-white bg-white/78 p-4">
                <span className="text-sm font-black text-slate-700">日期</span>
                <select
                  value={form.birthDay ?? ''}
                  onChange={(event) => update('birthDay', event.target.value ? Number(event.target.value) : null)}
                  className="mt-3 w-full rounded-xl border border-sky-100 bg-white px-4 py-2 text-sm font-bold outline-none"
                >
                  <option value="">请选择日期</option>
                  {Array.from({ length: daysForMonth(form.birthMonth) }, (_, index) => index + 1).map((day) => (
                    <option key={day} value={day}>{day}日</option>
                  ))}
                </select>
              </label>
            </div>
          )}
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
              <InternationalPhoneInput
                value={phoneValue}
                country={phoneCountry}
                onChange={setPhoneValue}
                onCountryChange={setPhoneCountry}
                disabled={isSaving || uploading !== null}
                placeholder={form.phone ? '更换手机号' : '绑定手机号'}
                inputClassName="mt-3"
              />
            </label>
          </div>
        </section>

        {message ? <p className="rounded-2xl bg-emerald-50 px-4 py-2 text-sm font-black text-emerald-700">{message}</p> : null}
        {error ? <p className="rounded-2xl bg-red-50 px-4 py-2 text-sm font-black text-red-600">{error}</p> : null}

        <div className="profile-settings-actions">
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

      {showUsernameConfirm ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 px-4">
          <section role="dialog" aria-modal="true" aria-labelledby="username-change-confirm-title" className="w-full max-w-sm rounded-[28px] bg-white p-5 shadow-2xl">
            <h3 id="username-change-confirm-title" className="text-xl font-black text-brand-950">确认更改用户名？</h3>
            <p className="mt-3 text-sm font-bold leading-6 text-slate-600">用户名每个月只能修改一次。本次修改成功后，下次需要等待一个月。</p>
            <dl className="mt-4 space-y-2 rounded-2xl bg-sky-50/70 p-3 text-sm">
              <div className="flex gap-3">
                <dt className="shrink-0 font-bold text-slate-500">当前用户名</dt>
                <dd className="min-w-0 break-all font-black text-brand-950">{form.username}</dd>
              </div>
              <div className="flex gap-3">
                <dt className="shrink-0 font-bold text-slate-500">新用户名</dt>
                <dd className="min-w-0 break-all font-black text-brand-950">{usernameDraft}</dd>
              </div>
            </dl>
            {usernameError ? <p className="mt-3 text-sm font-black leading-6 text-red-600">{usernameError}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setShowUsernameConfirm(false)} disabled={isSavingUsername} className="rounded-full bg-sky-50 px-5 py-2 text-sm font-black text-brand-700 disabled:opacity-60">
                再想想
              </button>
              <button type="button" onClick={confirmUsernameChange} disabled={isSavingUsername} className="rounded-full bg-brand-950 px-5 py-2 text-sm font-black text-white disabled:opacity-60">
                {isSavingUsername ? '提交中…' : '确认更改'}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {crop ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 px-4">
          <section className="profile-avatar-crop w-full max-w-md rounded-[28px] p-5 shadow-2xl">
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

      {backgroundCrop ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 px-4">
          <section className="profile-background-crop w-full max-w-lg rounded-[28px] p-5 shadow-2xl">
            <h3 className="text-xl font-black text-brand-950">调整背景图</h3>
            <p className="mt-1 text-sm font-bold text-slate-500">拖动图片调整显示区域，使用滑块缩放。建议把人物主体放在画面中央。</p>
            <div
              className="relative mx-auto mt-5 touch-none overflow-hidden rounded-2xl bg-slate-900"
              style={{ width: BACKGROUND_FRAME_WIDTH, height: BACKGROUND_FRAME_HEIGHT }}
              onPointerDown={onBackgroundCropPointerDown}
              onPointerMove={onBackgroundCropPointerMove}
              onPointerUp={onBackgroundCropPointerUp}
            >
              {backgroundLayout ? (
                <div
                  className="absolute left-0 top-0"
                  style={{
                    width: BACKGROUND_FRAME_WIDTH,
                    height: BACKGROUND_FRAME_HEIGHT,
                    backgroundImage: `url(${backgroundCrop.url})`,
                    backgroundRepeat: 'no-repeat',
                    backgroundSize: `${backgroundLayout.drawWidth}px ${backgroundLayout.drawHeight}px`,
                    backgroundPosition: `${backgroundLayout.translateX}px ${backgroundLayout.translateY}px`,
                  }}
                />
              ) : null}
              <div className="pointer-events-none absolute inset-0 ring-2 ring-white/70" />
            </div>
            <label className="mt-5 block">
              <span className="text-sm font-black text-slate-700">缩放</span>
              <input
                type="range"
                min="1"
                max="3"
                step="0.01"
                value={backgroundCrop.scale}
                onChange={(event) => setBackgroundCrop({ ...backgroundCrop, scale: Number(event.target.value) })}
                className="mt-2 w-full"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={resetBackgroundCrop} className="rounded-full bg-sky-50 px-5 py-2 text-sm font-black text-brand-700">取消</button>
              <button type="button" onClick={confirmBackgroundUpload} disabled={uploading === 'background'} className="rounded-full bg-brand-950 px-5 py-2 text-sm font-black text-white disabled:opacity-60">
                {uploading === 'background' ? '上传中...' : '使用此背景图'}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  )
}
