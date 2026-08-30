'use client'

import { publicImageUrl } from '@/lib/images'
import { drawBrandedQrToCanvas } from '@/lib/branded-qr-client'
import { shareCardEmojiAssetUrl, tokenizeShareCardText } from '@/lib/share-card-emoji'
import { canonicalShareUrl, createShareCardFilename, shareCardQrPayload, shareCardTypeLabel, isTrustedShareCardHttpsUrl, SHARE_CARD_LOGO_PATH, SHARE_CARD_MIME_TYPE, SHARE_CARD_WIDTH, type ShareCardData } from '@/lib/share-card'
import {
  calculateShareCardLayout,
  shareCardHeroFit,
  SHARE_CARD_AUTHOR_FONT_SIZE,
  SHARE_CARD_AUTHOR_LINE_HEIGHT,
  SHARE_CARD_AUTHOR_X,
  SHARE_CARD_AVATAR_SIZE,
  SHARE_CARD_AVATAR_X,
  SHARE_CARD_CATEGORY_FONT_SIZE,
  SHARE_CARD_DATE_FONT_SIZE,
  SHARE_CARD_DATE_LINE_HEIGHT,
  SHARE_CARD_DESCRIPTION_FONT_SIZE,
  SHARE_CARD_DESCRIPTION_LINE_HEIGHT,
  SHARE_CARD_FOOTER_LOGO_SIZE,
  SHARE_CARD_FOOTER_LOGO_X,
  SHARE_CARD_FOOTER_BRAND_FONT_SIZE,
  SHARE_CARD_FOOTER_TEXT_GAP,
  SHARE_CARD_FOOTER_TITLE_FONT_SIZE,
  SHARE_CARD_FOOTER_TITLE_LINE_HEIGHT,
  SHARE_CARD_FOOTER_TEXT_X,
  SHARE_CARD_META_FONT_SIZE,
  SHARE_CARD_META_LINE_HEIGHT,
  SHARE_CARD_PANEL_PADDING_X,
  SHARE_CARD_QR_FRAME_SIZE,
  SHARE_CARD_QR_FRAME_X,
  SHARE_CARD_QR_SIZE,
  SHARE_CARD_QR_X,
  SHARE_CARD_TITLE_FONT_SIZE,
  SHARE_CARD_TITLE_LINE_HEIGHT,
} from '@/lib/share-card-layout'

const FONT_SANS = '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif'
const IMAGE_TIMEOUT_MS = 4500
const VIDEO_FILE_PATTERN = /\.(?:3gp|avi|flv|m4v|mkv|mov|mp4|mpeg|mpg|ogm|ogv|webm|wmv|m3u8)$/i
const SHARE_CARD_DATA_URL_PREFIX = `data:${SHARE_CARD_MIME_TYPE};base64,`

type LoadedImage = HTMLImageElement | null

export type GeneratedShareCardImage = Readonly<{
  source: 'local' | 'remote'
  blob: Blob | null
  previewSrc: string
  fileName: string
  width: typeof SHARE_CARD_WIDTH
  height: number
  qrUrl: string
}>

function safePublicImageUrl(value: string | null | undefined) {
  const publicValue = publicImageUrl(value)
  if (!publicValue) return null
  try {
    const parsed = new URL(publicValue, 'https://ecfc.fans')
    return parsed.protocol === 'https:' && isTrustedShareCardHttpsUrl(parsed.toString()) && !VIDEO_FILE_PATTERN.test(parsed.pathname)
      ? parsed.toString()
      : null
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

async function loadFirstImage(values: readonly (string | null | undefined)[], allowRemoteImages: boolean) {
  const seen = new Set<string>()
  for (const value of values) {
    if (!value || seen.has(value)) continue
    seen.add(value)
    const image = await loadImage(value, allowRemoteImages)
    if (image) return image
  }
  return null
}

function loadLocalImage(value: string): Promise<LoadedImage> {
  return new Promise<LoadedImage>((resolve) => {
    const image = new Image()
    image.onload = () => resolve(image.naturalWidth > 0 && image.naturalHeight > 0 ? image : null)
    image.onerror = () => resolve(null)
    image.src = value
  })
}

function loadEmojiImage(codePoint: string): Promise<LoadedImage> {
  const imageUrl = shareCardEmojiAssetUrl(codePoint)
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
    image.crossOrigin = 'anonymous'
    image.referrerPolicy = 'no-referrer'
    image.decoding = 'async'
    image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0 ? image : null)
    image.onerror = () => finish(null)
    image.src = imageUrl
  })
}

