import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  getForumDiscoveryCoverFit,
  normalizeDiscoveryIds,
  selectRecommendationRows,
} from '../lib/forum-discovery'

test('发现流封面按 4:3 规则选择裁切或完整展示', () => {
  assert.equal(getForumDiscoveryCoverFit(900, 1600), 'cover')
  assert.equal(getForumDiscoveryCoverFit(4, 3), 'cover')
  assert.equal(getForumDiscoveryCoverFit(1600, 900), 'contain')
  assert.equal(getForumDiscoveryCoverFit(null, null), 'cover')
})

test('推荐流跨批次同时排除已见帖子和已见作者', () => {
  const rows = [
    { id: 'p1', author: { id: 'u1' } },
    { id: 'p2', author: { id: 'u1' } },
    { id: 'p3', author: { id: 'u2' } },
    { id: 'p4', author: { id: 'u3' } },
  ]
  const first = selectRecommendationRows(rows, new Set(), new Set(), 10)
  assert.deepEqual(first.rows.map((row) => row.id), ['p1', 'p3', 'p4'])
  const second = selectRecommendationRows(
    [{ id: 'p5', author: { id: 'u1' } }, { id: 'p6', author: { id: 'u4' } }],
    first.seenPostIds,
    first.seenAuthorIds,
    10,
  )
  assert.deepEqual(second.rows.map((row) => row.id), ['p6'])
})

test('推荐流排除 ID 会去重并限制输入规模', () => {
  assert.deepEqual(normalizeDiscoveryIds(['p1', 'p1', '', 1, 'p2']), ['p1', 'p2'])
  assert.deepEqual(normalizeDiscoveryIds('p1'), [])
  const route = readFileSync('app/api/forum/discover/route.ts', 'utf8')
  assert.match(route, /publicPostWhere/)
  assert.match(route, /seenAuthorIds/)
  assert.match(route, /randomInt/)
  assert.doesNotMatch(route, /ORDER\s+BY\s+RAND\s*\(/i)
})

test('主题切换和发现详情只在移动端边界启用', () => {
  const home = readFileSync('components/ForumHome.tsx', 'utf8')
  const detail = readFileSync('components/ForumDiscoveryDetailController.tsx', 'utf8')
  const css = readFileSync('app/globals.css', 'utf8')
  assert.match(home, /ecfc-forum-theme/)
  assert.match(home, /max-width: 767px/)
  assert.match(detail, /max-width: 767px/)
  assert.match(css, /@media \(max-width:767px\)[\s\S]*forum-discovery-grid/)
  assert.match(css, /data-forum-detail-discover='true'[\s\S]*app-mobile-nav/)
})
