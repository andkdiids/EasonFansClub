'use client'

import QRCode from 'qrcode'
import { canonicalShareUrl, createShareCardFilename, sanitizeShareCardText, shareCardQrPayload, shareCardTypeLabel, SHARE_CARD_HEIGHT, SHARE_CARD_MIME_TYPE, SHARE_CARD_WIDTH, type ShareCardData } from '@/lib/share-card'

const FONT_SANS = '"Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif'
const IMAGE_TIMEOUT_MS = 4500
const QR_SIZE = 224
const PUBLIC_IMAGE_ORIGINS = new Set(['https://ecfc.fans', 'https://www.ecfc.fans', 'https://media.ecfc.fans'])

type LoadedImage = HTMLImageElement | null

export type GeneratedShareCardImage = Readonly<{
  blob: Blob
  previewSrc: string
  previewSrcIsObjectUrl: boolean
  fileName: string
  width: typeof SHARE_CARD_WIDTH
  height: typeof SHARE_CARD_HEIGHT
  qrUrl: string
}>

function safePublicImageUrl(value: string | null | undefined) {
  if (!value) return null
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && PUBLIC_IMAGE_ORIGINS.has(parsed.origin) ? parsed.toString() : null
  } catch {
    return null
  }
}

function loadImage(value: string | null | undefined, allowRemoteImages: boolean): Promise<LoadedImage> {
  const imageUrl = allowRemoteImages ? safePublicImageUrl(value) : null
  if (!imageUrl) return Promise.resolve(null)

  return new Promise<LoadedImage>((resolve) => {
    const image = new Image()
    let settled = false
    const finish = (result: LoadedImage) => {
      if (settled) return
      settled = true
      window.clearTimeout(timeoutId)
      resolve(result)
    }
    const timeoutId = window.setTimeout(() => finish(null), IMAGE_TIMEOUT_MS)

    // COS/media gateway must opt into anonymous CORS. If it does not, the
    // export path redraws the poster without remote pixels instead of failing.
    image.crossOrigin = 'anonymous'
    image.referrerPolicy = 'no-referrer'
    image.decoding = 'async'
    image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0 ? image : null)
    image.onerror = () => finish(null)
    image.src = imageUrl
  })
}

function loadDataImage(value: string): Promise<LoadedImage> {
  return new Promise<LoadedImage>((resolve) => {
    const image = new Image()
    image.onload = () => resolve(image.naturalWidth > 0 && image.naturalHeight > 0 ? image : null)
    image.onerror = () => resolve(null)
    image.src = value
  })
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

function drawImageCover(context: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number) {
  const sourceRatio = image.naturalWidth / image.naturalHeight
  const targetRatio = width / height
  let sourceWidth = image.naturalWidth
  let sourceHeight = image.naturalHeight
  let sourceX = 0
  let sourceY = 0
  if (sourceRatio > targetRatio) {
    sourceWidth = image.naturalHeight * targetRatio
    sourceX = (image.naturalWidth - sourceWidth) / 2
  } else {
    sourceHeight = image.naturalWidth / targetRatio
    sourceY = (image.naturalHeight - sourceHeight) / 2
  }
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height)
}

function drawImageContain(context: CanvasRenderingContext2D, image: HTMLImageElement, x: number, y: number, width: number, height: number, padding: number) {
  const scale = Math.min((width - padding * 2) / image.naturalWidth, (height - padding * 2) / image.naturalHeight)
  const drawWidth = image.naturalWidth * scale
  const drawHeight = image.naturalHeight * scale
  context.drawImage(image, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight)
}

function drawDefaultBrandVisual(context: CanvasRenderingContext2D, type: ShareCardData['type']) {
  const gradient = context.createLinearGradient(0, 0, SHARE_CARD_WIDTH, 660)
  gradient.addColorStop(0, '#071523')
  gradient.addColorStop(0.55, '#0d526b')
  gradient.addColorStop(1, '#16845b')
  context.fillStyle = gradient
  context.fillRect(0, 0, SHARE_CARD_WIDTH, 660)

  context.save()
  context.globalAlpha = 0.16
  context.fillStyle = '#ffffff'
  context.beginPath()
  context.arc(160, 150, 180, 0, Math.PI * 2)
  context.fill()
  context.beginPath()
  context.arc(940, 520, 280, 0, Math.PI * 2)
  context.fill()
  context.restore()

  context.fillStyle = '#ffffff'
  context.textAlign = 'left'
  context.font = `800 38px ${FONT_SANS}`
  context.fillText('私家E院', 64, 92)
  context.fillStyle = 'rgba(255,255,255,.76)'
  context.font = `600 24px ${FONT_SANS}`
  context.fillText('Eason Fans Club', 66, 130)
  context.fillStyle = 'rgba(255,255,255,.86)'
  context.font = `700 28px ${FONT_SANS}`
  context.fillText(shareCardTypeLabel(type), 66, 592)
}

