import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildPostReplyFloorMap,
  canPinPostReply,
  clampPostReplyPage,
  getCommentFloor,
  getPostReplyOffset,
  getPostReplyOrderBy,
  getPostReplyTotalPages,
  parsePostReplyDirection,
  parsePostReplySort,
  shouldScrollToPostRepliesTop,
  splitViewerPostReplyRoots,
} from '../lib/post-replies'

const read = (path: string) => readFileSync(path, 'utf8')
const pinRoute = read('app/api/replies/[replyId]/pin/route.ts')
const deleteRoute = read('app/api/replies/[replyId]/route.ts')
const detailPage = read('app/posts/[postId]/page.tsx')
const replySection = read('components/PostRepliesSection.tsx')
const replyApi = read('app/api/posts/[postId]/replies/route.ts')
const forumHome = read('components/ForumHome.tsx')
const forumFeed = read('app/api/forum/feed/route.ts')
const schema = read('prisma/schema.prisma')
const migration = read('prisma/migrations/20260814120000_add_reply_pinned/migration.sql')

test('只有当前帖子的发帖人可以置顶一级评论', () => {
  assert.equal(canPinPostReply({ currentUserId: 'author', postAuthorId: 'author', parentId: null }), true)
  assert.equal(canPinPostReply({ currentUserId: 'viewer', postAuthorId: 'author', parentId: null }), false)
  assert.equal(canPinPostReply({ currentUserId: 'other-post-author', postAuthorId: 'author', parentId: null }), false)
  assert.equal(canPinPostReply({ currentUserId: null, postAuthorId: 'author', parentId: null }), false)
  assert.equal(canPinPostReply({ currentUserId: 'author', postAuthorId: 'author', parentId: 'root-comment' }), false)
  assert.match(pinRoute, /const guard = await requireUser()/)
  assert.match(pinRoute, /reply.Post.authorId/)
  assert.match(pinRoute, /reply.parentId !== null/)
})

test('置顶接口在帖子事务锁内先清除旧置顶，再设置新置顶，并支持取消', () => {
  assert.match(pinRoute, /FOR UPDATE/)
  assert.match(pinRoute, /isPinned: true/)
  assert.match(pinRoute, /data: { isPinned: false }/)
  assert.match(pinRoute, /body.pinned/)
  assert.ok(pinRoute.includes("typeof body?.pinned !== 'boolean'"))
})

test('置顶状态由 Reply.isPinned 保存，删除整棵评论线程时清理状态', () => {
  assert.ok(schema.includes('model Reply {'))
  assert.match(schema, /isPinned\s+Boolean\s+@default\(false\)/)
  assert.ok(schema.includes('@@index([postId, isDeleted, isPinned])'))
  assert.match(migration, /ADD COLUMN `isPinned` BOOLEAN NOT NULL DEFAULT false/)
  assert.ok(deleteRoute.includes('data: { isDeleted: true, isPinned: false, deletedAt: new Date() }'))
})

test('楼层排序支持正序/倒序，最热使用点赞数和稳定次级排序', () => {
  assert.equal(parsePostReplySort(null), 'floor')
  assert.equal(parsePostReplySort('latest'), 'floor')
  assert.equal(parsePostReplySort('unknown'), 'floor')
  assert.equal(parsePostReplyDirection(null), 'asc')
  assert.equal(parsePostReplyDirection('desc'), 'desc')
  assert.equal(parsePostReplyDirection('asc', 'latest'), 'desc')
  assert.deepEqual(getPostReplyOrderBy('floor', 'asc'), [{ createdAt: 'asc' }, { id: 'asc' }])
  assert.deepEqual(getPostReplyOrderBy('floor', 'desc'), [{ createdAt: 'desc' }, { id: 'desc' }])
  assert.deepEqual(getPostReplyOrderBy('hot'), [{ likeCount: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }])

  const rows = [
    { id: 'a', createdAt: '2026-08-14T10:00:00.000Z', likeCount: 3 },
    { id: 'b', createdAt: '2026-08-14T12:00:00.000Z', likeCount: 18 },
    { id: 'c', createdAt: '2026-08-14T11:00:00.000Z', likeCount: 9 },
  ]
  assert.deepEqual([...rows].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((row) => row.id), ['a', 'c', 'b'])
  assert.deepEqual([...rows].sort((a, b) => b.likeCount - a.likeCount).map((row) => row.id), ['b', 'c', 'a'])
})

