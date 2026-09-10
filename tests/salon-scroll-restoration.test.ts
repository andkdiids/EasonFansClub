import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import type { SalonPostView } from '@/lib/salon-shared'
import {
  appendSalonListRestoreParam,
  createSalonListScrollState,
  matchesSalonListContext,
  normalizeSalonReturnTo,
  parseSalonListScrollState,
  readSalonListScrollStateFromStorage,
  updateSalonListHistoryState,
  writeSalonListScrollStateToStorage,
} from '@/lib/salon-scroll-state'

const read = (path: string) => readFileSync(path, 'utf8')

const categoryCounts = {
  all: 24,
  CONCERT: 12,
  MOBILE_WALLPAPER: 6,
  DESKTOP_WALLPAPER: 4,
  TIME_TRAVEL: 2,
}

const post = { id: 'salon-24' } as SalonPostView

function createState() {
  return createSalonListScrollState({
    pathname: '/salon',
    listHref: '/salon?category=CONCERT&concert=tour-1&session=session-2&sort=popular',
    category: 'CONCERT',
    concert: 'tour-1',
    session: 'session-2',
    sort: 'popular',
    posts: [post],
    hasMore: true,
    nextCursor: 'cursor-page-4',
    feedMode: 'popular',
    feedSeed: null,
    categoryCounts,
    anchorPostId: post.id,
    scrollY: 1843,
    savedAt: Date.now(),
  })
}

test('沙龙返回地址只允许 /salon 并完整保留筛选 query', () => {
  assert.equal(normalizeSalonReturnTo('/salon?category=CONCERT&concert=tour-1&session=session-2&sort=popular'), '/salon?category=CONCERT&concert=tour-1&session=session-2&sort=popular')
  assert.equal(normalizeSalonReturnTo('/salon/123'), null)
  assert.equal(normalizeSalonReturnTo('/forum?board=all'), null)
  assert.equal(normalizeSalonReturnTo('https://example.com/salon'), null)
  assert.equal(normalizeSalonReturnTo('//example.com/salon'), null)
  assert.equal(appendSalonListRestoreParam('/salon?category=CONCERT'), '/salon?category=CONCERT&restore=1')
})

test('沙龙列表状态保存已加载作品、游标、锚点和滚动位置', () => {
  const state = createState()
  const parsed = parseSalonListScrollState(JSON.parse(JSON.stringify(state)))
  assert.equal(parsed?.listHref, state.listHref)
  assert.equal(parsed?.posts[0]?.id, post.id)
  assert.equal(parsed?.nextCursor, 'cursor-page-4')
  assert.equal(parsed?.anchorPostId, post.id)
  assert.equal(parsed?.scrollY, 1843)
  assert.equal(parsed ? matchesSalonListContext(parsed, state) : false, true)
})

test('沙龙列表状态优先复用 history，并可用 sessionStorage 作为返回兜底', () => {
  const state = createState()
  const history = updateSalonListHistoryState({ __NA: true }, state)
  assert.equal((history as Record<string, unknown>)['salon-list-scroll-state'] !== undefined, true)

  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
  writeSalonListScrollStateToStorage(storage, state)
  assert.equal(readSalonListScrollStateFromStorage(storage)?.anchorPostId, post.id)
})

test('沙龙列表进入详情时携带 return 来源并保存恢复状态，详情返回优先使用历史', () => {
  const home = read('components/salon/SalonHome.tsx')
  const detail = read('components/salon/SalonDetail.tsx')
  const detailPage = read('app/salon/[postId]/page.tsx')
  const listPage = read('app/salon/page.tsx')
  assert.match(home, /getSalonListSessionStorage/)
  assert.match(home, /nextCursor: nextCursorRef\.current/)
  assert.match(home, /feedSeed: feedSeedRef\.current/)
  assert.match(home, /data-salon-post-id=\{post\.id\}/)
  assert.match(home, /scrollY: window\.scrollY/)
  assert.match(home, /new URLSearchParams\(\{ from: returnHref \}\)/)
  assert.match(detail, /appendSalonListRestoreParam\(returnHref\)/)
  assert.match(detail, /router\.back\(\)/)
  assert.match(detailPage, /normalizeSalonReturnTo/)
  assert.match(listPage, /restoreOnMount=\{params\.restore === '1'\}/)
})
