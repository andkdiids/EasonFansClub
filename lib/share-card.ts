import { htmlToPlainText } from '@/lib/share-metadata'

export const SHARE_CARD_WIDTH = 1080
export const SHARE_CARD_HEIGHT = 1440
export const SHARE_CARD_MIME_TYPE = 'image/png'

export const SHARE_CARD_CANONICAL_ORIGIN = 'https://ecfc.fans'

export type ShareCardType = 'home' | 'post' | 'activity' | 'clinic'

export type ShareCardMeta = Readonly<{
  label: string
  value: string
}>

/** The only public fields that can reach the client-side poster renderer. */
export type ShareCardData = Readonly<{
  type: ShareCardType
  title: string
  description: string
  image: string | null
  url: string
  author: string | null
  authorAvatar: string | null
  date: string | null
  meta: readonly ShareCardMeta[]
  canGenerateCard?: boolean
}>

const PUBLIC_CANONICAL_HOSTS = new Set(['ecfc.fans', 'www.ecfc.fans'])

/**
 * Always build QR payloads from the production canonical origin. Query strings
 * and fragments are intentionally dropped so copied cards never carry session,
 * focus, or internal state parameters.
 */
export function canonicalShareUrl(value: string) {
  const parsed = new URL(value.trim(), SHARE_CARD_CANONICAL_ORIGIN)
  if (parsed.protocol !== 'https:' || !PUBLIC_CANONICAL_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error('SHARE_CARD_URL_MUST_BE_CANONICAL_HTTPS')
  }
  return `${SHARE_CARD_CANONICAL_ORIGIN}${parsed.pathname || '/'}`
}

export function shareCardQrPayload(url: string) {
  return canonicalShareUrl(url)
}

function redactSensitiveText(value: string) {
  return value
    .replace(/[\w.!#$%&'*+/=?^`{|}~-]+@[\w-]+(?:\.[\w-]+)+/gi, '[已隐藏邮箱]')
    .replace(/1[3-9]\d{9}/g, '[已隐藏手机号]')
}

/** Remove HTML/Markdown presentation syntax before text reaches the poster. */
export function sanitizeShareCardText(value: string | null | undefined) {
  return redactSensitiveText(htmlToPlainText(value)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`{1,3}/g, '')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim())
}

export function createShareCardFilename(title: string | null | undefined) {
  const safeTitle = sanitizeShareCardText(title)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
  const compactTitle = Array.from(safeTitle || '分享卡片').slice(0, 60).join('') || '分享卡片'
  return `私家E院-${compactTitle}.png`
}

export function shareCardTypeLabel(type: ShareCardType) {
  if (type === 'activity') return 'E院活动'
  if (type === 'post') return 'E院广场'
  if (type === 'clinic') return '病友会诊'
  return 'Eason Fans Club'
}
