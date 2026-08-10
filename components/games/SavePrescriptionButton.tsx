'use client'

import { useState } from 'react'

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

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('PRESCRIPTION_IMAGE_CREATE_FAILED'))
    }, 'image/png')
  })
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function isMobileBrowser() {
  const userAgent = navigator.userAgent
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

async function savePrescriptionImage(data: PrescriptionImageData) {
  if (document.fonts?.ready) await document.fonts.ready

  const theme = readWebsiteTheme()
  const canvas = drawPrescriptionCanvas(data, readPalette(theme))
  const blob = await canvasToBlob(canvas)
  const filename = `私家E院-每日处方-${data.dateKey}.png`

  if (isMobileBrowser() && typeof navigator.share === 'function') {
    try {
      const file = new File([blob], filename, { type: 'image/png' })
      const canShareFile = typeof navigator.canShare !== 'function'
        || navigator.canShare({ files: [file] })
      if (canShareFile) {
        await navigator.share({
          files: [file],
          title: '今日处方',
          text: '私家E院 · 今日处方',
        })
        return 'shared' as const
      }
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return 'cancelled' as const
    }
  }

  downloadBlob(blob, filename)
  return 'downloaded' as const
}

export function SavePrescriptionButton({ data }: { data: PrescriptionImageData }) {
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  async function handleSave() {
    if (saving) return
    setSaving(true)
    setMessage('')
    try {
      const result = await savePrescriptionImage(data)
      setMessage(result === 'shared' ? '已打开分享面板' : result === 'cancelled' ? '已取消分享' : '图片已下载')
    } catch {
      setMessage('保存失败，请重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <span className="prescription-save-action">
      <button type="button" className="prescription-save-button" onClick={() => void handleSave()} disabled={saving}>
        {saving ? '生成中…' : '保存处方'}
      </button>
      {message ? <span className="prescription-save-message" role="status">{message}</span> : null}
    </span>
  )
}
