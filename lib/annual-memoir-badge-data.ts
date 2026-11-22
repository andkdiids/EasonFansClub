import type { Prisma } from '@prisma/client'
import { composeMemoirBadges, type MemoirBadge } from '@/lib/annual-memoir-badges'
import { currentUserBadgeWhere } from '@/lib/badge-validity'
import { toPublicMediaUrl } from '@/lib/media-url'

const availableBadge = {
  visibility: 'PUBLIC', isEnabled: true, isActive: true, iconUrl: { not: null },
} satisfies Prisma.BadgeWhereInput

const imageBadgeSelect = { name: true, iconUrl: true } satisfies Prisma.BadgeSelect

function pngUrl(iconUrl: string | null) {
  const url = toPublicMediaUrl(iconUrl)
  return url && /\.png(?:[?#]|$)/i.test(url) && /^(?:https:\/\/|\/(?!\/))/.test(url) ? url : null
}

export async function collectMemoirBadges(tx: Prisma.TransactionClient, userId: string, range: { gte: Date; lt: Date }) {
  const grants = await tx.userBadge.findMany({
    where: { userId, obtainedAt: range, revokedAt: null, isHidden: false, ...currentUserBadgeWhere(), Badge: availableBadge },
    orderBy: [{ obtainedAt: 'desc' }, { id: 'asc' }],
    select: { id: true, badgeId: true, Badge: { select: imageBadgeSelect } },
  })
  const seen = new Set<string>()
  const candidates = grants.flatMap(({ id, badgeId, Badge }) => {
    const imageUrl = pngUrl(Badge.iconUrl)
    if (!imageUrl || seen.has(badgeId)) return []
    seen.add(badgeId)
    return [{ id, name: Badge.name, imageUrl }]
  })
  return composeMemoirBadges(candidates, userId + ':' + range.gte.toISOString())
}

export async function visibleMemoirBadges(tx: Prisma.TransactionClient, userId: string, frozen: readonly (MemoirBadge & { id: string })[]) {
  if (!frozen.length) return []
  const current = await tx.userBadge.findMany({
    where: { userId, id: { in: frozen.map(({ id }) => id) }, revokedAt: null, isHidden: false,
      ...currentUserBadgeWhere(), Badge: availableBadge },
    select: { id: true, Badge: { select: imageBadgeSelect } },
  })
  const byId = new Map(current.map(({ id, Badge }) => [id, Badge]))
  return frozen.flatMap(({ id, ...badge }) => {
    const match = byId.get(id)
    return match?.name === badge.name && pngUrl(match.iconUrl) === badge.imageUrl ? [badge] : []
  })
}

export async function previewMemoirBadges(tx: Prisma.TransactionClient) {
  const badges = await tx.badge.findMany({
    where: { ...availableBadge, iconUrl: { endsWith: '.png' } },
    orderBy: { id: 'asc' }, take: 6, select: { id: true, ...imageBadgeSelect },
  })
  return composeMemoirBadges(badges.flatMap(({ id, name, iconUrl }) => {
    const imageUrl = pngUrl(iconUrl)
    return imageUrl ? [{ id, name, imageUrl }] : []
  }), 'memoir-preview').map(({ imageUrl, name, x, y, size, angle }) => ({ imageUrl, name, x, y, size, angle }))
}
