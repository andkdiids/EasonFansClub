import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { appendUniqueDiscoveryPosts } from '../lib/forum-discovery'
import {
  FORUM_DISCOVERY_SESSION_PREFIX,
  evictForumDiscoveryFeedSessions,
  forumFeedAffectedByChange,
  forumFeedSessionBoardParam,
  shouldEvictForumFeedSession,
  type SessionStorageLike,
} from '../lib/forum-discovery-session'

function read(relativePath: string) {
  return readFileSync(relativePath, 'utf8')
}

class FakeSessionStorage implements SessionStorageLike {
  private readonly store = new Map<string, string>()

  constructor(entries: Record<string, string>) {
    for (const [key, value] of Object.entries(entries)) this.store.set(key, value)
  }

  get length() {
    return this.store.size
  }

  key(index: number) {
    return [...this.store.keys()][index] ?? null
  }

  getItem(key: string) {
    return this.store.get(key) ?? null
  }

  removeItem(key: string) {
    this.store.delete(key)
  }

  remainingKeys() {
    return [...this.store.keys()].sort()
  }
}

const sessionKeys = (board: string | null) =>
  FORUM_DISCOVERY_SESSION_PREFIX + '/forum' + (board ? `?board=${board}` : '')

test('CASE 4/5/6 快照失效判定：无分区(全部/最新) 与 旧/新分区 都会命中，其他分区保留', () => {
  assert.equal(shouldEvictForumFeedSession(null, 'A', 'B'), true)
  assert.equal(shouldEvictForumFeedSession('', 'A', 'B'), true)
  assert.equal(shouldEvictForumFeedSession('all', 'A', 'B'), true)
  assert.equal(shouldEvictForumFeedSession('A', 'A', 'B'), true)
  assert.equal(shouldEvictForumFeedSession('B', 'A', 'B'), true)
  assert.equal(shouldEvictForumFeedSession('C', 'A', 'B'), false)
  assert.equal(forumFeedSessionBoardParam('/forum?board=C'), 'C')
  assert.equal(forumFeedSessionBoardParam('/forum?board='), '')
})

test('CASE 4/5/8 编辑 A→B 后 sessionStorage 快照被清理（旧 A、新 B、无分区都清除）', () => {
  const storage = new FakeSessionStorage({
    [sessionKeys(null)]: '{"posts":[]}',
    [sessionKeys('all')]: '{"posts":[]}',
    [sessionKeys('A')]: '{"posts":[{"id":"p1"}]}',
    [sessionKeys('B')]: '{"posts":[]}',
    [sessionKeys('C')]: '{"posts":[{"id":"p1"}]}',
    'other-key': '{}',
  })
  const removed = evictForumDiscoveryFeedSessions({ postId: 'p1', boardFrom: 'A', boardTo: 'B' }, storage)
  assert.equal(removed, 4)
  assert.deepEqual(storage.remainingKeys(), [sessionKeys('C'), 'other-key'])
})

test('CASE 2/9 当前 feed 是否需要立即刷新：无分区或命中旧/新分区才刷新', () => {
  const change = { postId: 'p1', boardFrom: 'A', boardTo: 'B' }
  assert.equal(forumFeedAffectedByChange('', change), true)
  assert.equal(forumFeedAffectedByChange('all', change), true)
  assert.equal(forumFeedAffectedByChange('A', change), true)
  assert.equal(forumFeedAffectedByChange('B', change), true)
  assert.equal(forumFeedAffectedByChange('C', change), false)
})

test('CASE 6/8 feed 合并始终按帖子 id 去重（移动分区不产生第二行）', () => {
  const row = { id: 'p1', board: { slug: 'A' } }
  const merged = appendUniqueDiscoveryPosts([row], [{ ...row, board: { slug: 'B' } }], false)
  assert.equal(merged.length, 1)
  assert.equal(merged[0].id, 'p1')
})

test('CASE 1 Post 模型只有单一真实分区字段 boardId，无 category/section 冗余快照列', () => {
  const schema = read('prisma/schema.prisma')
  const postModel = schema.slice(schema.indexOf('model Post {'), schema.indexOf('\n}', schema.indexOf('model Post {')))
  assert.match(postModel, /boardId\s+String/)
  assert.doesNotMatch(postModel, /^\s{2}(section|forumSection|category|categoryLabel|boardSnapshot|cachedSection)\b/m)
})

test('CASE 2/3 编辑 API 用单一真实字段 boardId 更新；详情读实时 Board 关系', () => {
  const route = read('app/api/posts/[postId]/route.ts')
  // handleEditPost 事务更新：boardId: nextBoardId（A→B 直接写 Post.boardId）
  assert.match(route, /boardId:\s*nextBoardId/)
  // 详情每次动态读库，board 由 Board 关系实时解析（显示 B）
  assert.match(route, /board:\s*withForumBoardDisplayName\(Board\)/)
})

test('CASE 4/5 编辑保存成功后，前端通知并清理 feed 快照（含旧/新分区 slug）', () => {
  const form = read('components/PostEditForm.tsx')
  assert.match(form, /notifyForumDiscoveryFeedChanged/)
  assert.match(form, /boardId !== initialBoardId/)
  assert.match(form, /boardFrom:\s*slugOf\(initialBoardId\)/)
  assert.match(form, /boardTo:\s*slugOf\(boardId\)/)
})

test('CASE 8/9 挂载中的 feed 订阅“分区变更”事件并整页刷新（旧行先移除）', () => {
  const home = read('components/ForumDiscoveryHome.tsx')
  assert.match(home, /FORUM_DISCOVERY_FEED_CHANGED_EVENT/)
  assert.match(home, /forumFeedAffectedByChange\(boardValue,\s*detail\)/)
  assert.match(home, /current\.filter\(\(post\)\s*=>\s*post\.id\s*!==\s*detail\.postId\)/)
  assert.match(home, /void refresh\(false\)/)
})

test('CASE 8/9 分区列表与 discover feed 服务端恒动态（force-dynamic + no-store），无陈旧服务端缓存', () => {
  const discover = read('app/api/forum/discover/route.ts')
  const feed = read('app/api/forum/feed/route.ts')
  assert.match(discover, /export const dynamic = 'force-dynamic'/)
  assert.match(feed, /export const dynamic = 'force-dynamic'/)
  assert.match(discover, /'Cache-Control': 'private, no-store, max-age=0'/)
  // 列表过滤依据“当前数据库值”：configured 板块按 Board.slug、普通板块按 boardId 实时过滤
  assert.match(feed, /Board: \{ isActive: true, slug: selectedBoard\.slug \}/)
  assert.match(feed, /boardId: selectedBoard\.id/)
})

test('CASE 10 桌面/移动端共用同一刷新链路（事件监听不按 isDesktop 分流）', () => {
  const home = read('components/ForumDiscoveryHome.tsx')
  const listenerBlock = home.slice(home.indexOf('const onFeedChanged ='), home.indexOf('window.addEventListener(FORUM_DISCOVERY_FEED_CHANGED_EVENT'))
  assert.doesNotMatch(listenerBlock, /isDesktop/)
  assert.doesNotMatch(listenerBlock, /window\.location\.reload/)
})
