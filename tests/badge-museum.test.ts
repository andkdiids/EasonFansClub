import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { chunkMuseumShelves, orderMuseumBadges, selectMiniShowcase } from '@/lib/badge-museum'
import type { BadgeView, EquippedBadgeView } from '@/lib/badge-types'

const read = (path: string) => readFileSync(path, 'utf8')

function badge(overrides: Partial<BadgeView> = {}): BadgeView {
  return {
    id: 'badge-1',
    name: '测试勋章',
    imageUrl: null,
    effectType: 'NONE',
    nicknameEffect: 'NONE',
    nicknameColor: null,
    nicknameGradientStart: null,
    nicknameGradientEnd: null,
    rarity: 'COMMON',
    description: null,
    acquisitionDescription: null,
    visibility: 'PUBLIC',
    grantType: 'MANUAL',
    isWearable: true,
    isEnabled: true,
    sortOrder: 0,
    status: 'OBTAINED',
    obtainedAt: '2026-08-23T00:00:00.000Z',
    isEquipped: false,
    ...overrides,
  }
}

function equipped(overrides: Partial<EquippedBadgeView> = {}): EquippedBadgeView {
  return {
    id: 'equipped-1',
    name: '当前佩戴',
    imageUrl: null,
    effectType: 'NONE',
    nicknameEffect: 'NONE',
    nicknameColor: null,
    nicknameGradientStart: null,
    nicknameGradientEnd: null,
    rarity: 'RARE',
    obtainedAt: '2026-08-23T00:00:00.000Z',
    ...overrides,
  }
}

test('museum ordering keeps the same tier group adjacent', () => {
  const items = [
    badge({ id: 'tier-1', sortOrder: 1, tierGroupCode: 'POST_MASTER', tierLevel: 1 }),
    badge({ id: 'ordinary', sortOrder: 2, tierGroupCode: null, tierLevel: null }),
    badge({ id: 'tier-2', sortOrder: 3, tierGroupCode: 'POST_MASTER', tierLevel: 2 }),
  ]
  assert.deepEqual(orderMuseumBadges(items).map((item) => item.id), ['tier-1', 'tier-2', 'ordinary'])
})

test('museum shelves use bounded chunks and do not split a small tier group', () => {
  const items = [1, 2, 3, 4, 5, 6, 7].map((number) => badge({ id: `tier-${number}`, sortOrder: number, tierGroupCode: 'TIER', tierLevel: number }))
  const shelves = chunkMuseumShelves(items, 6)
  assert.deepEqual(shelves.map((shelf) => shelf.map((item) => item.id)), [
    ['tier-1', 'tier-2', 'tier-3', 'tier-4', 'tier-5', 'tier-6'],
    ['tier-7'],
  ])
})

test('museum shelf chunking is stable at empty, boundary and large counts', () => {
  for (const count of [0, 1, 3, 4, 6, 7, 100]) {
    const items = Array.from({ length: count }, (_, index) => badge({
      id: `shelf-${index + 1}`,
      sortOrder: index + 1,
    }))
    const shelves = chunkMuseumShelves(items, 6)
    assert.equal(shelves.some((shelf) => shelf.length === 0), false)
    assert.equal(shelves.flat().length, count)
    assert.deepEqual(shelves.flat().map((item) => item.id), items.map((item) => item.id))
    assert.equal(shelves.every((shelf) => shelf.length <= 6), true)
  }
})

test('mini showcase prefers explicit slots and otherwise falls back to owned highlights', () => {
  const explicit = badge({ id: 'explicit', name: '橱窗第一枚' })
  assert.deepEqual(selectMiniShowcase({ showcase: [explicit], recent: [], limit: 6 }).map((item) => item.id), ['explicit'])

  const fallback = selectMiniShowcase({
    showcase: [],
    equipped: equipped(),
    recent: [
      badge({ id: 'common', rarity: 'COMMON', obtainedAt: '2026-08-23T00:00:00.000Z' }),
      badge({ id: 'limited', rarity: 'LIMITED', availabilityStatus: 'ENDED', obtainedAt: '2026-08-20T00:00:00.000Z' }),
      badge({ id: 'epic', rarity: 'EPIC', obtainedAt: '2026-08-21T00:00:00.000Z' }),
    ],
  })
  assert.deepEqual(fallback.map((item) => item.id), ['equipped-1', 'epic', 'limited', 'common'])
})

test('museum service filters SECRET and redacts unearned HIDDEN before the client', () => {
  const service = read('lib/badge-service.ts')
  assert.match(service, /badge\.visibility !== 'SECRET' \|\| ownedIds\.has\(badge\.id\)/)
  assert.match(service, /if \(badge\.visibility === 'HIDDEN'\) return \[hiddenBadgeView\(badge\)\]/)
  assert.match(service, /if \(viewerId\) await addProgressToUnownedBadges/)
})

test('museum URL state validates series and does not keep SECRET detail in the public view', () => {
  const hall = read('components/BadgeExhibitionHall.tsx')
  assert.match(hall, /gallery\.series\.some\(\(entry\) => entry\.series\.id === requestedSeries\)/)
  assert.match(hall, /requestedBadge\?\.visibility !== 'SECRET'/)
  assert.match(hall, /current\?\.visibility === 'SECRET' \? null : current/)
})

test('museum and mini showcase are connected to the requested routes and profile surface', () => {
  assert.match(read('app/badges/page.tsx'), /getBadgeExhibitionGallery/)
  assert.match(read('components/BadgeExhibitionHall.tsx'), /badge-museum-cabinet/)
  assert.match(read('components/ProfilePageSurface.tsx'), /BadgeMiniShowcase/)
  assert.match(read('components/layout/MobileNavigation.tsx'), /href: '\/badges'/)
  assert.match(read('lib/site-config.ts'), /勋章展览馆.*\/badges/)
})
