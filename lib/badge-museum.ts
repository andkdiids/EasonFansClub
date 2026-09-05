import type { BadgeView, EquippedBadgeView } from '@/lib/badge-types'

export type BadgeMuseumItem = BadgeView | EquippedBadgeView

const RARITY_PRIORITY: Record<string, number> = {
  LEGENDARY: 0,
  EPIC: 1,
  LIMITED: 2,
  RARE: 3,
  COMMON: 4,
}

function itemId(item: BadgeMuseumItem) {
  return item.id
}

function itemSortOrder(item: BadgeMuseumItem) {
  return 'sortOrder' in item && typeof item.sortOrder === 'number' ? item.sortOrder : 0
}

function itemTierGroup(item: BadgeMuseumItem) {
  return 'tierGroupCode' in item ? item.tierGroupCode || null : null
}

function itemTierLevel(item: BadgeMuseumItem) {
  return 'tierLevel' in item && typeof item.tierLevel === 'number' ? item.tierLevel : Number.MAX_SAFE_INTEGER
}

/** Keep tier levels together while retaining the administrator's sort order. */
export function orderMuseumBadges<T extends BadgeMuseumItem>(items: readonly T[]) {
  const groups = new Map<string, T[]>()
  const groupOrder: string[] = []

  items.forEach((item, index) => {
    const key = itemTierGroup(item) || `badge:${itemId(item)}:${index}`
    const group = groups.get(key)
    if (group) group.push(item)
    else {
      groups.set(key, [item])
      groupOrder.push(key)
    }
  })

  return groupOrder
    .sort((leftKey, rightKey) => {
      const left = groups.get(leftKey) || []
      const right = groups.get(rightKey) || []
      const leftFirst = left[0]
      const rightFirst = right[0]
      return itemSortOrder(leftFirst) - itemSortOrder(rightFirst)
        || itemTierLevel(leftFirst) - itemTierLevel(rightFirst)
        || itemId(leftFirst).localeCompare(itemId(rightFirst))
    })
    .flatMap((key) => (groups.get(key) || []).sort((left, right) => (
      itemTierLevel(left) - itemTierLevel(right)
      || itemSortOrder(left) - itemSortOrder(right)
      || itemId(left).localeCompare(itemId(right))
    )))
}

/**
 * Split a series into visual shelves without needlessly separating a tier group.
 * The group may be split only when it itself is larger than the shelf capacity.
 */
export function chunkMuseumShelves<T extends BadgeMuseumItem>(items: readonly T[], capacity = 6) {
  const safeCapacity = Math.max(1, Math.trunc(capacity) || 1)
  const ordered = orderMuseumBadges(items)
  const shelves: T[][] = []
  const groups: T[][] = []
  let currentGroup: T[] = []
  let currentKey: string | null = null
  ordered.forEach((item, index) => {
    const key = itemTierGroup(item) || `single:${itemId(item)}:${index}`
    if (currentGroup.length && key !== currentKey) {
      groups.push(currentGroup)
      currentGroup = []
    }
    currentGroup.push(item)
    currentKey = key
  })
  if (currentGroup.length) groups.push(currentGroup)

  let shelf: T[] = []
  for (const group of groups) {
    if (group.length > safeCapacity) {
      if (shelf.length) {
        shelves.push(shelf)
        shelf = []
      }
      for (let index = 0; index < group.length; index += safeCapacity) shelves.push(group.slice(index, index + safeCapacity))
      continue
    }
    if (shelf.length && shelf.length + group.length > safeCapacity) {
      shelves.push(shelf)
      shelf = []
    }
    shelf.push(...group)
    if (shelf.length === safeCapacity) {
      shelves.push(shelf)
      shelf = []
    }
  }
  if (shelf.length) shelves.push(shelf)
  return shelves
}

/** Select the bounded personal showcase without writing a new preference row. */
export function selectMiniShowcase({
  showcase,
  recent,
  equipped,
  limit = 6,
}: {
  showcase: readonly BadgeView[]
  recent: readonly BadgeView[]
  equipped?: EquippedBadgeView | readonly EquippedBadgeView[] | null
  limit?: number
}) {
  const safeLimit = Math.max(1, Math.min(6, Math.trunc(limit) || 6))
  if (showcase.length) return [...showcase].slice(0, safeLimit)

  const selected: BadgeMuseumItem[] = []
  const seen = new Set<string>()
  const equippedBadges = Array.isArray(equipped) ? equipped : equipped ? [equipped] : []
  selected.push(...equippedBadges)
  equippedBadges.forEach((badge) => seen.add(badge.id))

  const candidates = [...recent]
    .filter((badge) => badge.status === 'OBTAINED' && !seen.has(badge.id))
    .sort((left, right) => {
      const leftRarity = RARITY_PRIORITY[left.rarity] ?? 99
      const rightRarity = RARITY_PRIORITY[right.rarity] ?? 99
      const leftLimited = left.availabilityStatus === 'ENDED' || left.rarity === 'LIMITED' ? 0 : 1
      const rightLimited = right.availabilityStatus === 'ENDED' || right.rarity === 'LIMITED' ? 0 : 1
      const leftTime = left.obtainedAt ? new Date(left.obtainedAt).getTime() : 0
      const rightTime = right.obtainedAt ? new Date(right.obtainedAt).getTime() : 0
      return leftRarity - rightRarity || leftLimited - rightLimited || rightTime - leftTime || left.id.localeCompare(right.id)
    })

  for (const badge of candidates) {
    if (selected.length >= safeLimit) break
    selected.push(badge)
    seen.add(badge.id)
  }
  return selected
}
