import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const detail = read('app/posts/[postId]/page.tsx')

test('帖子正文使用轻量主查询，关系数据不会再通过重型 include 阻塞正文', () => {
  const loadStart = detail.indexOf('async function loadPost(')
  const loadEnd = detail.indexOf('type PostDetailSupport', loadStart)
  assert.ok(loadStart >= 0 && loadEnd > loadStart)
  const loadSource = detail.slice(loadStart, loadEnd)

  assert.match(loadSource, /select: postCoreSelect/)
  assert.doesNotMatch(loadSource, /include:/)
  assert.doesNotMatch(loadSource, /PostFavorite|PostMedia|Like:/)
  assert.doesNotMatch(loadSource, /phone|email|passwordHash|username|role/)
  assert.match(detail, /async function loadPostSupport\(post: PostCore, userId\?: string \| null\)/)
  assert.match(detail, /Promise\.allSettled\(\[/)
  assert.match(detail, /take: 10[\s\S]{0,160}select: postLikeSelect/)
  assert.match(detail, /const postMediaSelect = \{ id: true, url: true \}/)
})

test('公共帖子不被 session、权限、勋章或互动状态读取失败拖垮', () => {
  assert.match(detail, /let user: Awaited<ReturnType<typeof getCurrentUser>> = null[\s\S]*?try \{[\s\S]*?user = await getCurrentUser\(\)[\s\S]*?catch \(error\)/)
  assert.match(detail, /channel: 'current-user'/)
  assert.match(detail, /async function loadPostAdminPermission\(/)
  assert.match(detail, /channel: 'permission'/)
  assert.match(detail, /let equippedBadgeMap: Awaited<ReturnType<typeof getEquippedBadgesForUsers>> = new Map\(\)/)
  assert.match(detail, /'engagement'/)
  assert.match(detail, /const \[viewerPostLike, viewerReplyLikes\] = await Promise\.allSettled\(/)
})

test('主查询 null 走 404，数据库异常保留可重试的详情错误页', () => {
  assert.match(detail, /if \(postCore === null\) \{\s*notFound\(\)/)
  assert.match(detail, /return <PostLoadFallback postId=\{postId\} databaseUnavailable=\{isDatabasePostDetailError\(error\)} \/>/)
  assert.match(detail, /operation: 'post\.findUnique'/)
  assert.match(detail, /errorCode/)
  assert.match(detail, /isRetryableDatabaseConnectionError\(error\)/)
  assert.match(detail, /isDatabasePostDetailError\(error\)/)
  assert.match(detail, /const transientRetryDelayMs = 150/)
  assert.match(detail, /return query\(2\)/)
})

test('评论和焦点回复失败只影响评论区，焦点线程只按可见根节点遍历', () => {
  assert.match(detail, /channel: 'comments'/)
  assert.match(detail, /commentsLoadError = true/)
  assert.match(detail, /channel: 'focused-reply'/)
  assert.match(detail, /async function loadVisibleReplyDescendants\(/)
  assert.match(detail, /parentId: \{ in: frontier \}/)
  assert.doesNotMatch(detail, /parentId: \{ not: null \}/)
})

test('错误日志只记录帖子读取上下文，不把原始异常对象直接输出', () => {
  assert.match(detail, /console\.error\(`\[post\.\$\{channel\}\.load\.error\]`/)
  assert.match(detail, /durationMs: Date\.now\(\) - startedAt/)
  assert.match(detail, /\.\.\.postDetailErrorInfo\(error\)/)
  assert.doesNotMatch(detail, /console\.(?:error|warn)\([^\n]*\{[^\n]*error\s*\}/)
})
