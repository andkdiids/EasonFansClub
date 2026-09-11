import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { postCreateHref, postDetailHref } from '../lib/post-navigation'

const read = (path: string) => readFileSync(path, 'utf8')

test('新建帖子链接保留原始列表和分区来源', () => {
  const source = '/forum?board=daily-chat&sort=latest&query=%E6%AD%8C%E5%8D%95'
  const createUrl = new URL(postCreateHref('daily-chat', source), 'https://ecfc.fans')

  assert.equal(createUrl.pathname, '/posts/new')
  assert.equal(createUrl.searchParams.get('board'), 'daily-chat')
  assert.equal(createUrl.searchParams.get('returnTo'), source)
  assert.equal(new URL(postCreateHref(null, null), 'https://ecfc.fans').pathname, '/posts/new')
})

test('新建成功使用 replace，编辑流程仍使用已有 detail URL', () => {
  const form = read('components/PostCreateForm.tsx')
  const createPage = read('app/posts/new/page.tsx')
  const submittedPage = read('app/post/submitted/page.tsx')
  const discoveryHome = read('components/ForumDiscoveryHome.tsx')
  const homeModules = read('components/HomeModules.tsx')

  assert.match(createPage, /normalizePostReturnTo\(query\.returnTo\)/u)
  assert.match(createPage, /returnTo=\{returnTo\}/u)
  assert.match(discoveryHome, /postCreateHref\(activeBoard, discoveryReturnTo\)/u)
  assert.match(homeModules, /postCreateHref\(null, '\/'\)/u)
  assert.match(form, /returnTo\?: string \| null/u)
  assert.match(form, /router\.replace\(postDetailHref\(postId, returnTo\)\)/u)
  assert.doesNotMatch(form, /router\.push\(detailUrl\)/u)
  assert.doesNotMatch(form, /router\.refresh\(\)/u)
  assert.match(form, /router\.replace\(`\/post\/submitted\?/u)
  assert.match(submittedPage, /router\.replace\(target\)/u)
  assert.doesNotMatch(submittedPage, /router\.push\(target\)/u)

  const source = '/forum?board=daily-chat&mode=fish'
  const detailUrl = new URL(postDetailHref('post-1', source), 'https://ecfc.fans')
  assert.equal(detailUrl.searchParams.get('returnTo'), source)
})
