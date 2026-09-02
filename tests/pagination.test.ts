import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildForumHref, clampForumPage, getForumOffset } from '../lib/forum'
import { getPaginationItems, parsePaginationJump } from '../lib/pagination'

test('pagination keeps the first page window compact', () => {
  assert.deepEqual(getPaginationItems(1, 100), [1, 2, 3, 4, 5, 6, 7, 'ellipsis', 100])
})

test('pagination centers a middle page with first and last pages always visible', () => {
  // 中间页：首页 + 省略号 + 当前附近窗口(5) + 省略号 + 尾页
  assert.deepEqual(getPaginationItems(20, 100), [1, 'ellipsis', 18, 19, 20, 21, 22, 'ellipsis', 100])
  assert.deepEqual(getPaginationItems(50, 108), [1, 'ellipsis', 48, 49, 50, 51, 52, 'ellipsis', 108])
})

test('pagination always shows the first page when near the last page', () => {
  assert.deepEqual(getPaginationItems(99, 100), [1, 'ellipsis', 94, 95, 96, 97, 98, 99, 100])
  // 最后一页：存在首页入口 1
  assert.deepEqual(getPaginationItems(108, 108), [1, 'ellipsis', 102, 103, 104, 105, 106, 107, 108])
  assert.equal(getPaginationItems(108, 108).includes(1), true)
})

test('pagination preserves original display when total pages <= 7', () => {
  assert.deepEqual(getPaginationItems(1, 3), [1, 2, 3])
  assert.deepEqual(getPaginationItems(2, 3), [1, 2, 3])
  assert.deepEqual(getPaginationItems(3, 3), [1, 2, 3])
  assert.deepEqual(getPaginationItems(4, 7), [1, 2, 3, 4, 5, 6, 7])
})

test('forum page navigation keeps the requested page and offset aligned', () => {
  assert.deepEqual(getPaginationItems(1, 3), [1, 2, 3])
  assert.deepEqual(getPaginationItems(2, 3), [1, 2, 3])
  assert.deepEqual(getPaginationItems(3, 3), [1, 2, 3])
  assert.equal(clampForumPage(1, 3), 1)
  assert.equal(clampForumPage(2, 3), 2)
  assert.equal(clampForumPage(3, 3), 3)
  assert.equal(getForumOffset(1, 20), 0)
  assert.equal(getForumOffset(2, 20), 20)
  assert.equal(getForumOffset(3, 20), 40)
  assert.equal(
    buildForumHref('/forum', 'board=concert&sort=featured&query=live&page=1', { page: 2 }),
    '/forum?board=concert&sort=featured&query=live&page=2',
  )
})

test('pagination jump accepts valid pages, clamps overflow, and ignores invalid input', () => {
  assert.equal(parsePaginationJump(' 2 ', 3), 2)
  assert.equal(parsePaginationJump('3', 3), 3)
  assert.equal(parsePaginationJump('999', 3), 3)
  assert.equal(parsePaginationJump('', 3), null)
  assert.equal(parsePaginationJump('abc', 3), null)
  assert.equal(parsePaginationJump('0', 3), null)
  assert.equal(parsePaginationJump('-1', 3), null)
  assert.equal(parsePaginationJump('1.5', 3), null)
})

test('forum discovery feed uses a cursor for infinite scrolling instead of the removed list view page state', () => {
  const forumDiscovery = readFileSync('components/ForumDiscoveryHome.tsx', 'utf8')
  assert.match(forumDiscovery, /cursor: requestCursor/)
  assert.match(forumDiscovery, /nextCursorRef/)
  assert.match(forumDiscovery, /loadPage\(false\)/)
  assert.doesNotMatch(forumDiscovery, /currentPage=|page: String\(page\)/)
})

test('pagination layout keeps controls aligned and hides edge buttons on very narrow forum screens', () => {
  const css = readFileSync('app/globals.css', 'utf8')
  assert.match(css, /\.pagination-page,\.pagination-edge,\.pagination-jump button \{[^}]*display:inline-flex/)
  assert.match(css, /\.pagination-wrap \{[^}]*justify-content:center/)
  assert.match(css, /\.forum-pagination \.pagination-edge \{ display:none!important; \}/)
})

test('pagination component delegates to getPaginationItems and keeps UI unchanged', () => {
  const component = readFileSync('components/ui/Pagination.tsx', 'utf8')
  // 统一组件：页码逻辑仍来自 lib/pagination，未内联复制
  assert.match(component, /getPaginationItems\(safeCurrent, safeTotal, maxVisiblePages\)/)
  // UI 类名保持不变（未改样式/布局/按钮）
  assert.match(component, /className="pagination-page"/)
  assert.match(component, /className="pagination-edge"/)
  assert.match(component, /pagination-wrap/)
  assert.match(component, /className="pagination-jump"/)
  assert.match(component, /className="pagination-ellipsis"/)
  // 上一页 / 下一页 / 跳至 结构保留
  assert.match(component, /上一页/)
  assert.match(component, /下一页/)
  assert.match(component, /跳至/)
})

test('all list pages reference the unified Pagination component', () => {
  const referencing = [
    'components/CheckInMessagesPanel.tsx',
    'components/clinic/ClinicHomeClient.tsx',
    'components/FriendActivityPanel.tsx',
    'components/ProfileWall.tsx',
    'components/ratings/RatingRankingList.tsx',
    'app/notifications/NotificationsClient.tsx',
    'app/registration-fee/RegistrationFeeHistoryClient.tsx',
    'app/stickers/StickerStoreGrid.tsx',
    'components/games/PrescriptionHistoryPagination.tsx',
  ]
  for (const file of referencing) {
    assert.match(readFileSync(file, 'utf8'), /Pagination/, `${file} 应使用统一分页组件`)
  }
})
