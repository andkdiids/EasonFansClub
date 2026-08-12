import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('论坛列表接口不返回正文摘要或媒体字段', () => {
  const route = read('app/api/forum/feed/route.ts')

  assert.doesNotMatch(route, /summary:\s*true/)
  assert.doesNotMatch(route, /content:\s*true/)
  assert.doesNotMatch(route, /sticker:\s*\{/)
  assert.doesNotMatch(route, /excerptForumPost/)
  assert.doesNotMatch(route, /stickerUrl/)
  assert.match(route, /title:\s*true/)
  assert.match(route, /likeCount:\s*true/)
  assert.match(route, /Like:\s*\{/)
})

test('论坛列表卡片只渲染标题、作者、时间和互动信息', () => {
  const postList = read('components/PostList.tsx')
  const css = read('app/globals.css')

  assert.doesNotMatch(postList, /post\.content/)
  assert.doesNotMatch(postList, /post\.stickerUrl/)
  assert.doesNotMatch(postList, /<img\b/)
  assert.match(postList, /post\.title/)
  assert.match(postList, /post\.author/)
  assert.match(postList, /formatDate\(/)
  assert.match(postList, /post\.viewCount/)
  assert.match(postList, /post\.replyCount/)
  assert.match(postList, /<LikeButton/)
  assert.match(css, /\.post-list-item \{[^}]*padding:16px 20px/)
  assert.match(css, /\.post-list-footer \{[^}]*margin-top:10px/)
  assert.match(css, /@media \(max-width:767px\)[\s\S]*\.post-list-item \{ padding:14px 16px; \}/)
})
