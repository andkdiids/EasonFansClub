import { existsSync } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { BADGE_RARITY_LABELS } from '@/lib/badge-types'
import { getBadgeAvailability, getBadgeOwnershipStats } from '@/lib/badge-phase2'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { getMediaPublicBaseUrl, PUBLIC_COS_HOST, toPublicMediaUrl } from '@/lib/media-url'
import { prisma } from '@/lib/prisma'
import { formatUid } from '@/lib/uid'
import { activeUserBadgeWhere } from '@/lib/badge-validity'

const CARD_WIDTH = 900
const CARD_HEIGHT = 1200
const BADGE_SHARE_FONT_PATH = path.join(process.cwd(), 'public', 'fonts', 'NotoSansSC-VF.ttf')
export const BADGE_SHARE_FONT_FAMILY = 'Noto Sans SC'
export const BADGE_SHARE_FONT_STACK = 'Noto Sans SC, Noto Color Emoji, Apple Color Emoji, Segoe UI Emoji, sans-serif'

type ShareTextLayerInput = {
  text: string
  top: number
  width?: number
  fontSize: number
  color: string
  weight?: number
}

function escapePango(value: string) {
  return value.replace(/[&<>]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[character] || character)
}

function cleanText(value: unknown, maxLength: number) {
  return String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function wrapText(value: string, maxCharacters: number, maxLines: number) {
  const characters = Array.from(value)
  const lines: string[] = []
  for (let index = 0; index < characters.length && lines.length < maxLines; index += maxCharacters) lines.push(characters.slice(index, index + maxCharacters).join(''))
  if (characters.length > maxCharacters * maxLines && lines.length) lines[lines.length - 1] = `${lines[lines.length - 1].slice(0, Math.max(0, maxCharacters - 1))}…`
  return lines
}

async function loadSafeBadgeImage(url: string | null) {
  if (!url) return null
  try {
    const parsed = new URL(url)
    const mediaBase = new URL(getMediaPublicBaseUrl())
    const isCosObject = parsed.hostname.toLowerCase() === PUBLIC_COS_HOST.toLowerCase()
    const isMediaObject = parsed.origin === mediaBase.origin && (parsed.pathname === mediaBase.pathname || parsed.pathname.startsWith(`${mediaBase.pathname.replace(/\/$/, '')}/`))
    if (!isCosObject && !isMediaObject) return null
    const response = await fetch(parsed, { signal: AbortSignal.timeout(3000) })
    if (!response.ok) return null
    const buffer = Buffer.from(await response.arrayBuffer())
    if (buffer.length > 2 * 1024 * 1024) return null
    const png = await sharp(buffer, { failOn: 'none', limitInputPixels: 2048 * 2048 }).resize(300, 300, { fit: 'contain' }).png().toBuffer()
    return `data:image/png;base64,${png.toString('base64')}`
  } catch {
    return null
  }
}

export function assertBadgeShareFontAvailable() {
  if (!existsSync(BADGE_SHARE_FONT_PATH)) {
    throw new Error(`BADGE_SHARE_FONT_MISSING:${BADGE_SHARE_FONT_PATH}`)
  }
}

/**
 * Render share-card copy with Sharp/Pango and an explicit bundled CJK font.
 * The returned pixels no longer depend on fonts installed on the production
 * host or on the phone that downloads the finished PNG. Pango may still use
 * the listed emoji families for characters outside the CJK font.
 */
export async function createBadgeShareTextLayer(input: ShareTextLayerInput) {
  assertBadgeShareFontAvailable()
  const width = input.width || 760
  const markup = `<span foreground="${input.color}" font_weight="${input.weight || 600}">${escapePango(input.text)}</span>`
  const rendered = await sharp({
    text: {
      text: markup,
      font: `${BADGE_SHARE_FONT_STACK} ${input.fontSize}`,
      fontfile: BADGE_SHARE_FONT_PATH,
      width,
      align: 'center',
      rgba: true,
    },
  }).png().toBuffer({ resolveWithObject: true })
  return {
    input: rendered.data,
    left: Math.max(0, Math.round((CARD_WIDTH - rendered.info.width) / 2)),
    top: input.top,
  }
}

export async function generateBadgeShareCard(userId: string, badgeId: string) {
  const record = await prisma.userBadge.findFirst({
    where: { userId, badgeId, ...activeUserBadgeWhere() },
    orderBy: [{ awardedAt: 'desc' }, { id: 'desc' }],
    select: {
      obtainedAt: true,
      Badge: {
        select: {
          id: true,
          name: true,
          acquisitionDescription: true,
          iconUrl: true,
          visibility: true,
          rarity: true,
          availableFrom: true,
          availableUntil: true,
          Series: { select: { name: true } },
        },
      },
    },
  })
  if (!record) return null
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      uid: true,
      nickname: true,
      usernameModerationStatus: true,
      nicknameModerationStatus: true,
      nicknameViolationDisplay: true,
      Profile: { select: { displayName: true, displayNameModerationStatus: true } },
    },
  })
  if (!user) return null
  const stats = record.Badge.visibility === 'PUBLIC' ? (await getBadgeOwnershipStats([badgeId])).get(badgeId) : null
  const image = await loadSafeBadgeImage(toPublicMediaUrl(record.Badge.iconUrl))
  const badgeName = cleanText(record.Badge.name, 36) || '荣誉勋章'
  const description = cleanText(record.Badge.acquisitionDescription, 100)
  const descriptionLines = wrapText(description || '在私家E院留下值得纪念的足迹', 22, 3)
  const nickname = cleanText(getPublicUserDisplayName(user), 24) || 'E院用户'
  const series = cleanText(record.Badge.Series?.name, 24)
  const availability = getBadgeAvailability(record.Badge)
  const limitedLabel = availability === 'ENDED' ? '限定 · 已绝版' : availability === 'AVAILABLE' || availability === 'UPCOMING' ? '限定勋章' : ''
  const statsLabel = stats ? `全站获得率 ${stats.display}` : ''
  const imageMarkup = image
    ? `<image href="${image}" x="300" y="210" width="300" height="300" preserveAspectRatio="xMidYMid meet" />`
    : '<g transform="translate(450 360)"><circle r="76" fill="#f6d99b"/><path d="M0-45 13-15 46-13 20 9 28 42 0 24-28 42-20 9-46-13-13-15Z" fill="#c58b3a"/></g>'
  const subtitle = [BADGE_RARITY_LABELS[record.Badge.rarity], series ? `${series}系列` : '', limitedLabel].filter(Boolean).join(' · ')
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f5fbff"/><stop offset="1" stop-color="#fff7f1"/></linearGradient><filter id="shadow"><feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#163b4d" flood-opacity="0.16"/></filter></defs>
    <rect width="900" height="1200" rx="42" fill="url(#bg)"/>
    <circle cx="90" cy="108" r="110" fill="#d9eef5" opacity="0.7"/><circle cx="820" cy="1090" r="160" fill="#f2dfcf" opacity="0.65"/>
    <rect x="165" y="170" width="570" height="390" rx="36" fill="#ffffff" opacity="0.88" filter="url(#shadow)"/>
    ${imageMarkup}
    <line x1="220" y1="955" x2="680" y2="955" stroke="#c58b3a" stroke-width="2" opacity="0.55"/>
  </svg>`
  const textLayerInputs: ShareTextLayerInput[] = [
    { text: '私家E院 · EasonFansClub', top: 72, width: 760, fontSize: 30, color: '#0f5f78', weight: 800 },
    ...wrapText(badgeName, 15, 2).map((line, index) => ({ text: line, top: 560 + index * 60, width: 760, fontSize: 46, color: '#173d4d', weight: 800 })),
    ...wrapText(subtitle, 24, 2).map((line, index) => ({ text: line, top: 690 + index * 36, width: 760, fontSize: 24, color: '#0f5f78', weight: 700 })),
    ...descriptionLines.map((line, index) => ({ text: line, top: 775 + index * 42, width: 760, fontSize: 27, color: '#536875', weight: 600 })),
    { text: `${nickname} · UID ${formatUid(user.uid)}`, top: 980, width: 760, fontSize: 27, color: '#173d4d', weight: 800 },
    { text: `获得于 ${new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai' }).format(record.obtainedAt)}`, top: 1032, width: 760, fontSize: 23, color: '#6f8088', weight: 600 },
    ...(statsLabel ? [{ text: statsLabel, top: 1075, width: 760, fontSize: 22, color: '#6f8088', weight: 600 }] : []),
    { text: '真实荣誉 · 值得收藏', top: 1130, width: 760, fontSize: 20, color: '#0f5f78', weight: 800 },
  ]
  const textLayers = await Promise.all(textLayerInputs.map(createBadgeShareTextLayer))
  return sharp(Buffer.from(svg, 'utf8')).composite(textLayers).png({ compressionLevel: 9 }).toBuffer()
}
