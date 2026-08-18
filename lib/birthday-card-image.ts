'use client'

import { publicImageVariantUrl } from '@/lib/image-variants'
import { formatUid } from '@/lib/uid'

export type BirthdayCardImageData = Readonly<{
  nickname: string
  uid: number
  avatarUrl: string | null
  blessing: string
  dateText: string | null
}>

// 4:3 横版，固定比例，保存图片与页面卡片保持一致。
const IMAGE_WIDTH = 1200
const IMAGE_HEIGHT = 900
const FONT_SANS = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif'
const FONT_SERIF = '"Songti SC", "STSong", "SimSun", serif'

// 暖色调色板（与站点明暗主题解耦，保证导出图片始终温暖、精致、适合朋友圈收藏）。
const PALETTE = {
  bgTop: '#FFF7F1',
  bgBottom: '#FFE3EC',
  foreground: '#5A3D3D',
  foregroundMuted: '#A98585',
  accent: '#C2547A',
  accentSoft: 'rgba(194,84,122,0.12)',
  gold: '#D9A441',
}

function avatarFallback(uid: number) {
  return formatUid(uid).slice(0, 1)
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

function drawAvatar(
  context: CanvasRenderingContext2D,
  avatar: HTMLImageElement | null,
  x: number,
  y: number,
  size: number,
  fallback: string,
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
    context.fillStyle = PALETTE.accent
    context.fillRect(x, y, size, size)
    context.fillStyle = '#FFFFFF'
    context.font = `800 ${Math.round(size * 0.38)}px ${FONT_SANS}`
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.fillText(fallback, x + size / 2, y + size / 2)
  }
  context.restore()
  context.textBaseline = 'alphabetic'
}

function loadAvatarImage(url: string | null) {
  if (!url) return Promise.resolve(null)

  const imageUrl = publicImageVariantUrl(url, 'avatar-md')
  if (!imageUrl) return Promise.resolve(null)

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

    // 匿名 CORS：若网关拒绝 CORS 则回退到字母头像，绝不污染画布导致导出失败。
    image.crossOrigin = 'anonymous'
    image.decoding = 'async'
    image.onload = () => finish(image)
    image.onerror = () => finish(null)
    image.src = imageUrl
  })
}

function drawSparkle(context: CanvasRenderingContext2D, x: number, y: number, size: number, color: string) {
  context.save()
  context.fillStyle = color
  context.translate(x, y)
  context.beginPath()
  context.moveTo(0, -size)
  context.lineTo(size * 0.26, -size * 0.26)
  context.lineTo(size, 0)
  context.lineTo(size * 0.26, size * 0.26)
  context.lineTo(0, size)
  context.lineTo(-size * 0.26, size * 0.26)
  context.lineTo(-size, 0)
  context.lineTo(-size * 0.26, -size * 0.26)
  context.closePath()
  context.fill()
  context.restore()
}

function drawDivider(context: CanvasRenderingContext2D, cx: number, y: number) {
  context.save()
  context.strokeStyle = PALETTE.gold
  context.globalAlpha = 0.7
  context.lineWidth = 2
  context.beginPath()
  context.moveTo(cx - 90, y)
  context.lineTo(cx - 16, y)
  context.stroke()
  context.beginPath()
  context.moveTo(cx + 16, y)
  context.lineTo(cx + 90, y)
  context.stroke()
  context.globalAlpha = 1
  context.fillStyle = PALETTE.gold
  context.beginPath()
  context.moveTo(cx, y - 7)
  context.lineTo(cx + 7, y)
  context.lineTo(cx, y + 7)
  context.lineTo(cx - 7, y)
  context.closePath()
  context.fill()
  context.restore()
}

