import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildForumHref, getForumOffset, getForumTotalPages } from '../lib/forum'
import { createPostViewKey, parsePostViewHistory, recordPostView, serializePostViewHistory, shouldCountPostView } from '../lib/post-views'
import { defaultSiteAppearance, mergeSiteAppearanceConfig } from '../lib/site-config'

test('论坛总数、总页数与第二页 offset 使用数据库分页语义', () => {
  assert.equal(getForumTotalPages(41, 20), 3)
  assert.equal(getForumOffset(1, 20), 0)
  assert.equal(getForumOffset(2, 20), 20)
  const ids = Array.from({ length: 41 }, (_, index) => `post-${index + 1}`)
  assert.notDeepEqual(ids.slice(getForumOffset(1, 20), 20), ids.slice(getForumOffset(2, 20), 40))
  const route = readFileSync('app/api/forum/feed/route.ts', 'utf8')
  assert.match(route, /tx\.post\.count\(\{ where \}\)/)
  assert.match(route, /total,\s*totalPages,\s*page,/)
})

test('论坛分页 href 保留筛选条件且切换筛选可回到第一页', () => {
  assert.equal(
    buildForumHref('/forum', 'board=daily-chat&sort=most-replies&query=Eason', { page: 2 }),
    '/forum?board=daily-chat&sort=most-replies&query=Eason&page=2',
  )
  assert.equal(buildForumHref('/forum', 'board=daily-chat&page=2', { board: 'concert', page: null }), '/forum?board=concert')
})

test('浏览量首次访问计数、短期重复去重且不同用户分别计数', () => {
  const now = Date.parse('2026-07-17T12:00:00+08:00')
  const firstUser = createPostViewKey('post-1', 'user:first')
  const secondUser = createPostViewKey('post-1', 'user:second')
  const history = recordPostView({}, firstUser, now)
  assert.equal(shouldCountPostView({}, firstUser, now), true)
  assert.equal(shouldCountPostView(history, firstUser, now + 60_000), false)
  assert.equal(shouldCountPostView(history, secondUser, now + 60_000), true)
  assert.deepEqual(parsePostViewHistory(serializePostViewHistory(history), now + 60_000), history)
})

test('详情真实挂载调用计数接口且列表、首页、详情统一读取 viewCount', () => {
  const tracker = readFileSync('components/PostViewCounter.tsx', 'utf8')
  const detail = readFileSync('app/posts/[postId]/page.tsx', 'utf8')
  const forum = readFileSync('app/api/forum/feed/route.ts', 'utf8')
  const home = readFileSync('lib/home-data.ts', 'utf8')
  assert.match(tracker, /method: 'POST'/)
  assert.match(detail, /PostViewCounter postId=\{post\.id\} initialCount=\{post\.viewCount\}/)
  assert.match(forum, /viewCount: true/)
  assert.match(home, /viewCount: true/)
})

test('社区首页移除旧精选与热门演唱会模块，并使用当前首页数据模块', () => {
  const api = readFileSync('app/api/home/route.ts', 'utf8')
  const surface = readFileSync('components/HomeLayoutSurface.tsx', 'utf8')
  assert.doesNotMatch(surface, /data\.posts|data\.concerts|精选帖子|热门演唱会|home-concerts-section/)
  assert.doesNotMatch(api, /getHomePosts|getHomeConcerts|posts:|concerts:/)
  assert.match(api, /getHomeActivities\(\)/)
  assert.match(api, /getHomeAnywhereDoorLatest\(\)/)
  assert.match(surface, /home-activities-section/)
  assert.match(surface, /home-anywhere-door-section/)
  assert.match(surface, /home-albums-section/)
})

test('首页当前内容模块使用各自的整卡入口，不保留旧精选卡片层级', () => {
  const surface = readFileSync('components/HomeLayoutSurface.tsx', 'utf8')
  assert.match(surface, /home-activity-card/)
  assert.match(surface, /href=\{`\/activities\/\$\{activity\.id\}`\}/)
  assert.match(surface, /home-anywhere-door-item/)
  assert.match(surface, /href=\{data\.anywhereDoor\.href\}/)
  assert.match(surface, /home-album-link/)
  assert.doesNotMatch(surface, /data-featured-post-card|data-post-card-link|post-row-link|data-post-like-control/)
})

