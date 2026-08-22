'use client'

import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'
import type { DailyPrescriptionUser } from '@/lib/daily-prescription-types'
import { publicImageVariantUrl } from '@/lib/image-variants'
import { formatUid } from '@/lib/uid'

export type PrescriptionImageData = Readonly<{
  points: number
  prescriptionCode: string
  issuedAtBeijing?: string
  user: DailyPrescriptionUser
  lyric: Readonly<{ text: string; songTitle: string }> | null
}>

type WebsiteTheme = 'day' | 'midnight'

type PrescriptionPalette = {
  background: string
  surface: string
  surfaceElevated: string
  foreground: string
  foregroundMuted: string
  border: string
  borderStrong: string
  accent: string
}

const IMAGE_WIDTH = 1200
const IMAGE_HEIGHT = 600
const FONT_SANS = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif'
const FONT_SERIF = '"Songti SC", "STSong", "SimSun", serif'

function readCssColor(name: string, fallback: string) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function readWebsiteTheme(): WebsiteTheme {
  return document.documentElement.dataset.theme === 'midnight' ? 'midnight' : 'day'
}

function readPalette(theme: WebsiteTheme): PrescriptionPalette {
  const midnight = theme === 'midnight'
  return {
    background: readCssColor('--background', midnight ? '#080b10' : '#f4f6f9'),
    surface: readCssColor('--surface', midnight ? '#0f141b' : '#ffffff'),
    surfaceElevated: readCssColor('--surface-elevated', midnight ? '#171f2a' : '#ffffff'),
    foreground: readCssColor('--foreground', midnight ? '#f5f7fa' : '#111827'),
    foregroundMuted: readCssColor('--foreground-muted', midnight ? '#98a2b3' : '#667085'),
    border: readCssColor('--border', midnight ? 'rgba(255,255,255,.08)' : '#e5e9f0'),
    borderStrong: readCssColor('--border-strong', midnight ? 'rgba(255,255,255,.16)' : '#cfd6df'),
    accent: readCssColor('--success', midnight ? '#50c89b' : '#16845b'),
  }
}

function roundedRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const safeRadius = Math.min(radius, width / 2, height / 2)
  context.beginPath()
  context.moveTo(x + safeRadius, y)
  context.arcTo(x + width, y, x + width, y + height, safeRadius)
  context.arcTo(x + width, y + height, x, y + height, safeRadius)
  context.arcTo(x, y + height, x, y, safeRadius)
  context.arcTo(x, y, x + width, y, safeRadius)
  context.closePath()
}

function drawWrappedText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number,
) {
  const lines: string[] = []
  let line = ''
  const source = text.replace(/\s+/g, ' ')

  for (const character of Array.from(source)) {
    const nextLine = line + character
    if (line && context.measureText(nextLine).width > maxWidth) {
      lines.push(line)
      line = character
    } else {
      line = nextLine
    }
  }
  if (line) lines.push(line)

  const visibleLines = lines.slice(0, maxLines)
  if (lines.length > maxLines && visibleLines.length > 0) {
    let lastLine = visibleLines[visibleLines.length - 1]
    while (lastLine && context.measureText(`${lastLine}…`).width > maxWidth) {
      lastLine = lastLine.slice(0, -1)
    }
    visibleLines[visibleLines.length - 1] = `${lastLine}…`
  }

  visibleLines.forEach((visibleLine, index) => {
    context.fillText(visibleLine, x, y + index * lineHeight)
  })
  return visibleLines.length
}

function truncateCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const value = text.trim() || 'E友'
  if (context.measureText(value).width <= maxWidth) return value

  let result = ''
  for (const character of Array.from(value)) {
    const next = `${result}${character}`
    if (context.measureText(`${next}…`).width > maxWidth) break
    result = next
  }
  return `${result}…`
}

function avatarFallback(uid: number) {
  return formatUid(uid).slice(0, 1)
}

function drawAvatar(
  context: CanvasRenderingContext2D,
  avatar: HTMLImageElement | null,
  x: number,
  y: number,
  size: number,
  fallback: string,
  palette: PrescriptionPalette,
) {
  context.save()
  context.beginPath()
  context.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2)
  context.clip()

  if (avatar && avatar.naturalWidth > 0 && avatar.naturalHeight > 0) {
    const sourceSize = Math.min(avatar.naturalWidth, avatar.naturalHeight)
    const sourceX = (avatar.naturalWidth - sourceSize) / 2
    const sourceY = (avatar.naturalHeight - sourceSize) / 2
    context.drawImage(avatar, sourceX, sourceY, sourceSize, sourceSize, x, y, size, size)
  } else {
    context.fillStyle = palette.accent
    context.fillRect(x, y, size, size)
    context.fillStyle = palette.surface
    context.font = `800 ${Math.round(size * 0.38)}px ${FONT_SANS}`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(fallback, x + size / 2, y + size / 2)
  }
  context.restore()
  context.textBaseline = 'alphabetic'
}

