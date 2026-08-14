import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  canPinPostReply,
  clampPostReplyPage,
  getPostReplyOffset,
  getPostReplyOrderBy,
  getPostReplyTotalPages,
  parsePostReplySort,
} from '../lib/post-replies'

const read = (path: string) => readFileSync(path, 'utf8')
const pinRoute = read('app/api/replies/[replyId]/pin/route.ts')
const deleteRoute = read('app/api/replies/[replyId]/route.ts')
const detailPage = read('app/posts/[postId]/page.tsx')
const replySection = read('components/PostRepliesSection.tsx')
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

test('最新排序按 createdAt DESC、id DESC，最热排序按 likeCount/createdAt/id DESC', () => {
  assert.equal(parsePostReplySort(null), 'latest')
  assert.deepEqual(getPostReplyOrderBy('latest'), [{ createdAt: 'desc' }, { id: 'desc' }])
  assert.deepEqual(getPostReplyOrderBy('hot'), [{ likeCount: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }])

  const rows = [
    { id: 'a', createdAt: '2026-08-14T10:00:00.000Z', likeCount: 3 },
    { id: 'b', createdAt: '2026-08-14T12:00:00.000Z', likeCount: 18 },
    { id: 'c', createdAt: '2026-08-14T11:00:00.000Z', likeCount: 9 },
  ]
  assert.deepEqual([...rows].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((row) => row.id), ['b', 'c', 'a'])
  assert.deepEqual([...rows].sort((a, b) => b.likeCount - a.likeCount).map((row) => row.id), ['b', 'c', 'a'])
})

test('置顶评论单独查询，普通分页排除置顶并在数据库排序后 skip/take', () => {
  assert.match(detailPage, /isPinned: true/)
  assert.match(detailPage, /parentId: null, isPinned: false/)
  assert.ok(detailPage.includes('orderBy: getPostReplyOrderBy(sort)'))
  assert.ok(detailPage.includes('skip: getPostReplyOffset(page)'))
  assert.ok(detailPage.includes('take: POST_REPLY_PAGE_SIZE'))
  assert.ok(detailPage.includes('...(pinnedReply ? [pinnedReply] : [])'))
  assert.ok(detailPage.includes('...normalRoots'))
  assert.ok(detailPage.includes('parentId: { not: null }'))
  assert.equal(getPostReplyTotalPages(41, 20), 3)
  assert.equal(clampPostReplyPage(99, 3), 3)
  assert.equal(getPostReplyOffset(2, 20), 20)
})

test('评论区显示置顶标识、作者置顶按钮、最新/最热切换与服务端分页', () => {
  assert.ok(replySection.includes('reply.isPinned ? <span'))
  assert.ok(replySection.includes('canPinPostReply({ currentUserId, postAuthorId, parentId: reply.parentId })'))
  assert.ok(replySection.includes('togglePin(reply)'))
  assert.ok(replySection.includes('取消置顶'))
  assert.ok(replySection.includes("['latest', '最新']"))
  assert.ok(replySection.includes("['hot', '最热']"))
  assert.match(replySection, /<Pagination/)
})

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