test('用户菜单层级高于当前首页交互且搜索弹窗保持最高层', () => {
  const surface = readFileSync('components/HomeLayoutSurface.tsx', 'utf8')
  const header = readFileSync('components/SiteHeaderFrame.tsx', 'utf8')
  const menu = readFileSync('components/UserNotificationMenu.tsx', 'utf8')
  const carousel = readFileSync('components/music/MusicAlbumCarousel.tsx', 'utf8')
  const search = readFileSync('components/music/MusicSearchDialog.tsx', 'utf8')
  assert.match(header, /z-\[var\(--layer-sticky\)\]/)
  assert.match(menu, /data-user-menu[\s\S]*z-\[var\(--layer-popover\)\]/)
  assert.match(menu, /data-user-menu-panel[\s\S]*pointer-events-auto/)
  assert.match(carousel, /isolate z-0/)
  assert.match(search, /z-\[var\(--layer-dialog\)\]/)
  assert.match(surface, /home-daily-music-panel/)
})

test('Hero 默认样式美观且合法后台枚举映射到前台', () => {
  assert.deepEqual(defaultSiteAppearance.heroStyle, {
    titleSize: 'large', descriptionSize: 'medium', buttonSize: 'medium', height: 'standard', radius: 'large',
  })
  const config = mergeSiteAppearanceConfig({ heroStyle: { titleSize: 'extra-large', descriptionSize: 'large', buttonSize: 'large', height: 'spacious', radius: 'medium' } })
  assert.equal(config.heroStyle.titleSize, 'extra-large')
  assert.equal(config.heroStyle.height, 'spacious')
  const hero = readFileSync('components/HomeHero.tsx', 'utf8')
  assert.match(hero, /styleConfig\.titleSize/)
  assert.match(hero, /data-hero-height=\{styleConfig\.height\}/)
})

test('非法 Hero 样式配置回退默认值，不能注入任意 CSS', () => {
  const config = mergeSiteAppearanceConfig({ heroStyle: { titleSize: 'fixed;inset:0', descriptionSize: 'huge', buttonSize: 'raw-css', height: '1px', radius: '0' } })
  assert.deepEqual(config.heroStyle, defaultSiteAppearance.heroStyle)
})

test('登录后前台由根布局统一渲染 AppShell 且首页不再复制外壳', () => {
  const rootLayout = readFileSync('app/layout.tsx', 'utf8')
  const appShell = readFileSync('components/layout/AppShell.tsx', 'utf8')
  const home = readFileSync('components/HomeLayoutSurface.tsx', 'utf8')
  const forum = readFileSync('app/forum/page.tsx', 'utf8')
  const music = readFileSync('app/music/page.tsx', 'utf8')
  assert.match(rootLayout, /<AppShell[\s\S]*\{children\}[\s\S]*<\/AppShell>/)
  assert.match(appShell, /<Sidebar[\s\S]*<Topbar[\s\S]*app-page-content[\s\S]*<MobileNavigation/)
  assert.doesNotMatch(home, /community-sidebar|community-mobile-nav|community-hero-actions/)
  assert.doesNotMatch(forum, /SiteHeader/)
  assert.doesNotMatch(music, /SiteHeader/)
})

test('统一侧栏对子路由和详情页保持父菜单高亮', async () => {
  const { isAppNavigationActive, primaryNavigation } = await import('../components/layout/navigation')
  const forum = primaryNavigation.find((item) => item.href === '/forum')!
  const music = primaryNavigation.find((item) => item.href === '/music')!
  const profile = primaryNavigation.find((item) => item.href === '/profile')!
  assert.equal(isAppNavigationActive('/posts/post-1', forum), true)
  assert.equal(isAppNavigationActive('/music/album/album-1', music), true)
  assert.equal(isAppNavigationActive('/user/00001', profile), true)
  assert.equal(isAppNavigationActive('/forum', music), false)
})
