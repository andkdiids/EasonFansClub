import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

type PlazaPost = {
  id: string
  isPinned: boolean
  isFeatured: boolean
  createdAt: string
  hotScore?: number
}

function compareLatest(left: PlazaPost, right: PlazaPost) {
  const pinnedDelta = Number(right.isPinned) - Number(left.isPinned)
  if (pinnedDelta) return pinnedDelta
  const dateDelta = Date.parse(right.createdAt) - Date.parse(left.createdAt)
  return dateDelta || right.id.localeCompare(left.id)
}

function compareHot(left: PlazaPost, right: PlazaPost) {
  const pinnedDelta = Number(right.isPinned) - Number(left.isPinned)
  if (pinnedDelta) return pinnedDelta
  return (right.hotScore || 0) - (left.hotScore || 0) || right.id.localeCompare(left.id)
}

test('广场最新流中精选与普通帖按时间同级，置顶仍优先', () => {
  const posts: PlazaPost[] = [
    { id: 'featured-old', isPinned: false, isFeatured: true, createdAt: '2026-09-12T11:57:00.000Z' },
    { id: 'normal-new', isPinned: false, isFeatured: false, createdAt: '2026-09-12T11:59:00.000Z' },
    { id: 'pinned', isPinned: true, isFeatured: false, createdAt: '2026-09-12T10:00:00.000Z' },
    { id: 'featured-new', isPinned: false, isFeatured: true, createdAt: '2026-09-12T12:00:00.000Z' },
    { id: 'normal-old', isPinned: false, isFeatured: false, createdAt: '2026-09-12T11:58:00.000Z' },
  ]
  assert.deepEqual([...posts].sort(compareLatest).map((post) => post.id), [
    'pinned', 'featured-new', 'normal-new', 'normal-old', 'featured-old',
  ])
})

test('广场热门流只按现有热度排序，精选不会跨过置顶或额外提权', () => {
  const posts: PlazaPost[] = [
    { id: 'featured', isPinned: false, isFeatured: true, createdAt: '2026-09-12T12:00:00.000Z', hotScore: 2 },
    { id: 'normal', isPinned: false, isFeatured: false, createdAt: '2026-09-12T11:59:00.000Z', hotScore: 10 },
    { id: 'pinned', isPinned: true, isFeatured: false, createdAt: '2026-09-12T10:00:00.000Z', hotScore: 0 },
  ]
  assert.deepEqual([...posts].sort(compareHot).map((post) => post.id), ['pinned', 'normal', 'featured'])
})

test('广场服务端查询移除精选一级排序并保持精选筛选与分页稳定性', () => {
  const discovery = read('app/api/forum/discover/route.ts')
  const feed = read('app/api/forum/feed/route.ts')

  assert.doesNotMatch(discovery, /isFeatured:\s*'desc'/)
  assert.doesNotMatch(feed, /isFeatured:\s*'desc'/)
  assert.doesNotMatch(discovery, /row\.isFeatured\s*\?\s*18/)
  assert.match(discovery, /const pinnedDelta = Number\(right\.isPinned\) - Number\(left\.isPinned\)/)
  assert.match(discovery, /orderBy: \[\{ isPinned: 'desc' \}, \{ likeCount: 'desc' \}/)
  assert.match(discovery, /orderBy: pinAwareOrder[\s\S]*\[\{ isPinned: 'desc' \}, \{ createdAt: 'desc' \}, \{ id: 'desc' \}/)
  assert.match(discovery, /typeof cursor\.isPinned === 'boolean'/)
  assert.doesNotMatch(discovery, /cursor\.isFeatured/)
  assert.match(feed, /sort === 'featured' \? \{ isFeatured: true \}/)
  assert.match(feed, /\[\{ isPinned: 'desc' \}, \{ createdAt: 'desc' \}, \{ id: 'desc' \}\]/)
})