async function drawBirthdayCardCanvas(data: BirthdayCardImageData) {
  const avatar = await loadAvatarImage(data.avatarUrl)
  const canvas = document.createElement('canvas')
  canvas.width = IMAGE_WIDTH
  canvas.height = IMAGE_HEIGHT

  const context = canvas.getContext('2d')
  if (!context) throw new Error('CANVAS_CONTEXT_UNAVAILABLE')

  context.imageSmoothingEnabled = true
  context.textBaseline = 'alphabetic'

  // 背景渐变（即卡片本身，全幅绘制，不含任何页面元素）
  const backgroundGradient = context.createLinearGradient(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT)
  backgroundGradient.addColorStop(0, PALETTE.bgTop)
  backgroundGradient.addColorStop(1, PALETTE.bgBottom)
  context.fillStyle = backgroundGradient
  context.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT)

  // 柔和装饰圆
  context.save()
  context.globalAlpha = 0.5
  context.fillStyle = PALETTE.accentSoft
  context.beginPath()
  context.arc(1080, 120, 150, 0, Math.PI * 2)
  context.fill()
  context.beginPath()
  context.arc(120, 820, 170, 0, Math.PI * 2)
  context.fill()
  context.restore()

  // 星点装饰
  drawSparkle(context, 175, 165, 15, PALETTE.gold)
  drawSparkle(context, 1015, 770, 20, PALETTE.gold)
  drawSparkle(context, 250, 700, 11, PALETTE.accent)
  drawSparkle(context, 960, 250, 13, PALETTE.accent)

  const cx = IMAGE_WIDTH / 2

  // 顶部：🎂 + 生日快乐
  context.textAlign = 'center'
  context.textBaseline = 'alphabetic'
  context.font = `120px ${FONT_SANS}`
  context.fillText('🎂', cx, 188)

  context.fillStyle = PALETTE.accent
  context.font = `800 96px ${FONT_SERIF}`
  context.fillText('生日快乐', cx, 308)

  // 头像（金色描边圆环）
  const radius = 105
  const cy = 445
  context.beginPath()
  context.arc(cx, cy, radius + 8, 0, Math.PI * 2)
  context.fillStyle = PALETTE.gold
  context.fill()
  drawAvatar(context, avatar, cx - radius, cy - radius, radius * 2, avatarFallback(data.uid))

  // 昵称 + E院ID
  context.fillStyle = PALETTE.foreground
  context.font = `800 64px ${FONT_SANS}`
  context.fillText(truncateCanvasText(context, data.nickname, 900), cx, 610)

  context.fillStyle = PALETTE.foregroundMuted
  context.font = `500 30px ${FONT_SANS}`
  context.fillText(`E院ID ${formatUid(data.uid)}`, cx, 650)

  // 生日公开时才展示生日日期
  let dividerY = 692
  if (data.dateText) {
    context.fillStyle = PALETTE.accent
    context.font = `600 30px ${FONT_SANS}`
    context.fillText(`生日 · ${data.dateText}`, cx, 688)
    dividerY = 724
  }

  drawDivider(context, cx, dividerY)

  // 正文祝福
  context.fillStyle = PALETTE.foreground
  context.font = `500 44px ${FONT_SERIF}`
  drawWrappedText(context, data.blessing, cx, dividerY + 56, 1000, 50, 2)

  // 底部品牌
  context.fillStyle = PALETTE.accent
  context.font = `800 38px ${FONT_SERIF}`
  context.fillText('来自 私家E院', cx, 858)
  context.fillStyle = PALETTE.foregroundMuted
  context.font = `500 20px ${FONT_SANS}`
  context.fillText('EasonFansClub', cx, 888)

  return canvas
}

type GeneratedBirthdayCardImage = Readonly<{
  blob: Blob
  previewSrc: string
  previewSrcIsObjectUrl: boolean
}>

function dataUrlToBlob(dataUrl: string) {
  const separatorIndex = dataUrl.indexOf(',')
  if (separatorIndex < 0) throw new Error('BIRTHDAY_CARD_DATA_URL_INVALID')

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
      else reject(new Error('BIRTHDAY_CARD_IMAGE_CREATE_FAILED'))
    }, 'image/png')
  })
}

function isMobileBrowser() {
  const userAgent = navigator.userAgent
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export async function generateBirthdayCardImage(data: BirthdayCardImageData): Promise<GeneratedBirthdayCardImage> {
  const mobile = isMobileBrowser()
  const canvas = await drawBirthdayCardCanvas(data)
  let previewSrc = ''
  let previewSrcIsObjectUrl = false

  try {
    previewSrc = canvas.toDataURL('image/png')
  } catch (error) {
    console.error('[birthday-card-image]', error)
  }

  const blob = mobile && previewSrc ? dataUrlToBlob(previewSrc) : await canvasToBlob(canvas)

  if (!previewSrc) {
    if (typeof URL.createObjectURL !== 'function') throw new Error('BIRTHDAY_CARD_PREVIEW_UNAVAILABLE')
    previewSrc = URL.createObjectURL(blob)
    previewSrcIsObjectUrl = true
  }

  return { blob, previewSrc, previewSrcIsObjectUrl }
}