function wrapText(context: CanvasRenderingContext2D, value: string, maxWidth: number, maxLines: number) {
  const lines: string[] = []
  let line = ''
  for (const character of Array.from(value.replace(/\s+/g, ' '))) {
    const next = line + character
    if (line && context.measureText(next).width > maxWidth) {
      lines.push(line)
      line = character
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  const visibleLines = lines.slice(0, maxLines)
  if (lines.length > maxLines && visibleLines.length) {
    let last = visibleLines[visibleLines.length - 1]
    while (last && context.measureText(`${last}…`).width > maxWidth) last = last.slice(0, -1)
    visibleLines[visibleLines.length - 1] = `${last}…`
  }
  return visibleLines
}

function drawAvatar(context: CanvasRenderingContext2D, avatar: LoadedImage, name: string, x: number, y: number, size: number) {
  context.save()
  context.beginPath()
  context.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2)
  context.clip()
  if (avatar) {
    const sourceSize = Math.min(avatar.naturalWidth, avatar.naturalHeight)
    context.drawImage(avatar, (avatar.naturalWidth - sourceSize) / 2, (avatar.naturalHeight - sourceSize) / 2, sourceSize, sourceSize, x, y, size, size)
  } else {
    const fallback = name.trim().slice(0, 1) || 'E'
    const gradient = context.createLinearGradient(x, y, x + size, y + size)
    gradient.addColorStop(0, '#0f5f8f')
    gradient.addColorStop(1, '#16845b')
    context.fillStyle = gradient
    context.fillRect(x, y, size, size)
    context.fillStyle = '#ffffff'
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    context.font = `800 ${Math.round(size * 0.4)}px ${FONT_SANS}`
    context.fillText(fallback, x + size / 2, y + size / 2)
  }
  context.restore()
  context.textBaseline = 'alphabetic'
}

async function drawShareCardCanvas(data: ShareCardData, allowRemoteImages: boolean) {
  const [heroImage, avatar] = await Promise.all([
    loadImage(data.image, allowRemoteImages),
    loadImage(data.authorAvatar, allowRemoteImages),
  ])
  const qrUrl = shareCardQrPayload(data.url)
  const qrDataUrl = await QRCode.toDataURL(qrUrl, {
    width: QR_SIZE,
    margin: 2,
    errorCorrectionLevel: 'H',
    color: { dark: '#071523', light: '#ffffff' },
  })
  const qrImage = await loadDataImage(qrDataUrl)
  if (!qrImage) throw new Error('SHARE_CARD_QR_IMAGE_UNAVAILABLE')

  const canvas = document.createElement('canvas')
  canvas.width = SHARE_CARD_WIDTH
  canvas.height = SHARE_CARD_HEIGHT
  const context = canvas.getContext('2d')
  if (!context) throw new Error('SHARE_CARD_CANVAS_CONTEXT_UNAVAILABLE')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.textBaseline = 'alphabetic'

  if (heroImage) {
    context.fillStyle = '#071523'
    context.fillRect(0, 0, SHARE_CARD_WIDTH, 660)
    if (data.type === 'home') drawImageContain(context, heroImage, 0, 0, SHARE_CARD_WIDTH, 660, 100)
    else drawImageCover(context, heroImage, 0, 0, SHARE_CARD_WIDTH, 660)
    const overlay = context.createLinearGradient(0, 320, 0, 660)
    overlay.addColorStop(0, 'rgba(2,8,18,0)')
    overlay.addColorStop(1, 'rgba(2,8,18,.76)')
    context.fillStyle = overlay
    context.fillRect(0, 0, SHARE_CARD_WIDTH, 660)
    context.fillStyle = '#ffffff'
    context.textAlign = 'left'
    context.font = `800 38px ${FONT_SANS}`
    context.fillText('私家E院', 64, 92)
    context.fillStyle = 'rgba(255,255,255,.82)'
    context.font = `600 24px ${FONT_SANS}`
    context.fillText(shareCardTypeLabel(data.type), 66, 130)
    context.fillStyle = '#ffffff'
    context.font = `700 28px ${FONT_SANS}`
    context.fillText(shareCardTypeLabel(data.type), 66, 592)
  } else {
    drawDefaultBrandVisual(context, data.type)
  }

  context.fillStyle = '#f5fbfd'
  context.fillRect(0, 660, SHARE_CARD_WIDTH, SHARE_CARD_HEIGHT - 660)

  const panelX = 56
  const panelY = 570
  const panelWidth = 968
  const panelHeight = 640
  context.save()
  roundedRect(context, panelX, panelY, panelWidth, panelHeight, 26)
  context.fillStyle = 'rgba(255,255,255,.96)'
  context.shadowColor = 'rgba(7,21,35,.14)'
  context.shadowBlur = 32
  context.shadowOffsetY = 10
  context.fill()
  context.restore()

  const title = sanitizeShareCardText(data.title) || shareCardTypeLabel(data.type)
  const description = sanitizeShareCardText(data.description)
  const author = sanitizeShareCardText(data.author) || '私家E院'
  const date = sanitizeShareCardText(data.date)
  const meta = data.meta
    .map((item) => ({ label: sanitizeShareCardText(item.label), value: sanitizeShareCardText(item.value) }))
    .filter((item) => item.label && item.value)
    .slice(0, 3)

  context.textAlign = 'left'
  context.fillStyle = '#0f5f8f'
  context.font = `800 22px ${FONT_SANS}`
  context.fillText(shareCardTypeLabel(data.type), panelX + 48, panelY + 70)

  context.fillStyle = '#102033'
  context.font = `800 56px ${FONT_SANS}`
  const titleLines = wrapText(context, title, panelWidth - 96, 2)
  titleLines.forEach((line, index) => context.fillText(line, panelX + 48, panelY + 145 + index * 72))

  const descriptionY = panelY + 145 + titleLines.length * 72 + 24
  context.fillStyle = '#536779'
  context.font = `500 30px ${FONT_SANS}`
  const descriptionLines = wrapText(context, description || '扫码查看完整内容', panelWidth - 96, 3)
  descriptionLines.forEach((line, index) => context.fillText(line, panelX + 48, descriptionY + index * 42))

  let metaY = descriptionY + descriptionLines.length * 42 + 26
  context.font = `700 25px ${FONT_SANS}`
  for (const item of meta) {
    if (metaY > panelY + panelHeight - 46) break
    context.fillStyle = '#0f5f8f'
    context.fillText(`${item.label}：`, panelX + 48, metaY)
    context.fillStyle = '#536779'
    const labelWidth = context.measureText(`${item.label}：`).width
    const valueLines = wrapText(context, item.value, panelWidth - 96 - labelWidth, 1)
    context.fillText(valueLines[0] || '', panelX + 48 + labelWidth, metaY)
    metaY += 38
  }

  const authorY = 1278
  drawAvatar(context, avatar, author, 60, authorY - 70, 86)
  context.fillStyle = '#102033'
  context.font = `800 30px ${FONT_SANS}`
  context.fillText(author, 172, authorY - 24)
  context.fillStyle = '#7b8b98'
  context.font = `500 22px ${FONT_SANS}`
  context.fillText(date ? `发布于 ${date}` : '来自私家E院', 172, authorY + 14)

  context.fillStyle = '#0f5f8f'
  context.font = `800 26px ${FONT_SANS}`
  context.fillText('扫码查看完整内容', 60, 1390)
  context.fillStyle = '#7b8b98'
  context.font = `600 20px ${FONT_SANS}`
  context.fillText('私家E院 | Eason Fans Club', 60, 1422)

  context.save()
  roundedRect(context, 788, 1160, 232, 232, 22)
  context.fillStyle = '#ffffff'
  context.fill()
  context.drawImage(qrImage, 792, 1164, 224, 224)
  context.restore()

  return { canvas, qrUrl }
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob)
        else reject(new Error('SHARE_CARD_IMAGE_CREATE_FAILED'))
      }, SHARE_CARD_MIME_TYPE)
    } catch (error) {
      reject(error)
    }
  })
}

