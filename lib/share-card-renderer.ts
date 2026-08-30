import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import QRCode from 'qrcode'
import sharp from 'sharp'
import { getMediaPublicBaseUrl, PUBLIC_COS_HOST } from '@/lib/media-url'
import { canonicalShareUrl, sanitizeShareCardText, SHARE_CARD_CANONICAL_ORIGIN, SHARE_CARD_HEIGHT, SHARE_CARD_MIME_TYPE, SHARE_CARD_WIDTH, shareCardQrPayload, shareCardTypeLabel, type ShareCardData } from '@/lib/share-card'

const IMAGE_FETCH_TIMEOUT_MS = 5000
const MAX_REMOTE_IMAGE_BYTES = 6 * 1024 * 1024
const VIDEO_FILE_PATTERN = /\.(?:3gp|avi|flv|m4v|mkv|mov|mp4|mpeg|mpg|ogm|ogv|webm|wmv|m3u8)$/i
const FONT_PATH = path.join(process.cwd(), 'public', 'fonts', 'NotoSansSC-VF.ttf')
const FONT_STACK = 'Noto Sans SC, Microsoft YaHei, PingFang SC, sans-serif'
const OFFICIAL_LOGO_PATH = path.join(process.cwd(), 'app', 'icon.png')
const DEFAULT_OG_ASSET_PATH = path.join(process.cwd(), 'public', 'images', 'og-default.png')
const DESCRIPTION_CHARS_PER_LINE = 30

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

function cleanText(value: string | null | undefined, maxLength: number) {
  return sanitizeShareCardText(value).replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, maxLength).trim()
}

function wrapText(value: string, maxCharacters: number, maxLines: number) {
  const characters = Array.from(value)
  const lines: string[] = []
  for (let index = 0; index < characters.length && lines.length < maxLines; index += maxCharacters) {
    lines.push(characters.slice(index, index + maxCharacters).join(''))
  }
  if (characters.length > maxCharacters * maxLines && lines.length) {
    lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, Math.max(0, maxCharacters - 1))}…`
  }
  return lines
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
  if (!value) return false
  try {
    const parsed = new URL(value, SHARE_CARD_CANONICAL_ORIGIN)
    return isTrustedImageOrigin(parsed) && !VIDEO_FILE_PATTERN.test(parsed.pathname)
  } catch {
    return false
  }
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
    const parsed = new URL(value || '', SHARE_CARD_CANONICAL_ORIGIN)
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

async function fitImage(input: Buffer, width: number, height: number, fit: 'cover' | 'contain') {
  try {
    return await sharp(input, { failOn: 'none', limitInputPixels: 30_000_000 })
      .rotate()
      .resize(width, height, { fit })
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

function baseBackgroundSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${SHARE_CARD_WIDTH}" height="${SHARE_CARD_HEIGHT}" viewBox="0 0 ${SHARE_CARD_WIDTH} ${SHARE_CARD_HEIGHT}">
    <defs>
      <linearGradient id="hero" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#071523"/><stop offset="0.55" stop-color="#0d526b"/><stop offset="1" stop-color="#16845b"/></linearGradient>
      <linearGradient id="heroShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#020812" stop-opacity="0"/><stop offset="1" stop-color="#020812" stop-opacity="0.76"/></linearGradient>
      <linearGradient id="avatar" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f5f8f"/><stop offset="1" stop-color="#16845b"/></linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="10" stdDeviation="16" flood-color="#071523" flood-opacity="0.14"/></filter>
    </defs>
    <rect width="${SHARE_CARD_WIDTH}" height="${SHARE_CARD_HEIGHT}" fill="#f5fbfd"/>
    <rect width="${SHARE_CARD_WIDTH}" height="660" fill="url(#hero)"/>
    <rect y="660" width="${SHARE_CARD_WIDTH}" height="${SHARE_CARD_HEIGHT - 660}" fill="#f5fbfd"/>
    <circle cx="160" cy="150" r="180" fill="#ffffff" opacity="0.16"/><circle cx="940" cy="520" r="280" fill="#ffffff" opacity="0.16"/>
  </svg>`
}

function heroShadeSvg() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="660"><defs><linearGradient id="heroShade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#020812" stop-opacity="0"/><stop offset="1" stop-color="#020812" stop-opacity="0.76"/></linearGradient></defs><rect width="1080" height="660" fill="url(#heroShade)"/></svg>'
}

function panelSvg() {
  return '<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440"><defs><filter id="panelShadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="10" stdDeviation="16" flood-color="#071523" flood-opacity="0.14"/></filter></defs><rect x="56" y="570" width="968" height="640" rx="26" fill="#ffffff" fill-opacity="0.96" filter="url(#panelShadow)"/></svg>'
}

