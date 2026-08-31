import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  BARD_BOARD_NAME,
  BARD_BOARD_SLUG,
  getForumBoardDisplayName,
  mergeForumBoardOptions,
} from '../lib/boards'

const read = (path: string) => readFileSync(path, 'utf8')

test('发布、编辑和广场使用同一目录，并补齐缺失的吟游诗人选项', () => {
  const options = mergeForumBoardOptions([
    { id: 'announcements', name: '公告区', slug: 'announcements' },
    { id: 'chat', name: '吹水', slug: 'daily-chat' },
    { id: 'concerts', name: '演唱会', slug: 'concerts' },
    { id: 'merch', name: '物料交换', slug: 'merch-exchange' },
  ])

  assert.deepEqual(options.map((board) => ({ id: board.id, name: board.name, slug: board.slug })), [
    { id: 'announcements', name: '公告区', slug: 'announcements' },
    { id: 'chat', name: '吹水', slug: 'daily-chat' },
    { id: 'concerts', name: '演唱会', slug: 'concerts' },
    { id: 'merch', name: '物料交换', slug: 'merch-exchange' },
    { id: `configured:${BARD_BOARD_SLUG}`, name: BARD_BOARD_NAME, slug: BARD_BOARD_SLUG },
  ])
  assert.equal(getForumBoardDisplayName({ name: BARD_BOARD_SLUG, slug: BARD_BOARD_SLUG }), BARD_BOARD_NAME)

  const createPage = read('app/posts/new/page.tsx')
  const editPage = read('app/posts/[postId]/edit/page.tsx')
  assert.match(createPage, /mergeForumBoardOptions\(boardRows\)/)
  assert.match(editPage, /mergeForumBoardOptions\(boardRows\)/)
  assert.match(createPage, /PostCreateForm boards=\{normalizeForumBoards\(boards\)\}/)
  assert.match(editPage, /boards=\{normalizeForumBoards\(boards\)\}/)
})

test('发布 API 将配置选项解析成真实 Board，并保留公告区权限', () => {
  const route = read('app/api/posts/route.ts')
  assert.match(route, /getConfiguredForumBoardBySelectionId\(input\.boardId\)/)
  assert.match(route, /prisma\.board\.upsert\(/)
  assert.match(route, /boardId: board\.id/)
  assert.match(route, /board\.slug === 'announcements' && !await hasAdminPermission\(user, 'post_manage'\)/)
  assert.match(route, /runPostCreateSideEffect\('board-counter'[\s\S]*?where: \{ id: board\.id \}/)
})

test('编辑 API 支持两个方向切换且始终把真实 Board ID 写入帖子', () => {
  const route = read('app/api/posts/[postId]/route.ts')
  assert.match(route, /getConfiguredForumBoardBySelectionId\(boardSelectionId\)/)
  assert.match(route, /prisma\.board\.upsert\(/)
  assert.match(route, /const nextBoardId = board\.id/)
  assert.match(route, /boardId: nextBoardId/)
  assert.match(route, /lockedExisting\.boardId, nextBoardId/)
  assert.match(route, /board\.slug === 'announcements' && !canManagePosts/)
})

test('板块名称在广场、详情、后台和分享卡中都走统一显示映射', () => {
  assert.match(read('app/api/forum/feed/route.ts'), /mergeForumBoardSummaries\(boardRows\)/)
  assert.match(read('app/api/forum/discover/route.ts'), /mergeForumBoardSummaries\(boardRows\)/)
  assert.match(read('app/api/boards/route.ts'), /mergeForumBoardSummaries\(boardRows\)/)
  assert.match(read('app/posts/[postId]/page.tsx'), /getForumBoardDisplayName\(post\.Board\)/)
  assert.match(read('app/admin/posts/review/page.tsx'), /getForumBoardDisplayName\(post\.Board\)/)
  assert.match(read('lib/share-card-service.ts'), /getForumBoardDisplayName\(post\.Board\)/)
  assert.match(read('lib/share-card-layout.ts'), /getForumBoardDisplayName\(\{ slug: normalizedValue, name: normalizedValue \}\)/)
})