async function finishImage(canvas: HTMLCanvasElement, data: ShareCardData, qrUrl: string) {
  const blob = await canvasToBlob(canvas)
  if (typeof URL.createObjectURL !== 'function') {
    return {
      blob,
      previewSrc: canvas.toDataURL(SHARE_CARD_MIME_TYPE),
      previewSrcIsObjectUrl: false,
      fileName: createShareCardFilename(data.title),
      width: SHARE_CARD_WIDTH,
      height: SHARE_CARD_HEIGHT,
      qrUrl,
    } satisfies GeneratedShareCardImage
  }
  return {
    blob,
    previewSrc: URL.createObjectURL(blob),
    previewSrcIsObjectUrl: true,
    fileName: createShareCardFilename(data.title),
    width: SHARE_CARD_WIDTH,
    height: SHARE_CARD_HEIGHT,
    qrUrl,
  } satisfies GeneratedShareCardImage
}

/**
 * Render a high-resolution poster, retrying without remote pixels if CORS
 * taints the first canvas. QR data is generated locally and remains present in
 * both passes.
 */
export async function generateShareCardImage(data: ShareCardData) {
  const normalizedData = { ...data, url: canonicalShareUrl(data.url) }
  try {
    const rendered = await drawShareCardCanvas(normalizedData, true)
    return await finishImage(rendered.canvas, normalizedData, rendered.qrUrl)
  } catch (firstError) {
    try {
      const rendered = await drawShareCardCanvas(normalizedData, false)
      return await finishImage(rendered.canvas, normalizedData, rendered.qrUrl)
    } catch {
      throw firstError
    }
  }
}