async function loadAvatarImage(url: string | null) {
  if (!url) return null

  const imageUrl = publicImageVariantUrl(url, 'avatar-md')
  if (!imageUrl) return null

  return new Promise<HTMLImageElement | null>((resolve) => {
    const image = new Image()
    let settled = false
    const finish = (result: HTMLImageElement | null) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeoutId)
      resolve(result)
    }
    const timeoutId = window.setTimeout(() => finish(null), 5000)

    // Use the existing public media gateway and anonymous CORS mode. If the
    // gateway rejects CORS, fall back to the deterministic avatar mark instead
    // of ever tainting the canvas and breaking the whole export.
    image.crossOrigin = 'anonymous'
    image.decoding = 'async'
    image.onload = () => finish(image)
    image.onerror = () => finish(null)
    image.src = imageUrl
  })
}

async function drawPrescriptionCanvas(data: PrescriptionImageData, palette: PrescriptionPalette) {
  const avatar = await loadAvatarImage(data.user.avatarUrl)
  const canvas = document.createElement('canvas')
  canvas.width = IMAGE_WIDTH
  canvas.height = IMAGE_HEIGHT

  const context = canvas.getContext('2d')
  if (!context) throw new Error('CANVAS_CONTEXT_UNAVAILABLE')

  context.imageSmoothingEnabled = true
  context.textBaseline = 'alphabetic'

  const backgroundGradient = context.createLinearGradient(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT)
  backgroundGradient.addColorStop(0, palette.background)
  backgroundGradient.addColorStop(1, palette.surface)
  context.fillStyle = backgroundGradient
  context.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT)

  context.save()
  context.globalAlpha = 0.1
  context.fillStyle = palette.accent
  context.beginPath()
  context.arc(1040, 85, 180, 0, Math.PI * 2)
  context.fill()
  context.globalAlpha = 0.06
  context.beginPath()
  context.arc(100, 580, 220, 0, Math.PI * 2)
  context.fill()
  context.restore()

  const cardX = 36
  const cardY = 36
  const cardWidth = IMAGE_WIDTH - cardX * 2
  const cardHeight = IMAGE_HEIGHT - cardY * 2
  roundedRect(context, cardX, cardY, cardWidth, cardHeight, 8)
  context.fillStyle = palette.surfaceElevated
  context.fill()
  context.lineWidth = 2
  context.strokeStyle = palette.borderStrong
  context.stroke()

  const userAvatarSize = 56
  const userAvatarX = 818
  const userAvatarY = 72
  drawAvatar(context, avatar, userAvatarX, userAvatarY, userAvatarSize, avatarFallback(data.user.uid), palette)
  context.textAlign = 'left'
  context.fillStyle = palette.foreground
  context.font = `700 20px ${FONT_SANS}`
  context.fillText(truncateCanvasText(context, data.user.nickname, 230), userAvatarX + userAvatarSize + 16, 100)
  context.fillStyle = palette.foregroundMuted
  context.font = `500 16px ${FONT_SANS}`
  context.fillText(`UID: ${formatUid(data.user.uid)}`, userAvatarX + userAvatarSize + 16, 127)

  context.fillStyle = palette.foreground
  context.font = `600 54px "ECFC-Title", ${FONT_SANS}`
  context.textAlign = 'left'
  context.fillText('今日处方', 80, 136)

  context.strokeStyle = palette.border
  context.lineWidth = 2
  context.beginPath()
  context.moveTo(80, 168)
  context.lineTo(1120, 168)
  context.stroke()

  context.beginPath()
  context.moveTo(540, 224)
  context.lineTo(540, 470)
  context.stroke()

  context.fillStyle = palette.foregroundMuted
  context.font = `800 17px ${FONT_SANS}`
  context.fillText('获得奖励', 80, 292)

  context.fillStyle = palette.accent
  context.font = `800 48px ${FONT_SANS}`
  context.fillText(`+${data.points} 挂号费`, 80, 360)

  context.fillStyle = palette.foregroundMuted
  context.font = `800 17px ${FONT_SANS}`
  context.fillText('今日歌词处方', 600, 250)

  context.fillStyle = palette.foreground
  context.font = `600 30px ${FONT_SERIF}`
  const lyricText = data.lyric?.text ? `“${data.lyric.text}”` : '今日处方暂未开具'
  const lyricLineCount = drawWrappedText(context, lyricText, 600, 306, 450, 42, 3)

  context.fillStyle = palette.foregroundMuted
  context.font = `500 18px ${FONT_SANS}`
  context.textAlign = 'right'
  context.fillText(
    data.lyric?.songTitle ? `《${data.lyric.songTitle}》` : '—',
    1120,
    Math.min(430, 306 + lyricLineCount * 42 + 20),
  )

  context.strokeStyle = palette.border
  context.beginPath()
  context.moveTo(80, 494)
  context.lineTo(1120, 494)
  context.stroke()

  context.textAlign = 'left'
  context.fillStyle = palette.foregroundMuted
  context.font = `500 16px ${FONT_SANS}`
  context.fillText(`处方编号：${data.prescriptionCode}`, 80, 542)
  if (data.issuedAtBeijing) context.fillText(`开具时间：${data.issuedAtBeijing}`, 410, 542)

  context.textAlign = 'right'
  context.fillStyle = palette.accent
  context.font = `800 20px ${FONT_SANS}`
  context.fillText('私家E院', 1120, 532)
  context.fillStyle = palette.foregroundMuted
  context.font = `600 13px ${FONT_SANS}`
  context.fillText('EasonFansClub', 1120, 554)

  return canvas
}

