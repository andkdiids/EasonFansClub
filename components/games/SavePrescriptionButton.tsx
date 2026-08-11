'use client'

import { createPortal } from 'react-dom'
import { useEffect, useState } from 'react'

export type PrescriptionImageData = Readonly<{
  dateKey: string
  points: number
  totalPoints?: number
  prescriptionCode: string
  issuedAtBeijing?: string
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

function drawPrescriptionCanvas(data: PrescriptionImageData, palette: PrescriptionPalette) {
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

  context.fillStyle = palette.accent
  context.font = `700 18px ${FONT_SANS}`
  context.textAlign = 'left'
  context.fillText('BEIJING TIME · DAILY', 80, 94)

  context.fillStyle = palette.foregroundMuted
  context.font = `500 20px ${FONT_SANS}`
  context.textAlign = 'right'
  context.fillText(data.dateKey, 1120, 94)

  context.fillStyle = palette.foreground
  context.font = `600 54px "ECFC-Title", ${FONT_SANS}`
  context.textAlign = 'left'
  context.fillText('今日处方', 80, 166)

  context.strokeStyle = palette.border
  context.lineWidth = 2
  context.beginPath()
  context.moveTo(80, 192)
  context.lineTo(1120, 192)
  context.stroke()

  context.beginPath()
  context.moveTo(540, 224)
  context.lineTo(540, 470)
  context.stroke()

  context.fillStyle = palette.foregroundMuted
  context.font = `800 17px ${FONT_SANS}`
  context.fillText('获得奖励', 80, 250)

  context.fillStyle = palette.accent
  context.font = `800 48px ${FONT_SANS}`
  context.fillText(`+${data.points} 挂号费`, 80, 316)

  if (typeof data.totalPoints === 'number') {
    context.fillStyle = palette.foregroundMuted
    context.font = `500 17px ${FONT_SANS}`
    context.fillText(`当前挂号费 ${data.totalPoints}`, 80, 356)
  }

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

type ShareResult = 'shared' | 'unsupported' | 'cancelled' | 'failed'

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
  const canvas = drawPrescriptionCanvas(data, readPalette(theme))
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

type ShareChannel = 'friend' | 'timeline'

type SharePayload = {
  title: string
  description: string
  link: string
}

type WechatShareConfig = {
  title: string
  desc: string
  link: string
  imgUrl?: string
  success?: () => void
  cancel?: () => void
  fail?: () => void
}

type WechatShareApi = {
  ready?: (callback: () => void) => void
  updateAppMessageShareData?: (config: WechatShareConfig) => void
  updateTimelineShareData?: (config: WechatShareConfig) => void
  onMenuShareAppMessage?: (config: WechatShareConfig) => void
  onMenuShareTimeline?: (config: WechatShareConfig) => void
}

function getPrescriptionSharePayload(data: PrescriptionImageData): SharePayload {
  const link = typeof window === 'undefined' ? '' : window.location.href
  return {
    title: `私家E院 · ${data.dateKey} 每日处方`,
    description: data.lyric?.text
      ? `今日歌词处方：${data.lyric.text}`
      : '打开私家E院查看今日处方',
    link,
  }
}

function getWechatShareApi() {
  if (typeof window === 'undefined') return null
  const candidate = (window as Window & { wx?: unknown }).wx
  return candidate && typeof candidate === 'object' ? candidate as WechatShareApi : null
}

function configureWechatShare(channel: ShareChannel, payload: SharePayload) {
  const wx = getWechatShareApi()
  if (!wx) return false

  const method = channel === 'friend'
    ? wx.updateAppMessageShareData || wx.onMenuShareAppMessage
    : wx.updateTimelineShareData || wx.onMenuShareTimeline
  if (typeof method !== 'function') return false

  const configure = () => {
    try {
      method.call(wx, {
        title: payload.title,
        desc: payload.description,
        link: payload.link,
      })
    } catch (error) {
      console.error('[daily-prescription-share][wechat]', error)
    }
  }

  try {
    if (typeof wx.ready === 'function') wx.ready(configure)
    else configure()
    return true
  } catch (error) {
    console.error('[daily-prescription-share][wechat]', error)
    return false
  }
}

async function copyShareLink(link: string) {
  if (!link) return false
  if (typeof navigator.clipboard?.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(link)
      return true
    } catch {
      // Use the textarea fallback below for older mobile browsers and WebViews.
    }
  }

  const textarea = document.createElement('textarea')
  textarea.value = link
  textarea.setAttribute('readonly', 'true')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    textarea.remove()
  }
}