async function loadShareCardEmojiImages(values: readonly string[]) {
  const codePoints = new Set<string>()
  values.forEach((value) => tokenizeShareCardText(value).forEach((token) => {
    if (token.type === 'emoji' && token.codePoint) codePoints.add(token.codePoint)
  }))
  const entries = await Promise.all(Array.from(codePoints).map(async (codePoint) => [codePoint, await loadEmojiImage(codePoint)] as const))
  return new Map(entries)
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
  } else if (sourceRatio < targetRatio) {
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

function drawDefaultBrandVisual(context: CanvasRenderingContext2D, height: number) {
  const gradient = context.createLinearGradient(0, 0, SHARE_CARD_WIDTH, height)
  gradient.addColorStop(0, '#071523')
  gradient.addColorStop(0.55, '#0d526b')
  gradient.addColorStop(1, '#16845b')
  context.fillStyle = gradient
  context.fillRect(0, 0, SHARE_CARD_WIDTH, height)

  context.save()
  context.globalAlpha = 0.16
  context.fillStyle = '#ffffff'
  context.beginPath()
  context.arc(160, 150, 180, 0, Math.PI * 2)
  context.fill()
  context.beginPath()
  context.arc(940, Math.max(420, height - 140), 280, 0, Math.PI * 2)
  context.fill()
  context.restore()
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

function drawShareCardTextLine(context: CanvasRenderingContext2D, value: string, x: number, baseline: number, font: string, fontSize: number, emojiImages: ReadonlyMap<string, HTMLImageElement | null>) {
  context.font = font
  let left = x
  for (const token of tokenizeShareCardText(value)) {
    if (token.type === 'text') {
      context.fillText(token.value, left, baseline)
      left += context.measureText(token.value).width
      continue
    }
    const size = Math.max(1, Math.round(fontSize * 0.98))
    const image = token.codePoint ? emojiImages.get(token.codePoint) : null
    if (image) {
      context.drawImage(image, left, baseline - Math.round(size * 0.84), size, size)
    } else {
      // Keep the original token when the pinned image cannot be reached; this
      // is preferable to silently stripping a user's Emoji from the card.
      context.fillText(token.value, left, baseline)
    }
    left += size
  }
}

async function drawShareCardCanvas(data: ShareCardData, allowRemoteImages: boolean) {
  const [heroImage, avatar, logo] = await Promise.all([
    loadFirstImage([data.image, ...(data.imageCandidates || []).map((candidate) => candidate.url)], allowRemoteImages),
    loadImage(data.authorAvatar, allowRemoteImages),
    loadLocalImage(SHARE_CARD_LOGO_PATH),
  ])
  const dimensions = heroImage ? { width: heroImage.naturalWidth, height: heroImage.naturalHeight } : null
  const layout = calculateShareCardLayout(data, dimensions)
  const qrUrl = shareCardQrPayload(data.url)
  const qrCanvas = document.createElement('canvas')
  const textValues = [
    shareCardTypeLabel(data.type),
    ...layout.titleLines,
    ...layout.descriptionLines,
    ...layout.metaLines,
    ...layout.authorLines,
    ...layout.dateLines,
    '扫码查看完整内容',
    '私家E院 | Eason Fans Club',
  ]
  const [emojiImages] = await Promise.all([
    loadShareCardEmojiImages(textValues),
    drawBrandedQrToCanvas(qrCanvas, qrUrl, SHARE_CARD_QR_SIZE),
  ])

  const canvas = document.createElement('canvas')
  canvas.width = SHARE_CARD_WIDTH
  canvas.height = layout.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('SHARE_CARD_CANVAS_CONTEXT_UNAVAILABLE')
  context.imageSmoothingEnabled = true
  context.imageSmoothingQuality = 'high'
  context.textBaseline = 'alphabetic'

  if (heroImage) {
    context.fillStyle = '#071523'
    context.fillRect(0, 0, SHARE_CARD_WIDTH, layout.heroHeight)
    if (shareCardHeroFit(data.type) === 'contain') drawImageContain(context, heroImage, 0, 0, SHARE_CARD_WIDTH, layout.heroHeight, 100)
    else drawImageCover(context, heroImage, 0, 0, SHARE_CARD_WIDTH, layout.heroHeight)
    const overlay = context.createLinearGradient(0, layout.heroHeight * 0.48, 0, layout.heroHeight)
    overlay.addColorStop(0, 'rgba(2,8,18,0)')
    overlay.addColorStop(1, 'rgba(2,8,18,.76)')
    context.fillStyle = overlay
    context.fillRect(0, 0, SHARE_CARD_WIDTH, layout.heroHeight)
  } else {
    drawDefaultBrandVisual(context, layout.heroHeight)
  }

  context.fillStyle = '#f5fbfd'
  context.fillRect(0, layout.heroHeight, SHARE_CARD_WIDTH, layout.height - layout.heroHeight)
  context.fillStyle = 'rgba(20,30,35,.72)'
  context.fillRect(0, layout.overlayTop, SHARE_CARD_WIDTH, layout.overlayHeight)
  context.fillStyle = 'rgba(255,255,255,.12)'
  context.fillRect(0, layout.overlayTop, SHARE_CARD_WIDTH, 2)

  const contentLeft = SHARE_CARD_PANEL_PADDING_X
  context.textAlign = 'left'
  context.fillStyle = '#d5f1f4'
  context.font = `800 ${SHARE_CARD_CATEGORY_FONT_SIZE}px ${FONT_SANS}`
  drawShareCardTextLine(context, shareCardTypeLabel(data.type), contentLeft, layout.categoryTop + 24, `800 ${SHARE_CARD_CATEGORY_FONT_SIZE}px ${FONT_SANS}`, SHARE_CARD_CATEGORY_FONT_SIZE, emojiImages)

  context.fillStyle = '#ffffff'
  context.font = `800 ${SHARE_CARD_TITLE_FONT_SIZE}px ${FONT_SANS}`
  layout.titleLines.forEach((line, index) => drawShareCardTextLine(context, line, contentLeft, layout.titleTop + SHARE_CARD_TITLE_FONT_SIZE + index * SHARE_CARD_TITLE_LINE_HEIGHT, `800 ${SHARE_CARD_TITLE_FONT_SIZE}px ${FONT_SANS}`, SHARE_CARD_TITLE_FONT_SIZE, emojiImages))

  context.fillStyle = '#f0f6f7'
  context.font = `500 ${SHARE_CARD_DESCRIPTION_FONT_SIZE}px ${FONT_SANS}`
  layout.descriptionLines.forEach((line, index) => drawShareCardTextLine(context, line, contentLeft, layout.descriptionTop + SHARE_CARD_DESCRIPTION_FONT_SIZE + index * SHARE_CARD_DESCRIPTION_LINE_HEIGHT, `500 ${SHARE_CARD_DESCRIPTION_FONT_SIZE}px ${FONT_SANS}`, SHARE_CARD_DESCRIPTION_FONT_SIZE, emojiImages))

  context.font = `700 ${SHARE_CARD_META_FONT_SIZE}px ${FONT_SANS}`
  layout.metaLines.forEach((line, index) => drawShareCardTextLine(context, line, contentLeft, layout.metaTop + SHARE_CARD_META_FONT_SIZE + index * SHARE_CARD_META_LINE_HEIGHT, `700 ${SHARE_CARD_META_FONT_SIZE}px ${FONT_SANS}`, SHARE_CARD_META_FONT_SIZE, emojiImages))

  drawAvatar(context, avatar, layout.author, SHARE_CARD_AVATAR_X, layout.authorTop, SHARE_CARD_AVATAR_SIZE)
  context.fillStyle = '#102033'
  context.font = `800 ${SHARE_CARD_AUTHOR_FONT_SIZE}px ${FONT_SANS}`
  layout.authorLines.forEach((line, index) => drawShareCardTextLine(context, line, SHARE_CARD_AUTHOR_X, layout.authorTextTop + SHARE_CARD_AUTHOR_FONT_SIZE + index * SHARE_CARD_AUTHOR_LINE_HEIGHT, `800 ${SHARE_CARD_AUTHOR_FONT_SIZE}px ${FONT_SANS}`, SHARE_CARD_AUTHOR_FONT_SIZE, emojiImages))
  context.fillStyle = '#7b8b98'
  context.font = `500 ${SHARE_CARD_DATE_FONT_SIZE}px ${FONT_SANS}`
  layout.dateLines.forEach((line, index) => drawShareCardTextLine(context, line, SHARE_CARD_AUTHOR_X, layout.dateTop + SHARE_CARD_DATE_FONT_SIZE + index * SHARE_CARD_DATE_LINE_HEIGHT, `500 ${SHARE_CARD_DATE_FONT_SIZE}px ${FONT_SANS}`, SHARE_CARD_DATE_FONT_SIZE, emojiImages))

  context.fillStyle = '#0f5f8f'
  context.font = `800 ${SHARE_CARD_FOOTER_TITLE_FONT_SIZE}px ${FONT_SANS}`
  if (logo) drawImageContain(context, logo, SHARE_CARD_FOOTER_LOGO_X, layout.brandLogoTop, SHARE_CARD_FOOTER_LOGO_SIZE, SHARE_CARD_FOOTER_LOGO_SIZE, 4)
  drawShareCardTextLine(context, '扫码查看完整内容', SHARE_CARD_FOOTER_TEXT_X, layout.brandTextTop + SHARE_CARD_FOOTER_TITLE_FONT_SIZE, `800 ${SHARE_CARD_FOOTER_TITLE_FONT_SIZE}px ${FONT_SANS}`, SHARE_CARD_FOOTER_TITLE_FONT_SIZE, emojiImages)
  context.fillStyle = '#7b8b98'
  context.font = `600 ${SHARE_CARD_FOOTER_BRAND_FONT_SIZE}px ${FONT_SANS}`
  drawShareCardTextLine(context, '私家E院 | Eason Fans Club', SHARE_CARD_FOOTER_TEXT_X, layout.brandTextTop + SHARE_CARD_FOOTER_TITLE_LINE_HEIGHT + SHARE_CARD_FOOTER_TEXT_GAP + SHARE_CARD_FOOTER_BRAND_FONT_SIZE, `600 ${SHARE_CARD_FOOTER_BRAND_FONT_SIZE}px ${FONT_SANS}`, SHARE_CARD_FOOTER_BRAND_FONT_SIZE, emojiImages)

  context.fillStyle = '#ffffff'
  context.fillRect(SHARE_CARD_QR_FRAME_X, layout.qrTop, SHARE_CARD_QR_FRAME_SIZE, SHARE_CARD_QR_FRAME_SIZE)
  context.drawImage(qrCanvas, SHARE_CARD_QR_X, layout.qrTop + 4, SHARE_CARD_QR_SIZE, SHARE_CARD_QR_SIZE)

  return { canvas, qrUrl }
}

function canvasToBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('SHARE_CARD_IMAGE_CREATE_FAILED'))
          return
        }
        try {
          const type = blob.type.trim().toLowerCase()
          if (type && type !== SHARE_CARD_MIME_TYPE) throw new Error('SHARE_CARD_IMAGE_INVALID_MIME')
          resolve(type === SHARE_CARD_MIME_TYPE ? blob : new Blob([blob], { type: SHARE_CARD_MIME_TYPE }))
        } catch (error) {
          reject(error)
        }
      }, SHARE_CARD_MIME_TYPE)
    } catch (error) {
      reject(error)
    }
  })
}

