import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  appendUniqueDiscoveryPosts,
  getForumDiscoveryCoverFit,
  mergeRecentRecommendedPostIds,
  normalizeDiscoveryIds,
  parseForumDiscoveryLimit,
  parseForumDiscoveryMode,
  selectRecommendationRows,
  stableRecommendationWeight,
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
  const recentExcluded = selectRecommendationRows(rows, new Set(), new Set(), 10, new Set(['p1', 'p3']))
  assert.deepEqual(recentExcluded.rows.map((row) => row.id), ['p2', 'p4'])
})

test('推荐流排除 ID 会去重并限制输入规模', () => {
  assert.deepEqual(normalizeDiscoveryIds(['p1', 'p1', '', 1, 'p2']), ['p1', 'p2'])
  assert.deepEqual(normalizeDiscoveryIds('p1'), [])
  const route = readFileSync('app/api/forum/discover/route.ts', 'utf8')
  assert.match(route, /publicPostWhere/)
  assert.match(route, /seenAuthorIds/)
  assert.match(route, /feedSeed/)
  assert.match(route, /recommendationScore/)
  assert.match(route, /recentRecommendedPostIds/)
  assert.match(route, /DISCOVERY_CANDIDATE_POOL = 120/)
  assert.match(route, /stableRecommendationWeight/)
  assert.match(route, /skip: \(startWindow \+ window\) \* candidateSize/)
  assert.match(route, /createdAt: \{ lte: feedSeed/)
  assert.doesNotMatch(route, /randomInt/)
  assert.doesNotMatch(route, /ORDER\s+BY\s+RAND\s*\(/i)
})

test('小臣书追加按 post.id 保持旧顺序，并保留已显示帖子的对象', () => {
  const page1 = [{ id: 'p1', title: '第一页-1' }, { id: 'p2', title: '第一页-2' }]
  const page2 = [{ id: 'p2', title: '重复但不应覆盖' }, { id: 'p3', title: '第二页-1' }]
  const page3 = [{ id: 'p4', title: '第三页-1' }]

  const afterPage2 = appendUniqueDiscoveryPosts(page1, page2)
  const afterPage3 = appendUniqueDiscoveryPosts(afterPage2, page3)

  assert.deepEqual(afterPage2.map((post) => post.id), ['p1', 'p2', 'p3'])
  assert.deepEqual(afterPage3.map((post) => post.id), ['p1', 'p2', 'p3', 'p4'])
  assert.strictEqual(afterPage2[0], page1[0])
  assert.strictEqual(afterPage2[1], page1[1])
  assert.equal(afterPage2[1]?.title, '第一页-2')
})

test('E院广场只挂载小臣书流，详情页仍按移动端边界启用发现式布局', () => {
  const home = readFileSync('components/ForumHome.tsx', 'utf8')
  const discovery = readFileSync('components/ForumDiscoveryHome.tsx', 'utf8')
  const detail = readFileSync('components/ForumDiscoveryDetailController.tsx', 'utf8')
  const css = readFileSync('app/globals.css', 'utf8')
  assert.match(home, /<ForumDiscoveryHome showDesktopRefresh \/>/)
  assert.doesNotMatch(home, /ForumPlazaHome|ecfc-forum-theme|localStorage|showModeSwitch|onSwitchToPlaza/)
  assert.doesNotMatch(discovery, /forum-discovery-mode-button|onSwitchToPlaza|showModeSwitch/)
  assert.match(detail, /max-width: 767px/)
  assert.match(css, /@media \(max-width:767px\)[\s\S]*forum-discovery-grid/)
  assert.match(css, /data-forum-detail-discover='true'[\s\S]*app-mobile-nav/)
})

test('小臣书接口参数有明确边界，非法输入不会静默变成默认请求', () => {
  assert.equal(parseForumDiscoveryMode(undefined), 'recommend')
  assert.equal(parseForumDiscoveryMode('latest'), 'latest')
  assert.equal(parseForumDiscoveryMode('hot'), 'hot')
  assert.equal(parseForumDiscoveryMode('other'), null)
  assert.equal(parseForumDiscoveryLimit(undefined), 12)
  assert.equal(parseForumDiscoveryLimit(8), 8)
  assert.equal(parseForumDiscoveryLimit(20), 20)
  assert.equal(parseForumDiscoveryLimit(7), null)
  assert.equal(parseForumDiscoveryLimit(21), null)
  assert.equal(parseForumDiscoveryLimit('12'), null)
  assert.deepEqual(normalizeDiscoveryIds([' p1 ', 'p1', '']), ['p1'])
  assert.deepEqual(normalizeDiscoveryIds(['x'.repeat(81)]), [])
  assert.equal(normalizeDiscoveryIds(Array.from({ length: 501 }, (_, index) => `post-${index}`)).length, 500)

  const route = readFileSync('app/api/forum/discover/route.ts', 'utf8')
  assert.match(route, /getCurrentUser\(\)/)
  assert.match(route, /parseForumDiscoveryMode/)
  assert.match(route, /parseForumDiscoveryLimit/)
  assert.match(route, /status: 400/)
  assert.match(route, /status: 404/)
  assert.match(route, /length > max/)
  assert.match(route, /take: 100/)
  assert.match(route, /\.\.\.discoverySelect/)
  assert.doesNotMatch(route, /passwordHash|verificationToken|sessionToken|answer/i)
})

test('system discovery tabs use server-side sorting and never expose post-card IP regions', () => {
  const route = readFileSync('app/api/forum/discover/route.ts', 'utf8')
  const home = readFileSync('components/ForumDiscoveryHome.tsx', 'utf8')
  const tabs = readFileSync('lib/forum-discovery.ts', 'utf8')
  const discoveryCard = readFileSync('components/ForumDiscoveryCard.tsx', 'utf8')
  const postList = readFileSync('components/PostList.tsx', 'utf8')
  const detail = readFileSync('app/posts/[postId]/page.tsx', 'utf8')
  const replies = readFileSync('components/PostRepliesSection.tsx', 'utf8')

  assert.match(route, /mode === 'hot'/)
  assert.match(route, /likeCount: 'desc'[\s\S]*replyCount: 'desc'[\s\S]*createdAt: 'desc'[\s\S]*id: 'desc'/)
  assert.match(route, /createdAt: \{ lt: cursor\.date \}/)
  assert.match(route, /createdAt: cursor\.date, id: \{ lt: cursor\.id \}/)
  assert.match(route, /buildHotCursor/)
  assert.match(route, /take: limit \+ 1/)
  assert.match(route, /isPinned: false/)
  assert.match(route, /isFeatured: false/)
  assert.match(route, /slug: \{ not: 'announcements' \}/)
  assert.match(tabs, /value: 'latest'/)
  assert.match(tabs, /value: 'hot'/)
  assert.match(tabs, /label: '热门'/)
  assert.match(home, /next\.set\('sort', value\)/)
  assert.doesNotMatch(discoveryCard, /IpRegionLabel/)
  assert.doesNotMatch(postList, /IpRegionLabel/)
  assert.match(detail, /IpRegionLabel ipRegion=\{post\.ipRegion\}/)
  assert.match(replies, /IpRegionLabel ipRegion=\{reply\.ipRegion\}/)
})

test('小臣书首页只挂载一个 feed，请求具备取消、去重和错误停止自动重试保护', () => {
  const home = readFileSync('components/ForumHome.tsx', 'utf8')
  const discovery = readFileSync('components/ForumDiscoveryHome.tsx', 'utf8')

  assert.match(home, /ForumDiscoveryHome showDesktopRefresh/)
  assert.doesNotMatch(home, /useState|useEffect|matchMedia|localStorage/)
  assert.match(discovery, /useState<ForumDiscoveryPost\[\]>\(\[\]\)/)
  assert.match(discovery, /new AbortController\(\)/)
  assert.match(discovery, /signal: controller\.signal/)
  assert.match(discovery, /requestRef\.current\?\.controller\.abort\(\)/)
  assert.match(discovery, /requestSequence\.current \+= 1/)
  assert.match(discovery, /postsRef\.current/)
  assert.match(discovery, /appendUniqueDiscoveryPosts/)
  assert.match(discovery, /recentRecommendedPostIds/)
  assert.match(discovery, /autoLoadBlockedRef/)
  assert.match(discovery, /loadPage\(false, true\)/)
  assert.match(discovery, /rootMargin: '420px 0px'/)
  assert.match(discovery, /\[hasMore, loadPage, loadingMore\]/)
  assert.match(discovery, /feedSeed: requestFeedSeed/)
  assert.match(discovery, /payload\.nextCursor === requestCursor/)
  assert.match(discovery, /DISCOVERY_SESSION_MAX_AGE_MS = 30 \* 60_000/)
  assert.match(discovery, /storedAge <= DISCOVERY_SESSION_MAX_AGE_MS/)
  assert.match(discovery, /savedAt: Date\.now\(\)/)
  assert.doesNotMatch(discovery, /setPosts\(\[\]\)/)
  assert.doesNotMatch(discovery, /ForumDiscoveryCard key=\{index\}/)
  assert.doesNotMatch(discovery, /setInterval|SWR|mutate\(|addEventListener\(['"](?:focus|online|reconnect)/i)
})

test('小臣书详情收藏使用明确目标状态，重复请求不会反向切换', () => {
  const favoriteRoute = readFileSync('app/api/posts/[postId]/favorite/route.ts', 'utf8')
  const actions = readFileSync('components/PostActions.tsx', 'utf8')

  assert.match(favoriteRoute, /requireUser\(\)/)
  assert.match(favoriteRoute, /publicPostWhere/)
  assert.match(favoriteRoute, /requestedState/)
  assert.match(favoriteRoute, /postFavorite\.upsert/)
  assert.match(favoriteRoute, /postFavorite\.deleteMany/)
  assert.match(actions, /body: JSON\.stringify\(\{ isFavorited: nextFavorited \}\)/)
  assert.match(actions, /finally \{[\s\S]*setIsSubmitting\(false\)/)
})
test('recommendation seed is reproducible and recent ids stay bounded', () => {
  const ids = ['p1', 'p2', 'p3', 'p4']
  const rank = (seed: string) => [...ids].sort((left, right) => stableRecommendationWeight(seed, right) - stableRecommendationWeight(seed, left))
  assert.deepEqual(rank('seed-a'), rank('seed-a'))
  assert.notDeepEqual(rank('seed-a'), rank('seed-b'))
  assert.deepEqual(mergeRecentRecommendedPostIds(['p3', 'p2'], ['p4', 'p1', 'p3'], 3), ['p4', 'p1', 'p3'])
})

test('recommendation updates stay keyed by post id and interactions do not refresh the feed', () => {
  const discovery = readFileSync('components/ForumDiscoveryHome.tsx', 'utf8')
  const card = readFileSync('components/ForumDiscoveryCard.tsx', 'utf8')
  const actions = readFileSync('components/PostActions.tsx', 'utf8')
  const css = readFileSync('app/globals.css', 'utf8')
  assert.match(discovery, /appendUniqueDiscoveryPosts\(\[\], payload\.posts, true\)/)
  assert.match(discovery, /appendUniqueDiscoveryPosts\(currentPosts, incoming, reset\)/)
  assert.doesNotMatch(discovery, /new Map\(payload\.posts/)
  assert.match(discovery, /posts\.map\(\(post\) => post\.id\)/)
  assert.match(discovery, /ecfc:post-interaction/)
  assert.match(discovery, /ecfc:post-reply-count/)
  assert.match(discovery, /post\.id !== detail\.postId/)
  assert.match(discovery, /ForumDiscoveryCard key=\{post\.id\}/)
  assert.match(css, /@media \(max-width:767px\)[\s\S]*\.forum-discovery-grid \{[\s\S]*display:grid;[\s\S]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
  assert.doesNotMatch(css, /\.forum-discovery-grid\s*\{\s*column-count:2/)
  assert.match(card, /refreshOnSuccess=\{false\}/)
  assert.doesNotMatch(card, /useState\(post\)/)
  assert.match(card, /onLoad=\{\(event\) => setFit/)
  assert.match(actions, /post\.id === detail\.postId/)
})

test('E院广场桌面端和移动端都只保留小臣书，不依赖旧模式状态', () => {
  const home = readFileSync('components/ForumHome.tsx', 'utf8')
  const discovery = readFileSync('components/ForumDiscoveryHome.tsx', 'utf8')
  const detailController = readFileSync('components/ForumDiscoveryDetailController.tsx', 'utf8')
  const layout = readFileSync('app/layout.tsx', 'utf8')
  const css = readFileSync('app/globals.css', 'utf8')
  assert.match(home, /ForumDiscoveryHome/)
  assert.doesNotMatch(home, /plaza|localStorage|matchMedia|theme|\bviewMode\b|\blayoutMode\b/)
  assert.match(discovery, /<h1>小臣书<\/h1>/)
  assert.doesNotMatch(discovery, /showModeSwitch|onSwitchToPlaza|forum-discovery-mode-button|广场模式/)
  assert.match(detailController, /if \(media\.matches\) root\.dataset\.forumDetailDiscover = 'true'/)
  assert.match(layout, /dataset\.forumDetailDiscover='true'/)
  assert.doesNotMatch(layout, /ecfc-forum-theme|forumTheme/)
  assert.doesNotMatch(css, /forum-discovery-mode-button|forum-plaza-mode-button/)
})

test('旧广场模式 URL 只被忽略，不会恢复旧布局或触发模式重定向', () => {
  const page = readFileSync('app/forum/page.tsx', 'utf8')
  const home = readFileSync('components/ForumHome.tsx', 'utf8')
  const discovery = readFileSync('components/ForumDiscoveryHome.tsx', 'utf8')
  const layout = readFileSync('app/layout.tsx', 'utf8')

  assert.match(page, /<ForumHome \/>/)
  assert.match(home, /<ForumDiscoveryHome/)
  assert.doesNotMatch(home, /router|redirect|searchParams|view=square|mode=plaza|layout=grid|plaza/i)
  assert.doesNotMatch(discovery, /searchParams\.get\(['"](?:view|layout|displayMode|viewMode)['"]\)/)
  assert.doesNotMatch(discovery, /view=square|mode=plaza|layout=grid/)
  assert.doesNotMatch(layout, /ecfc-forum-theme|forumTheme/)
})
