import sharp from 'sharp'
import { BADGE_RARITY_LABELS } from '@/lib/badge-types'
import { getBadgeAvailability, getBadgeOwnershipStats } from '@/lib/badge-phase2'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { getMediaPublicBaseUrl, PUBLIC_COS_HOST, toPublicMediaUrl } from '@/lib/media-url'
import { prisma } from '@/lib/prisma'
import { formatUid } from '@/lib/uid'

const CARD_WIDTH = 900
const CARD_HEIGHT = 1200

function escapeXml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character] || character)
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

function textLines(lines: string[], x: number, y: number, size: number, color: string, weight = 600, lineHeight = size * 1.35) {
  return lines.map((line, index) => `<text x="${x}" y="${y + index * lineHeight}" fill="${color}" font-size="${size}" font-weight="${weight}" text-anchor="middle">${escapeXml(line)}</text>`).join('')
}

export async function generateBadgeShareCard(userId: string, badgeId: string) {
  const record = await prisma.userBadge.findUnique({
    where: { userId_badgeId: { userId, badgeId } },
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
  const statsLabel = stats ? `全站获得率 ${escapeXml(stats.display)}` : ''
  const imageMarkup = image
    ? `<image href="${image}" x="300" y="210" width="300" height="300" preserveAspectRatio="xMidYMid meet" />`
    : '<text x="450" y="375" fill="#c58b3a" font-size="116" text-anchor="middle">🏅</text>'
  const subtitle = [BADGE_RARITY_LABELS[record.Badge.rarity], series ? `${series}系列` : '', limitedLabel].filter(Boolean).join(' · ')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">
    <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f5fbff"/><stop offset="1" stop-color="#fff7f1"/></linearGradient><filter id="shadow"><feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#163b4d" flood-opacity="0.16"/></filter></defs>
    <rect width="900" height="1200" rx="42" fill="url(#bg)"/>
    <circle cx="90" cy="108" r="110" fill="#d9eef5" opacity="0.7"/><circle cx="820" cy="1090" r="160" fill="#f2dfcf" opacity="0.65"/>
    <text x="450" y="108" fill="#0f5f78" font-size="30" font-weight="800" text-anchor="middle" letter-spacing="5">私家E院 · EasonFansClub</text>
    <rect x="165" y="170" width="570" height="390" rx="36" fill="#ffffff" opacity="0.88" filter="url(#shadow)"/>
    ${imageMarkup}
    ${textLines(wrapText(badgeName, 15, 2), 450, 590, 46, '#173d4d', 800, 60)}
    ${textLines(wrapText(subtitle, 24, 2), 450, 720, 24, '#0f5f78', 700, 36)}
    ${textLines(descriptionLines, 450, 805, 27, '#536875', 600, 42)}
    <line x1="220" y1="955" x2="680" y2="955" stroke="#c58b3a" stroke-width="2" opacity="0.55"/>
    <text x="450" y="1010" fill="#173d4d" font-size="27" font-weight="800" text-anchor="middle">${escapeXml(nickname)} · UID ${escapeXml(formatUid(user.uid))}</text>
    <text x="450" y="1055" fill="#6f8088" font-size="23" font-weight="600" text-anchor="middle">获得于 ${escapeXml(new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai' }).format(record.obtainedAt))}</text>
    ${statsLabel ? `<text x="450" y="1098" fill="#6f8088" font-size="22" font-weight="600" text-anchor="middle">${statsLabel}</text>` : ''}
    <text x="450" y="1155" fill="#0f5f78" font-size="20" font-weight="800" text-anchor="middle" letter-spacing="3">真实荣誉 · 值得收藏</text>
  </svg>`
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer()
}
