import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { getMediaPublicBaseUrl, PUBLIC_COS_HOST } from '@/lib/media-url'
import { publicImageUrl } from '@/lib/images'
import { createBrandedQrBuffer } from '@/lib/branded-qr-server'
import { canonicalShareUrl, SHARE_CARD_CANONICAL_ORIGIN, SHARE_CARD_HEIGHT, SHARE_CARD_MIME_TYPE, SHARE_CARD_WIDTH, shareCardTypeLabel, type ShareCardData } from '@/lib/share-card'
import {
  calculateShareCardLayout,
  shareCardHeroFit,
  SHARE_CARD_AUTHOR_LINE_HEIGHT,
  SHARE_CARD_AUTHOR_X,
  SHARE_CARD_AUTHOR_WIDTH,
  SHARE_CARD_AVATAR_SIZE,
  SHARE_CARD_AVATAR_X,
  SHARE_CARD_CATEGORY_FONT_SIZE,
  SHARE_CARD_DESCRIPTION_FONT_SIZE,
  SHARE_CARD_DESCRIPTION_LINE_HEIGHT,
  SHARE_CARD_FOOTER_LOGO_SIZE,
  SHARE_CARD_FOOTER_LOGO_X,
  SHARE_CARD_FOOTER_BRAND_FONT_SIZE,
  SHARE_CARD_FOOTER_TEXT_GAP,
  SHARE_CARD_FOOTER_TITLE_FONT_SIZE,
  SHARE_CARD_FOOTER_TITLE_LINE_HEIGHT,
  SHARE_CARD_FOOTER_TEXT_WIDTH,
  SHARE_CARD_FOOTER_TEXT_X,
  SHARE_CARD_META_FONT_SIZE,
  SHARE_CARD_META_LINE_HEIGHT,
  SHARE_CARD_PANEL_PADDING_X,
  SHARE_CARD_QR_SIZE,
  SHARE_CARD_QR_X,
  SHARE_CARD_TEXT_WIDTH,
  SHARE_CARD_TITLE_FONT_SIZE,
  SHARE_CARD_TITLE_LINE_HEIGHT,
  type ShareCardImageDimensions,
} from '@/lib/share-card-layout'

const IMAGE_FETCH_TIMEOUT_MS = 5000
const MAX_REMOTE_IMAGE_BYTES = 6 * 1024 * 1024
const VIDEO_FILE_PATTERN = /\.(?:3gp|avi|flv|m4v|mkv|mov|mp4|mpeg|mpg|ogm|ogv|webm|wmv|m3u8)$/i
const FONT_PATH = path.join(process.cwd(), 'public', 'fonts', 'NotoSansSC-VF.ttf')
const FONT_STACK = 'Noto Sans SC, Noto Color Emoji, Segoe UI Emoji, Apple Color Emoji, Microsoft YaHei, PingFang SC, sans-serif'
const OFFICIAL_LOGO_PATH = path.join(process.cwd(), 'app', 'icon.png')
const DEFAULT_OG_ASSET_PATH = path.join(process.cwd(), 'public', 'images', 'og-default.png')

type ImageBuffer = Buffer | null

type TextLayerInput = Readonly<{
  text: string
  left: number
  top: number
  width: number
  fontSize: number
  color: string
  weight?: number
  align?: 'left' | 'center'
}>

type CompositeLayer = {
  input: Buffer
  left: number
  top: number
}

function escapePango(value: string) {
  return value.replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character] || character)
}

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character] || character)
}

function normalizedTrustedUrl(value: string | null | undefined) {
  const publicValue = publicImageUrl(value) || value
  if (!publicValue) return null
  try {
    return new URL(publicValue, SHARE_CARD_CANONICAL_ORIGIN)
  } catch {
    return null
  }
}