function blobToDataUrl(blob: Blob) {
  if (typeof FileReader === 'undefined') return Promise.reject(new Error('SHARE_CARD_DATA_URL_UNAVAILABLE'))
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string' || !result.startsWith(SHARE_CARD_DATA_URL_PREFIX)) {
        reject(new Error('SHARE_CARD_DATA_URL_INVALID'))
        return
      }
      resolve(result)
    }
    reader.onerror = () => reject(reader.error || new Error('SHARE_CARD_DATA_URL_READ_FAILED'))
    reader.onabort = () => reject(new Error('SHARE_CARD_DATA_URL_READ_ABORTED'))
    try {
      reader.readAsDataURL(blob)
    } catch (error) {
      reject(error)
    }
  })
}

function canvasToDataUrl(canvas: HTMLCanvasElement) {
  const dataUrl = canvas.toDataURL(SHARE_CARD_MIME_TYPE)
  if (!dataUrl.startsWith(SHARE_CARD_DATA_URL_PREFIX)) throw new Error('SHARE_CARD_DATA_URL_INVALID')
  return dataUrl
}

async function finishImage(canvas: HTMLCanvasElement, data: ShareCardData, qrUrl: string) {
  const blob = await canvasToBlob(canvas)
  let previewSrc: string
  try {
    previewSrc = await blobToDataUrl(blob)
  } catch (dataUrlError) {
    try {
      previewSrc = canvasToDataUrl(canvas)
    } catch {
      throw dataUrlError
    }
  }
  return {
    source: 'local',
    blob,
    previewSrc,
    fileName: createShareCardFilename(data.title),
    width: SHARE_CARD_WIDTH,
    height: canvas.height,
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
