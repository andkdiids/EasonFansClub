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

test('首页精选限制六篇并使用容器响应式一至三列 Grid', () => {
  const data = readFileSync('lib/home-data.ts', 'utf8')
  const surface = readFileSync('components/HomeLayoutSurface.tsx', 'utf8')
  assert.match(data, /selected\.size < 6/)
  assert.match(data, /slice\(0, 6\)/)
  assert.match(surface, /posts\.data\.slice\(0, 6\)/)
  assert.match(surface, /grid-cols-1 gap-4 @\[42rem\]:grid-cols-2 @\[72rem\]:grid-cols-3/)
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