function fallbackAvatarSvg(name: string) {
  const initial = escapeXml(Array.from(name.trim())[0] || 'E')
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="86" height="86"><circle cx="43" cy="43" r="43" fill="url(#avatar)"/><defs><linearGradient id="avatar" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0f5f8f"/><stop offset="1" stop-color="#16845b"/></linearGradient></defs><text x="43" y="55" text-anchor="middle" fill="white" font-family="Microsoft YaHei, sans-serif" font-size="36" font-weight="800">${initial}</text></svg>`)
}

/** Generate the canonical 1080×1440 PNG used by the COS cache. */
export async function renderShareCardPng(data: ShareCardData) {
  const normalizedData = { ...data, url: canonicalShareUrl(data.url) }
  const [hero, avatar, logo] = await Promise.all([
    loadTrustedImage(normalizedData.image),
    loadTrustedImage(normalizedData.authorAvatar),
    loadOfficialLogo(),
  ])
  const qrUrl = shareCardQrPayload(normalizedData.url)
  const qr = await QRCode.toBuffer(qrUrl, {
    type: 'png',
    width: 224,
    margin: 2,
    errorCorrectionLevel: 'H',
    color: { dark: '#071523', light: '#ffffff' },
  })

  const layers: CompositeLayer[] = []
  if (hero) {
    const heroLayer = await fitImage(hero, SHARE_CARD_WIDTH, 660, 'cover')
    if (heroLayer) layers.push({ input: heroLayer, left: 0, top: 0 }, { input: Buffer.from(heroShadeSvg()), left: 0, top: 0 })
  }
  layers.push({ input: Buffer.from(panelSvg()), left: 0, top: 0 })

  if (logo) {
    const logoLayer = await fitImage(logo, 128, 128, 'contain')
    if (logoLayer) layers.push({ input: logoLayer, left: 56, top: 38 })
  }

  const author = cleanText(normalizedData.author, 32) || '私家E院'
  if (avatar) {
    const avatarLayer = await circleImage(avatar, 86)
    if (avatarLayer) layers.push({ input: avatarLayer, left: 60, top: 1208 })
  } else {
    layers.push({ input: fallbackAvatarSvg(author), left: 60, top: 1208 })
  }
  layers.push({ input: qr, left: 792, top: 1164 })

  const panelX = 104
  const panelWidth = 872
  const title = cleanText(normalizedData.title, 100) || shareCardTypeLabel(normalizedData.type)
  const description = cleanText(normalizedData.description, 240)
  const date = cleanText(normalizedData.date, 40)
  const meta = normalizedData.meta
    .map(({ label, value }) => ({ label: cleanText(label, 24), value: cleanText(value, 80) }))
    .filter(({ label, value }) => label && value)
    .slice(0, 3)
  const textInputs: TextLayerInput[] = [
    { text: shareCardTypeLabel(normalizedData.type), left: panelX, top: 632, width: panelWidth, fontSize: 22, color: '#0f5f8f', weight: 800 },
    ...wrapText(title, 20, 2).map((text, index) => ({ text, left: panelX, top: 688 + index * 70, width: panelWidth, fontSize: 56, color: '#102033', weight: 800 })),
    ...wrapText(description || '扫码查看完整内容', DESCRIPTION_CHARS_PER_LINE, 3).map((text, index) => ({ text, left: panelX, top: 842 + index * 42, width: panelWidth, fontSize: 30, color: '#536779', weight: 500 })),
  ]
  let metaTop = 1005
  for (const item of meta) {
    textInputs.push({ text: `${item.label}：${item.value}`, left: panelX, top: metaTop, width: panelWidth, fontSize: 25, color: '#536779', weight: 700 })
    metaTop += 38
  }
  textInputs.push(
    { text: author, left: 172, top: 1232, width: 560, fontSize: 30, color: '#102033', weight: 800 },
    { text: date ? `发布于 ${date}` : '来自私家E院', left: 172, top: 1270, width: 560, fontSize: 22, color: '#7b8b98', weight: 500 },
    { text: '扫码查看完整内容', left: 60, top: 1366, width: 650, fontSize: 26, color: '#0f5f8f', weight: 800 },
    { text: '私家E院 | Eason Fans Club', left: 60, top: 1403, width: 700, fontSize: 20, color: '#7b8b98', weight: 600 },
  )

  const textLayers = await Promise.all(textInputs.map(createTextLayer))
  layers.push(...textLayers)
  return sharp(Buffer.from(baseBackgroundSvg(), 'utf8'))
    .composite(layers)
    .png({ compressionLevel: 9 })
    .toBuffer()
}

export const shareCardRendererConstants = {
  width: SHARE_CARD_WIDTH,
  height: SHARE_CARD_HEIGHT,
  mimeType: SHARE_CARD_MIME_TYPE,
  logoPath: 'app/icon.png',
} as const