type GeneratedPrescriptionImage = Readonly<{
  blob: Blob
  previewSrc: string
  previewSrcIsObjectUrl: boolean
}>

function dataUrlToBlob(dataUrl: string) {
  const separatorIndex = dataUrl.indexOf(',')
  if (separatorIndex < 0) throw new Error('PRESCRIPTION_DATA_URL_INVALID')

  const header = dataUrl.slice(0, separatorIndex)
  const payload = dataUrl.slice(separatorIndex + 1)
  const mimeType = header.match(/^data:([^;]+);base64$/)?.[1] || 'image/png'
  const binary = atob(payload)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return new Blob([bytes], { type: mimeType })
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('PRESCRIPTION_IMAGE_CREATE_FAILED'))
    }, 'image/png')
  })
}

function isMobileBrowser() {
  const userAgent = navigator.userAgent
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

async function generatePrescriptionImage(data: PrescriptionImageData): Promise<GeneratedPrescriptionImage> {
  const mobile = isMobileBrowser()
  const theme = readWebsiteTheme()
  const canvas = await drawPrescriptionCanvas(data, readPalette(theme))
  let previewSrc = ''
  let previewSrcIsObjectUrl = false

  try {
    // toDataURL is synchronous and keeps the mobile preview independent of object URL support.
    previewSrc = canvas.toDataURL('image/png')
  } catch (error) {
    console.error('[daily-prescription-save]', error)
  }

  const blob = mobile && previewSrc ? dataUrlToBlob(previewSrc) : await canvasToBlob(canvas)

  if (!previewSrc) {
    if (typeof URL.createObjectURL !== 'function') throw new Error('PRESCRIPTION_PREVIEW_UNAVAILABLE')
    previewSrc = URL.createObjectURL(blob)
    previewSrcIsObjectUrl = true
  }

  return { blob, previewSrc, previewSrcIsObjectUrl }
}

export function SavePrescriptionButton({ data }: { data: PrescriptionImageData }) {
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState<GeneratedPrescriptionImage | null>(null)

  useEffect(() => {
    if (!preview) return undefined

    const previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreview(null)
    }
    document.addEventListener('keydown', closeOnEscape)

    return () => {
      document.removeEventListener('keydown', closeOnEscape)
      document.body.style.overflow = previousBodyOverflow
      if (preview.previewSrcIsObjectUrl) URL.revokeObjectURL(preview.previewSrc)
    }
  }, [preview])

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setMessage('正在生成图片…')
    try {
      // Let React paint the loading state before the synchronous mobile canvas work starts.
      await new Promise<void>((resolve) => {
        if (typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(() => resolve())
        else window.setTimeout(resolve, 0)
      })
      const image = await generatePrescriptionImage(data)
      setPreview(image)
      setMessage('图片已生成')
    } catch (error) {
      console.error('[daily-prescription-save]', error)
      setMessage('生成失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  function closePreview() {
    setPreview(null)
  }

  const previewPortal = preview && typeof document !== 'undefined'
    ? createPortal(
      <div
        className="prescription-preview-backdrop"
        role="presentation"
        onClick={(event) => { if (event.target === event.currentTarget) closePreview() }}
      >
        <section className="prescription-preview-dialog" role="dialog" aria-modal="true" aria-labelledby="prescription-preview-title">
          <header className="prescription-preview-header">
            <div>
              <h2 id="prescription-preview-title">处方图片已生成</h2>
            </div>
            <button type="button" className="prescription-preview-close" onClick={closePreview} aria-label="关闭处方图片预览">×</button>
          </header>
          <p className="prescription-preview-hint prescription-preview-hint-desktop">右键点击图片，可复制或保存图片</p>
          <p className="prescription-preview-hint prescription-preview-hint-mobile">长按图片可保存或转发</p>
          <div className="prescription-preview-image-wrap">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.previewSrc} alt="今日处方图片" className="prescription-preview-image" />
          </div>
        </section>
      </div>,
      document.body,
    )
    : null

  return (
    <>
      <span className="prescription-save-action">
        <button
          type="button"
          className="prescription-save-button"
          data-prescription-save-button="true"
          onClick={() => void handleSave()}
          disabled={saving}
          aria-busy={saving}
        >
          {saving ? '正在生成图片…' : '保存处方'}
        </button>
        {message ? <span className="prescription-save-message" role="status">{message}</span> : null}
      </span>
      {previewPortal}
    </>
  )
}