function isTrustedImageOrigin(parsed: URL) {
  if (parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase()
  if (host === 'ecfc.fans' || host === 'www.ecfc.fans' || host === PUBLIC_COS_HOST) return true
  try {
    return parsed.origin === new URL(getMediaPublicBaseUrl()).origin
  } catch {
    return false
  }
}

/** Only database-originated, project-controlled HTTPS media can reach Sharp. */
export function isTrustedShareCardImageUrl(value: string | null | undefined) {
  const parsed = normalizedTrustedUrl(value)
  return Boolean(parsed && isTrustedImageOrigin(parsed) && !VIDEO_FILE_PATTERN.test(parsed.pathname))
}

async function readKnownLocalAsset(parsed: URL) {
  const host = parsed.hostname.toLowerCase()
  if (host !== 'ecfc.fans' && host !== 'www.ecfc.fans') return null
  if (parsed.pathname === '/icon.png') return readFile(OFFICIAL_LOGO_PATH)
  if (parsed.pathname === '/images/og-default.png') return readFile(DEFAULT_OG_ASSET_PATH)
  return null
}

async function loadTrustedImage(value: string | null | undefined): Promise<ImageBuffer> {
  if (!isTrustedShareCardImageUrl(value)) return null
  try {
    const parsed = normalizedTrustedUrl(value)
    if (!parsed) return null
    const local = await readKnownLocalAsset(parsed)
    if (local) return local

    const response = await fetch(parsed, {
      redirect: 'error',
      signal: AbortSignal.timeout(IMAGE_FETCH_TIMEOUT_MS),
    })
    if (!response.ok) return null
    const declaredLength = Number(response.headers.get('content-length') || 0)
    if (declaredLength > MAX_REMOTE_IMAGE_BYTES) return null
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > MAX_REMOTE_IMAGE_BYTES) return null
    await sharp(buffer, { failOn: 'error', limitInputPixels: 30_000_000 }).metadata()
    return buffer
  } catch {
    return null
  }
}

async function readableImageDimensions(input: Buffer): Promise<ShareCardImageDimensions | null> {
  try {
    const metadata = await sharp(input, { failOn: 'error', limitInputPixels: 30_000_000 }).rotate().metadata()
    if (!metadata.width || !metadata.height) return null
    return { width: metadata.width, height: metadata.height }
  } catch {
    return null
  }
}

/** Exposed for cache/API tests and for callers that need the real Hero ratio. */
export async function getTrustedShareCardImageDimensions(value: string | null | undefined) {
  const image = await loadTrustedImage(value)
  return image ? readableImageDimensions(image) : null
}

async function fitImage(input: Buffer, width: number, height: number, fit: 'cover' | 'contain') {
  try {
    return await sharp(input, { failOn: 'none', limitInputPixels: 30_000_000 })
      .rotate()
      .resize(width, height, { fit, position: 'centre' })
      .png()
      .toBuffer()
  } catch {
    return null
  }
}

async function circleImage(input: Buffer, size: number) {
  const resized = await fitImage(input, size, size, 'cover')
  if (!resized) return null
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="white"/></svg>`)
  try {
    return await sharp(resized).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
  } catch {
    return resized
  }
}

let officialLogoPromise: Promise<ImageBuffer> | null = null

async function loadOfficialLogo() {
  if (!officialLogoPromise) {
    officialLogoPromise = readFile(OFFICIAL_LOGO_PATH).catch((error) => {
      console.error('[share-card.logo]', { errorName: error instanceof Error ? error.name : 'unknown' })
      return null
    })
  }
  return officialLogoPromise
}

async function createTextLayer(input: TextLayerInput) {
  const textConfig = {
    text: `<span foreground="${input.color}" font_weight="${input.weight || 600}">${escapePango(input.text)}</span>`,
    font: `${FONT_STACK} ${input.fontSize}`,
    width: input.width,
    align: input.align || 'left',
    rgba: true,
    ...(existsSync(FONT_PATH) ? { fontfile: FONT_PATH } : {}),
  }
  const rendered = await sharp({ text: textConfig }).png().toBuffer({ resolveWithObject: true })
  return {
    input: rendered.data,
    left: input.align === 'center' ? input.left + Math.max(0, Math.round((input.width - rendered.info.width) / 2)) : input.left,
    top: input.top,
  } satisfies CompositeLayer
}

function baseBackgroundSvg(height: number, heroHeight: number) {
  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${SHARE_CARD_WIDTH}" height="${height}" viewBox="0 0 ${SHARE_CARD_WIDTH} ${height}">
    <defs>
      <linearGradient id="hero" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#071523"/><stop offset="0.55" stop-color="#0d526b"/><stop offset="1" stop-color="#16845b"/></linearGradient>
    </defs>
    <rect width="${SHARE_CARD_WIDTH}" height="${height}" fill="#f5fbfd"/>
    <rect width="${SHARE_CARD_WIDTH}" height="${heroHeight}" fill="url(#hero)"/>
    <circle cx="160" cy="150" r="180" fill="#ffffff" opacity="0.16"/><circle cx="940" cy="${Math.max(420, heroHeight - 140)}" r="280" fill="#ffffff" opacity="0.16"/>
  </svg>`
}

