import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildForumHref, clampForumPage, getForumOffset } from '../lib/forum'
import { getPaginationItems, parsePaginationJump } from '../lib/pagination'

test('pagination keeps the first page window compact', () => {
  assert.deepEqual(getPaginationItems(1, 100), [1, 2, 3, 4, 5, 6, 7, 'ellipsis', 100])
})

test('pagination centers a middle page around seven continuous pages', () => {
  assert.deepEqual(getPaginationItems(20, 100), [1, 'ellipsis', 17, 18, 19, 20, 21, 22, 23, 'ellipsis', 100])
})

test('pagination does not duplicate the last page near the end', () => {
  assert.deepEqual(getPaginationItems(99, 100), [94, 95, 96, 97, 98, 99, 100])
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
})

test('forum page data uses the URL page and only corrects it after a clamped response', () => {
  const forumHome = readFileSync('components/ForumHome.tsx', 'utf8')
  assert.match(forumHome, /page: String\(page\)/)
  assert.match(forumHome, /currentPage=\{page\}/)
  assert.match(forumHome, /if \(payload\.page !== page\) \{\s*router\.replace\(/)
  assert.doesNotMatch(forumHome, /data\.page === page\) return\s*\n\s*router\.replace\(/)
})

test('pagination layout keeps controls aligned and hides edge buttons on very narrow forum screens', () => {
  const css = readFileSync('app/globals.css', 'utf8')
  assert.match(css, /\.pagination-page,\.pagination-edge,\.pagination-jump button \{[^}]*display:inline-flex/)
  assert.match(css, /\.pagination-wrap \{[^}]*justify-content:center/)
  assert.match(css, /\.forum-pagination \.pagination-edge \{ display:none!important; \}/)
})