async function tryBrowserShare(payload: SharePayload): Promise<ShareResult> {
  if (typeof navigator.share !== 'function') return 'unsupported'

  try {
    await navigator.share({ title: payload.title, text: payload.description, url: payload.link })
    return 'shared'
  } catch (reason) {
    if (reason instanceof DOMException && reason.name === 'AbortError') return 'cancelled'
    console.error('[daily-prescription-share]', reason)
    return 'failed'
  }
}

export function SavePrescriptionButton({ data }: { data: PrescriptionImageData }) {
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState<GeneratedPrescriptionImage | null>(null)
  const [previewMessage, setPreviewMessage] = useState('')
  const [shareMenuOpen, setShareMenuOpen] = useState(false)
  const [sharing, setSharing] = useState(false)

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
      setShareMenuOpen(false)
      setPreviewMessage('图片已生成，可长按图片保存')
      setMessage('图片已生成')
    } catch (error) {
      console.error('[daily-prescription-save]', error)
      setMessage('生成失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  function handlePreviewShare() {
    if (!preview || sharing) return
    setShareMenuOpen((value) => !value)
    setPreviewMessage('')
  }

  async function handleShareChannel(channel: ShareChannel) {
    if (!preview || sharing) return
    setSharing(true)
    setShareMenuOpen(false)
    const payload = getPrescriptionSharePayload(data)
    const configuredWechatShare = configureWechatShare(channel, payload)
    if (configuredWechatShare) {
      setPreviewMessage(channel === 'friend'
        ? '分享内容已准备好，请点击右上角 ··· 发送给朋友'
        : '分享内容已准备好，请点击右上角 ··· 分享到朋友圈')
      setSharing(false)
      return
    }

    const isWechat = /MicroMessenger/i.test(navigator.userAgent)
    if (channel === 'friend' && !isWechat) {
      const result = await tryBrowserShare(payload)
      if (result === 'shared') setPreviewMessage('已打开系统分享面板')
      else if (result === 'cancelled') setPreviewMessage('已取消分享')
      else if (result === 'failed') setPreviewMessage('分享未完成，请稍后重试或复制链接')
      else if (await copyShareLink(payload.link)) setPreviewMessage('当前浏览器不支持直接分享，链接已复制，可粘贴发送给好友')
      else setPreviewMessage('当前浏览器不支持直接分享，请复制当前页面链接发送给好友')
      setSharing(false)
      return
    }

    const copied = await copyShareLink(payload.link)
    if (copied) {
      setPreviewMessage(channel === 'timeline'
        ? '当前浏览器不支持朋友圈直达，链接已复制，请点击右上角 ··· 分享到朋友圈'
        : '微信分享接口暂未配置，链接已复制，请点击右上角 ··· 发送给朋友')
    } else {
      setPreviewMessage(channel === 'timeline'
        ? '请点击右上角 ··· 分享到朋友圈'
        : '请点击右上角 ··· 发送给朋友')
    }
    setSharing(false)
  }

  function closePreview() {
    setPreview(null)
    setPreviewMessage('')
    setShareMenuOpen(false)
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
              <p>DAILY PRESCRIPTION</p>
              <h2 id="prescription-preview-title">处方图片已生成</h2>
            </div>
            <button type="button" className="prescription-preview-close" onClick={closePreview} aria-label="关闭处方图片预览">×</button>
          </header>
          <p className="prescription-preview-hint">长按图片即可保存到手机相册</p>
          <div className="prescription-preview-image-wrap">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview.previewSrc} alt="今日处方图片" className="prescription-preview-image" />
          </div>
          <p className="prescription-preview-message" role="status">{previewMessage}</p>
          <div className="prescription-preview-actions">
            <button type="button" className="prescription-preview-share" onClick={() => void handlePreviewShare()}>分享处方</button>
            <button type="button" className="prescription-preview-dismiss" onClick={closePreview}>关闭</button>
          </div>
          {shareMenuOpen ? (
            <div className="prescription-share-menu" role="group" aria-label="选择分享方式">
              <p>分享处方</p>
              <button type="button" onClick={() => void handleShareChannel('friend')} disabled={sharing}>分享给好友</button>
              <button type="button" onClick={() => void handleShareChannel('timeline')} disabled={sharing}>分享到朋友圈</button>
              <button type="button" className="prescription-share-menu-cancel" onClick={() => setShareMenuOpen(false)} disabled={sharing}>取消</button>
            </div>
          ) : null}
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