function heroShadeSvg(height: number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHARE_CARD_WIDTH}" height="${height}"><defs><linearGradient id="heroShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#020812" stop-opacity="0"/><stop offset="1" stop-color="#020812" stop-opacity="0.76"/></linearGradient></defs><rect width="${SHARE_CARD_WIDTH}" height="${height}" fill="url(#heroShade)"/></svg>`
}

/** The information block is a flush, rectangular part of the poster flow. */
function panelSvg(top: number, height: number) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SHARE_CARD_WIDTH}" height="${Math.max(SHARE_CARD_HEIGHT, top + height)}"><rect x="0" y="${top}" width="${SHARE_CARD_WIDTH}" height="${height}" fill="#ffffff" fill-opacity="0.96"/></svg>`
}

function fallbackAvatarSvg(name: string) {
  const initial = escapeXml(Array.from(name.trim())[0] || 'E')
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="86" height="86"><defs><linearGradient id="avatar" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f5f8f"/><stop offset="1" stop-color="#16845b"/></linearGradient></defs><circle cx="43" cy="43" r="43" fill="url(#avatar)"/><text x="43" y="55" text-anchor="middle" fill="white" font-family="${FONT_STACK}" font-size="36" font-weight="800">${initial}</text></svg>`)
}

function pushTextLines(target: TextLayerInput[], lines: readonly string[], input: Omit<TextLayerInput, 'text' | 'top'> & { top: number; lineHeight: number }) {
  lines.forEach((text, index) => {
    if (!text) return
    target.push({ ...input, text, top: input.top + index * input.lineHeight })
  })
}

export type ShareCardRenderResult = Readonly<{
  body: Buffer
  height: number
}>

