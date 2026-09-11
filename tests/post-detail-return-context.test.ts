import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { normalizePostReturnTo, postDetailHref } from '@/lib/post-navigation'

const read = (path: string) => readFileSync(path, 'utf8')

test('帖子详情链接保留个人主页、广场和其他列表的来源上下文', () => {
  const sources = [
    '/profile',
    '/user/00042?module=posts&page=2&groupId=group-a',
    '/forum?board=chitchat&sort=latest',
    '/salon?category=CONCERT&sort=popular',
  ]

  for (const source of sources) {
    const detailUrl = new URL(postDetailHref('post-1', source), 'https://ecfc.fans')
    assert.equal(detailUrl.pathname, '/posts/post-1')
    assert.equal(detailUrl.searchParams.get('returnTo'), source)
  }
})

test('详情来源只接受站内路径，异常来源安全回退', () => {
  assert.equal(normalizePostReturnTo('https://evil.example/steal'), null)
  assert.equal(normalizePostReturnTo('//evil.example/steal'), null)
  assert.equal(normalizePostReturnTo('/api/users/me'), null)
  assert.equal(normalizePostReturnTo('/posts/another-post'), null)
  assert.equal(new URL(postDetailHref('post-1', null), 'https://ecfc.fans').pathname, '/posts/post-1')
})

test('主要帖子列表入口统一使用来源感知的详情链接', () => {
  const profile = read('components/PublicUserModules.tsx')
  const home = read('components/HomeModules.tsx')
  const search = read('app/search/page.tsx')
  const trending = read('app/trending/page.tsx')
  const postList = read('components/PostList.tsx')

  assert.match(profile, /postDetailHref\(post\.id, postReturnTo\)/)
  assert.match(profile, /postDetailHref\(reply\.post\.id, postReturnTo\)/)
  assert.match(profile, /postDetailHref\(item\.post\.id, postReturnTo\)/)
  assert.match(home, /postDetailHref\(post\.id, '\/'\)/)
  assert.match(search, /postDetailHref\(post\.id, searchHref\(q, postPagination\.page\)\)/)
  assert.match(trending, /postDetailHref\(post\.id, rangeHref\(range, page\)\)/)
  assert.match(postList, /postDetailHref\(post\.id, returnTo\)/)
})

test('详情返回顺序为显式来源、浏览器历史、分区安全回退', () => {
  const topbar = read('components/ForumDiscoveryDetailTopbar.tsx')
  const detail = read('app/posts/[postId]/page.tsx')

  assert.match(topbar, /if \(backHref\)[\s\S]*router\.replace\(backHref\)/)
  assert.match(topbar, /window\.history\.length > 1[\s\S]*router\.back\(\)/)
  assert.match(topbar, /router\.push\(fallbackHref\)/)
  assert.match(detail, /backHref=\{returnTo \|\| undefined\}/)
  assert.match(detail, /fallbackHref=\{detailFallbackHref\}/)
})

test('沙龙作品列表已有来源与滚动恢复语义，保持不回广场', () => {
  const salonHome = read('components/salon/SalonHome.tsx')
  const salonDetail = read('components/salon/SalonDetail.tsx')

  assert.match(salonHome, /new URLSearchParams\(\{ from: returnHref \}\)/)
  assert.match(salonDetail, /if \(!returnHref \|\| window\.history\.length <= 1/)
  assert.match(salonDetail, /router\.back\(\)/)
})
