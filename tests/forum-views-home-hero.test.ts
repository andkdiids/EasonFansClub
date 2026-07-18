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

test('首页精选限制四篇并固定为响应式两列 Grid', () => {
  const data = readFileSync('lib/home-data.ts', 'utf8')
  const surface = readFileSync('components/HomeLayoutSurface.tsx', 'utf8')
  assert.match(data, /selected\.size < 4/)
  assert.match(data, /slice\(0, 4\)/)
  assert.match(surface, /posts\.data\.slice\(0, 4\)/)
  assert.match(surface, /grid grid-cols-1 items-start gap-3\.5 md:grid-cols-2/)
})

test('首页精选卡片自然高度、整卡可点击且独立点赞不会触发跳转', () => {
  const surface = readFileSync('components/HomeLayoutSurface.tsx', 'utf8')
  const actions = readFileSync('components/PostActions.tsx', 'utf8')
  const cardSection = surface.slice(surface.indexOf("item.key === 'home.featuredPosts'"), surface.indexOf("item.key === 'home.dailyMessages'"))
  const article = cardSection.slice(cardSection.indexOf('<article data-featured-post-card'), cardSection.indexOf('</article>'))
  assert.match(cardSection, /data-featured-post-card/)
  assert.match(cardSection, /data-post-card-link[\s\S]*absolute inset-0 z-\[1\]/)
  assert.match(cardSection, /focus-visible:ring-2/)
  assert.match(cardSection, /post\.content\.trim\(\) \? <p/)
  assert.match(cardSection, /pointer-events-none relative z-\[2\]/)
  assert.match(cardSection, /data-post-like-control[\s\S]*pointer-events-auto relative z-\[3\]/)
  assert.doesNotMatch(article, /min-h-(?:52|\[)|mt-auto|h-full|justify-between/)
  assert.match(actions, /event\.preventDefault\(\)/)
  assert.match(actions, /event\.stopPropagation\(\)/)
  assert.match(actions, /void toggleLike\(\)/)
})

test('用户菜单层级高于卡片交互且搜索弹窗保持最高层', () => {
  const surface = readFileSync('components/HomeLayoutSurface.tsx', 'utf8')
  const header = readFileSync('components/SiteHeaderFrame.tsx', 'utf8')
  const menu = readFileSync('components/UserNotificationMenu.tsx', 'utf8')
  const carousel = readFileSync('components/music/MusicAlbumCarousel.tsx', 'utf8')
  const search = readFileSync('components/music/MusicSearchDialog.tsx', 'utf8')
  assert.match(surface, /data-post-like-control[\s\S]*z-\[3\]/)
  assert.match(header, /z-\[100\]/)
  assert.match(menu, /data-user-menu[\s\S]*z-\[200\]/)
  assert.match(menu, /data-user-menu-panel[\s\S]*pointer-events-auto/)
  assert.match(carousel, /isolate z-0/)
  assert.match(search, /z-\[10000\]/)
  assert.doesNotMatch(surface, /data-post-like-control[^\n]*(?:z-50|z-\[100\]|z-\[999\])/)
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