/** Generate the canonical 1080px-wide PNG used by the COS cache. */
export async function renderShareCardPngWithInfo(data: ShareCardData): Promise<ShareCardRenderResult> {
  const normalizedData = { ...data, url: canonicalShareUrl(data.url) }
  const [hero, avatar, logo] = await Promise.all([
    loadTrustedImage(normalizedData.image),
    loadTrustedImage(normalizedData.authorAvatar),
    loadOfficialLogo(),
  ])
  const actualHeroDimensions = hero ? await readableImageDimensions(hero) : null
  const layout = calculateShareCardLayout(normalizedData, actualHeroDimensions)
  const qr = await createBrandedQrBuffer(normalizedData.url, SHARE_CARD_QR_SIZE)

  const layers: CompositeLayer[] = []
  if (hero) {
    const heroLayer = await fitImage(hero, SHARE_CARD_WIDTH, layout.heroHeight, shareCardHeroFit(normalizedData.type))
    if (heroLayer) layers.push({ input: heroLayer, left: 0, top: 0 }, { input: Buffer.from(heroShadeSvg(layout.heroHeight)), left: 0, top: 0 })
  }
  layers.push({ input: Buffer.from(panelSvg(layout.panelTop, layout.panelHeight)), left: 0, top: 0 })

  if (avatar) {
    const avatarLayer = await circleImage(avatar, SHARE_CARD_AVATAR_SIZE)
    if (avatarLayer) layers.push({ input: avatarLayer, left: SHARE_CARD_AVATAR_X, top: layout.authorTop })
  } else {
    layers.push({ input: fallbackAvatarSvg(layout.author), left: SHARE_CARD_AVATAR_X, top: layout.authorTop })
  }
  layers.push({ input: qr, left: SHARE_CARD_QR_X, top: layout.qrTop })

  const contentLeft = SHARE_CARD_PANEL_PADDING_X
  const textInputs: TextLayerInput[] = [{ text: shareCardTypeLabel(normalizedData.type), left: contentLeft, top: layout.categoryTop, width: SHARE_CARD_TEXT_WIDTH, fontSize: SHARE_CARD_CATEGORY_FONT_SIZE, color: '#0f5f8f', weight: 800 }]
  pushTextLines(textInputs, layout.titleLines, { left: contentLeft, top: layout.titleTop, width: SHARE_CARD_TEXT_WIDTH, fontSize: SHARE_CARD_TITLE_FONT_SIZE, color: '#102033', weight: 800, lineHeight: SHARE_CARD_TITLE_LINE_HEIGHT })
  pushTextLines(textInputs, layout.descriptionLines, { left: contentLeft, top: layout.descriptionTop, width: SHARE_CARD_TEXT_WIDTH, fontSize: SHARE_CARD_DESCRIPTION_FONT_SIZE, color: '#536779', weight: 500, lineHeight: SHARE_CARD_DESCRIPTION_LINE_HEIGHT })
  pushTextLines(textInputs, layout.metaLines, { left: contentLeft, top: layout.metaTop, width: SHARE_CARD_TEXT_WIDTH, fontSize: SHARE_CARD_META_FONT_SIZE, color: '#536779', weight: 700, lineHeight: SHARE_CARD_META_LINE_HEIGHT })
  pushTextLines(textInputs, layout.authorLines, { left: SHARE_CARD_AUTHOR_X, top: layout.authorTextTop, width: SHARE_CARD_AUTHOR_WIDTH, fontSize: 30, color: '#102033', weight: 800, lineHeight: SHARE_CARD_AUTHOR_LINE_HEIGHT })
  pushTextLines(textInputs, layout.dateLines, { left: SHARE_CARD_AUTHOR_X, top: layout.dateTop, width: SHARE_CARD_AUTHOR_WIDTH, fontSize: 22, color: '#7b8b98', weight: 500, lineHeight: 30 })
  textInputs.push(
    { text: '扫码查看完整内容', left: SHARE_CARD_FOOTER_TEXT_X, top: layout.brandTextTop, width: SHARE_CARD_FOOTER_TEXT_WIDTH, fontSize: SHARE_CARD_FOOTER_TITLE_FONT_SIZE, color: '#0f5f8f', weight: 800 },
    { text: '私家E院 | Eason Fans Club', left: SHARE_CARD_FOOTER_TEXT_X, top: layout.brandTextTop + SHARE_CARD_FOOTER_TITLE_LINE_HEIGHT + SHARE_CARD_FOOTER_TEXT_GAP, width: SHARE_CARD_FOOTER_TEXT_WIDTH, fontSize: SHARE_CARD_FOOTER_BRAND_FONT_SIZE, color: '#7b8b98', weight: 600 },
  )

  if (logo) {
    const logoLayer = await fitImage(logo, SHARE_CARD_FOOTER_LOGO_SIZE, SHARE_CARD_FOOTER_LOGO_SIZE, 'contain')
    if (logoLayer) layers.push({ input: logoLayer, left: SHARE_CARD_FOOTER_LOGO_X, top: layout.brandLogoTop })
  }

  const textLayers = await Promise.all(textInputs.map(createTextLayer))
  layers.push(...textLayers)
  const body = await sharp(Buffer.from(baseBackgroundSvg(layout.height, layout.heroHeight), 'utf8'))
    .composite(layers)
    .png({ compressionLevel: 9 })
    .toBuffer()
  return { body, height: layout.height }
}

export async function renderShareCardPng(data: ShareCardData) {
  return (await renderShareCardPngWithInfo(data)).body
}

export const shareCardRendererConstants = {
  width: SHARE_CARD_WIDTH,
  height: SHARE_CARD_HEIGHT,
  mimeType: SHARE_CARD_MIME_TYPE,
  logoPath: 'app/icon.png',
  footerLogoSize: SHARE_CARD_FOOTER_LOGO_SIZE,
  footerLogoX: SHARE_CARD_FOOTER_LOGO_X,
} as const