test('楼层按完整一级评论序列计算，分页/置顶/楼中楼不改变评论自身 floorNumber', () => {
  assert.equal(getCommentFloor({ page: 1, pageSize: 20, index: 0 }), 1)
  assert.equal(getCommentFloor({ page: 1, pageSize: 20, index: 19 }), 20)
  assert.equal(getCommentFloor({ page: 2, pageSize: 20, index: 0 }), 21)
  assert.equal(getCommentFloor({ page: 2, pageSize: 20, index: 19 }), 40)
  assert.equal(getCommentFloor({ page: 3, pageSize: 20, index: 0 }), 41)

  const floorMap = buildPostReplyFloorMap([
    { id: 'root-1' },
    { id: 'root-2' },
    { id: 'pinned-root' },
    { id: 'root-4' },
  ])
  assert.equal(floorMap.get('pinned-root'), 3)
  assert.equal(floorMap.get('root-4'), 4)
  const rootOnlyFloorMap = buildPostReplyFloorMap([
    { id: 'root', parentId: null },
    { id: 'reply', parentId: 'root' },
  ])
  assert.equal(rootOnlyFloorMap.get('root'), 1)
  assert.equal(rootOnlyFloorMap.get('reply'), undefined)

  const hundredFloorMap = buildPostReplyFloorMap(Array.from({ length: 100 }, (_, index) => ({ id: `root-${index + 1}` })))
  const descendingPageOne = [100, 99, 81].map((floor) => hundredFloorMap.get(`root-${floor}`))
  const descendingPageTwo = [80, 61].map((floor) => hundredFloorMap.get(`root-${floor}`))
  assert.deepEqual(descendingPageOne, [100, 99, 81])
  assert.deepEqual(descendingPageTwo, [80, 61])

  assert.match(detailPage, /orderBy: \[\{ createdAt: 'asc' \}, \{ id: 'asc' \}\]/)
  assert.match(detailPage, /parentId: null, isDeleted: false|isDeleted: false, parentId: null/)
  assert.ok(detailPage.includes('buildPostReplyFloorMap(canonicalRootReplies)'))
  assert.ok(detailPage.includes('floorNumber: reply.parentId === null'))
  assert.match(replyApi, /floorNumber = createdReply\.parentId === null/)
  assert.match(replyApi, /parentId: null,[\s\S]*createdAt: \{ lt: createdReply\.createdAt \}/)
  assert.doesNotMatch(replySection, /<span>#\{index \+ 1\} ·/)
})

test('置顶评论单独查询，普通分页排除置顶并在数据库排序后 skip/take', () => {
  assert.match(detailPage, /isPinned: true/)
  assert.match(detailPage, /parentId: null, isPinned: false/)
  assert.ok(detailPage.includes('orderBy: getPostReplyOrderBy(sort, direction)'))
  assert.ok(detailPage.includes('skip: getPostReplyOffset(page)'))
  assert.ok(detailPage.includes('take: POST_REPLY_PAGE_SIZE'))
  assert.ok(detailPage.includes('pageSize: POST_REPLY_PAGE_SIZE'))
  assert.ok(detailPage.includes('pagination:'))
  assert.ok(detailPage.includes('...(pinnedReply ? [pinnedReply] : [])'))
  assert.ok(detailPage.includes('...normalRoots'))
  assert.ok(detailPage.includes('parentId: { in: frontier }'))
  assert.doesNotMatch(detailPage, /parentId: \{ not: null \}/)
  assert.equal(getPostReplyTotalPages(41, 20), 3)
  assert.equal(clampPostReplyPage(99, 3), 3)
  assert.equal(getPostReplyOffset(2, 20), 20)
})

test('评论区只显示楼层方向和最热，排序/分页完成后回评论区顶部', () => {
  assert.ok(replySection.includes('reply.isPinned ? <span'))
  assert.ok(replySection.includes('canPinPostReply({ currentUserId, postAuthorId, parentId: reply.parentId })'))
  assert.ok(replySection.includes('togglePin(reply)'))
  assert.ok(replySection.includes('取消置顶'))
  assert.ok(replySection.includes("sort === 'floor'"))
  assert.ok(replySection.includes('楼层'))
  assert.ok(replySection.includes('最热'))
  assert.doesNotMatch(replySection, /最新/)
  assert.ok(replySection.includes("navigationReasonRef.current = 'pagination'"))
  assert.ok(replySection.includes("navigationReasonRef.current = 'sort'"))
  assert.ok(replySection.includes('shouldScrollToPostRepliesTop(reason, Boolean(focusId))'))
  assert.ok(replySection.includes('commentsTopRef.current?.scrollIntoView'))
  assert.ok(replySection.includes("params.delete('sort')"))
  assert.ok(replySection.includes("params.delete('focus')"))
  assert.ok(replySection.includes("params.delete('commentId')"))
  assert.ok(replySection.includes("params.delete('replyId')"))
  assert.ok(replySection.includes("params.set('commentSort', nextSort)"))
  assert.ok(replySection.includes("params.set('direction', nextDirection)"))
  assert.ok(replySection.includes('buildCommentHref(nextSort, nextDirection, 1)'))
  assert.ok(replySection.includes('post-replies-top'))
  const toggleLikeStart = replySection.indexOf('async function toggleLike')
  const toggleLikeEnd = replySection.indexOf('async function togglePin', toggleLikeStart)
  assert.doesNotMatch(replySection.slice(toggleLikeStart, toggleLikeEnd), /router\.refresh\(\)/)
  assert.match(replySection, /<Pagination/)
})

test('只有普通分页和排序会滚到评论顶部，目标评论/回复定位优先', () => {
  assert.equal(shouldScrollToPostRepliesTop('pagination', false), true)
  assert.equal(shouldScrollToPostRepliesTop('sort', false), true)
  assert.equal(shouldScrollToPostRepliesTop('pagination', true), false)
  assert.equal(shouldScrollToPostRepliesTop('sort', true), false)
  assert.equal(shouldScrollToPostRepliesTop('target-comment', false), false)
  assert.equal(shouldScrollToPostRepliesTop('target-reply', false), false)
  assert.equal(shouldScrollToPostRepliesTop(null, false), false)
})

test('当前用户的一级评论单独置顶，真实置顶不变且不会重复展示', () => {
  const pinned = { id: 'pinned', parentId: null, isPinned: true }
  const normal = { id: 'normal', parentId: null, isPinned: false }
  const myLatest = { id: 'my-latest', parentId: null, isPinned: false }
  const myPinned = { id: 'my-pinned', parentId: null, isPinned: true }
  const myNested = { id: 'my-nested', parentId: 'my-latest', isPinned: false }

  const result = splitViewerPostReplyRoots([pinned, myPinned, normal], [myLatest, myPinned, myNested, myLatest])
  assert.deepEqual(result.my.map((reply) => reply.id), ['my-latest', 'my-pinned'])
  assert.deepEqual(result.visible.map((reply) => reply.id), ['pinned', 'normal'])
  assert.deepEqual(result.pinned.map((reply) => reply.id), ['pinned'])
  assert.deepEqual(result.normal.map((reply) => reply.id), ['normal'])
  assert.equal(result.visible.some((reply) => reply.id === 'my-pinned'), false)
})

test('我的评论使用独立查询，不改变普通评论分页，未登录不查询', () => {
  assert.match(detailPage, /viewerId?: string \\| null/)
  assert.match(detailPage, /authorId: viewerId, isDeleted: false, parentId: null/)
  assert.ok(detailPage.includes('orderBy: [{ createdAt: \'desc\' }, { id: \'desc\' }]'))
  assert.ok(detailPage.includes('const childRootIds = Array.from(new Set([...rootIds, ...viewerRootIds]))'))
  assert.ok(detailPage.includes('const includedRootIds = new Set(rootIds)'))
  assert.ok(detailPage.includes('myRows:'))
  assert.ok(detailPage.includes('loadPostReplies(postId, commentSort, commentDirection, requestedCommentPage, user?.id)'))
  assert.ok(detailPage.includes('initialMyReplies={myReplyRows}'))
  assert.ok(detailPage.includes('direction={commentDirection}'))
  assert.ok(detailPage.includes('pagination={commentPagination}'))
  assert.ok(replySection.includes('initialMyReplies?: ReplyItem[]'))
  assert.ok(replySection.includes('你已经评论过这个帖子 · 查看我的评论'))
  assert.ok(replySection.includes('post-my-comments-${postId}'))
  assert.ok(replySection.includes('splitViewerPostReplyRoots(rootReplies, myReplies)'))
  assert.ok(replySection.includes('setMyReplies((current) => current.filter'))
  assert.equal(splitViewerPostReplyRoots([pinnedReplyFixture()], []).my.length, 0)
  assert.equal(getPostReplyTotalPages(41, 20), 3)
  assert.equal(getPostReplyOffset(2, 20), 20)
})

function pinnedReplyFixture() {
  return { id: 'pinned', parentId: null, isPinned: true }
}

test('E院广场搜索通过 form submit 复用同一搜索逻辑，并重置页码', () => {
  assert.ok(forumHome.includes('<form'))
  assert.ok(forumHome.includes('className="forum-search"'))
  assert.ok(forumHome.includes('onSubmit={(event) => {'))
  assert.ok(forumHome.includes('event.preventDefault()'))
  assert.ok(forumHome.includes('applySearch(searchValue)'))
  assert.ok(forumHome.includes('const normalized = value.trim()'))
  assert.ok(forumHome.includes('query: normalized || null, page: null'))
  assert.ok(forumHome.includes('enterKeyHint="search"'))
  assert.ok(forumHome.includes('searchComposingRef'))
  assert.ok(forumHome.includes('if (searchComposingRef.current) return'))
  assert.ok(forumFeed.includes('title: { contains: query }'))
  assert.ok(forumFeed.includes('summary: { contains: query }'))
})
