import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { canTrackBadgeView, type BadgeView } from '@/lib/badge-types'

const read = (path: string) => readFileSync(path, 'utf8')

function badge(overrides: Partial<BadgeView> = {}): BadgeView {
  return {
    id: 'badge-1', name: '测试勋章', imageUrl: null, effectType: 'NONE', nicknameEffect: 'NONE',
    nicknameColor: null, nicknameGradientStart: null, nicknameGradientEnd: null, rarity: 'COMMON',
    description: null, acquisitionDescription: null, visibility: 'PUBLIC', grantType: 'AUTO',
    isWearable: true, isEnabled: true, sortOrder: 0, status: 'NOT_OBTAINED', obtainedAt: null,
    isEquipped: false, availabilityStatus: 'PERMANENT', progress: { current: 2, target: 10, percentage: 20, operator: 'GTE' },
    ...overrides,
  }
}

test('badge center uses one shared first-level navigation', () => {
  const tabs = read('components/BadgeCenterTabs.tsx')
  assert.match(tabs, /label: '全部'/)
  assert.match(tabs, /label: '任务'/)
  assert.match(tabs, /label: '回顾'/)
  assert.match(read('components/BadgeExhibitionHall.tsx'), /<BadgeCenterTabs active="all" \/>/)
  assert.match(read('components/BadgeTaskCenter.tsx'), /<BadgeCenterTabs active="tasks" \/>/)
  assert.match(read('app/badges/year-in-review/page.tsx'), /<BadgeCenterTabs active="review" \/>/)
})

test('museum uses obtained as an internal filter and removes the old split navigation', () => {
  const museum = read('components/BadgeExhibitionHall.tsx')
  assert.match(museum, /已获得/)
  assert.doesNotMatch(museum, /我的收藏|全部馆藏|HONOR ARCHIVE/)
  assert.doesNotMatch(read('components/BadgeTaskCenter.tsx'), /右侧推荐/)
  assert.doesNotMatch(read('app/badges/year-in-review/page.tsx'), /YEAR REVIEW/)
})

test('track button eligibility mirrors the server contract', () => {
  assert.equal(canTrackBadgeView(badge()), true)
  assert.equal(canTrackBadgeView(badge({ status: 'OBTAINED' })), false)
  assert.equal(canTrackBadgeView(badge({ grantType: 'MANUAL' })), false)
  assert.equal(canTrackBadgeView(badge({ grantType: 'EVENT' })), false)
  assert.equal(canTrackBadgeView(badge({ visibility: 'HIDDEN' })), false)
  assert.equal(canTrackBadgeView(badge({ visibility: 'SECRET' })), false)
  assert.equal(canTrackBadgeView(badge({ availabilityStatus: 'ENDED' })), false)
  assert.equal(canTrackBadgeView(badge({ isEnabled: false })), false)
  assert.equal(canTrackBadgeView(badge({ progress: { current: 2, target: 10, percentage: 20, operator: 'GTE', progressUnsupported: true } })), false)
})

test('badge detail, task cards and museum all use the same tracking API', () => {
  const collection = read('components/BadgeCollectionPanel.tsx')
  const museum = read('components/BadgeExhibitionHall.tsx')
  assert.match(read('components/BadgeCollectionPanel.tsx'), /\/api\/users\/me\/badge-tasks\//)
  assert.match(read('components/BadgeCollectionPanel.tsx'), /追踪此勋章/)
  assert.match(collection, /canTrack=\{isSelf && canTrackBadgeView\(selected\)\}/)
  assert.match(museum, /canTrack=\{gallery\.isAuthenticated && canTrackBadgeView\(selected\)\}/)
  assert.match(read('components/BadgeTaskCenter.tsx'), /\/api\/users\/me\/badge-tasks\//)
  assert.match(read('components/BadgeTaskCenter.tsx'), /href=\{`\/badges\?badge=/)
  assert.match(read('lib/badge-service.ts'), /canExposeLiveBadgeProgress\(badge\)/)
})

test('center pages keep detail URL state and mobile tabs in one row', () => {
  assert.match(read('components/BadgeExhibitionHall.tsx'), /params\.set\('badge', badge\.id\)/)
  assert.match(read('components/BadgeExhibitionHall.tsx'), /params\.delete\('badge'\)/)
  assert.match(read('app/globals.css'), /\.badge-center-tabs \{ display:grid; grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/)
  assert.doesNotMatch(read('app/globals.css'), /\.badge-center-tabs[^{]*overflow-x:auto/)
})
