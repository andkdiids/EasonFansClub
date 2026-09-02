import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildForumDiscoveryTabs } from '../lib/forum-discovery'
import { appendMissingDefaultForumBoards, BARD_BOARD_NAME, BARD_BOARD_SLUG, DAILY_CHAT_BOARD_SLUG, DAILY_CHAT_DISPLAY_NAME, defaultBoards, getForumBoardDisplayName } from '../lib/boards'
import { MAX_CONTENT_IMAGES } from '../lib/content-images'

const read = (path: string) => readFileSync(path, 'utf8')

test('小臣书分类固定为全部、公告区、推荐、最新、热门，再接现有分区顺序', () => {
  const tabs = buildForumDiscoveryTabs([
    { slug: 'daily-chat', name: '吹水' },
    { slug: 'announcements', name: '旧公告名', isAnnouncement: true },
    { slug: 'concert', name: '演唱会' },
    { slug: 'material-trade', name: '物料交换' },
    { slug: 'bard', name: '吟游诗人' },
  ])

  assert.deepEqual(tabs.map((tab) => tab.value), ['all', 'announcements', 'recommend', 'latest', 'hot', 'daily-chat', 'concert', 'material-trade', 'bard'])
  assert.deepEqual(tabs.map((tab) => tab.label), ['全部', '公告区', '推荐', '最新', '热门', '吹水', '演唱会', '物料交换', '吟游诗人'])
})

test('论坛分区改名保留 daily-chat slug，并新增吟游诗人默认分区', () => {
  assert.equal(getForumBoardDisplayName({ slug: DAILY_CHAT_BOARD_SLUG, name: '日常吹水' }), DAILY_CHAT_DISPLAY_NAME)
  assert.equal(getForumBoardDisplayName({ slug: DAILY_CHAT_BOARD_SLUG, name: DAILY_CHAT_DISPLAY_NAME }), DAILY_CHAT_DISPLAY_NAME)
  assert.equal(BARD_BOARD_SLUG, 'bard')
  assert.equal(BARD_BOARD_NAME, '吟游诗人')
  assert.deepEqual(
    defaultBoards.map((board) => ({ name: board.name, slug: board.slug })),
    [
      { name: '公告区', slug: 'announcements' },
      { name: DAILY_CHAT_DISPLAY_NAME, slug: DAILY_CHAT_BOARD_SLUG },
      { name: '演唱会', slug: 'concerts' },
      { name: '物料交换', slug: 'merch-exchange' },
      { name: BARD_BOARD_NAME, slug: BARD_BOARD_SLUG },
    ],
  )
})

test('广场分区入口从共享目录补齐缺失的吟游诗人，并保留发帖所需的稳定 slug', () => {
  const boards = appendMissingDefaultForumBoards([
    { id: 'chat', name: DAILY_CHAT_DISPLAY_NAME, slug: DAILY_CHAT_BOARD_SLUG },
  ])
  assert.deepEqual(boards.map((board) => ({ name: board.name, slug: board.slug })), [
    { name: DAILY_CHAT_DISPLAY_NAME, slug: DAILY_CHAT_BOARD_SLUG },
    { name: BARD_BOARD_NAME, slug: BARD_BOARD_SLUG },
  ])
  assert.match(read('app/api/forum/feed/route.ts'), /mergeForumBoardSummaries/)
  assert.match(read('app/api/forum/discover/route.ts'), /mergeForumBoardSummaries/)
  assert.match(read('app/posts/new/page.tsx'), /PostCreateForm boards=\{normalizeForumBoards\(boards\)\}/)
  assert.match(read('app/posts/[postId]/edit/page.tsx'), /boards=\{normalizeForumBoards\(boards\)\}/)
})

test('小臣书首页不显示模式切换入口，热门文案仍位于发现流顶部', () => {
  const home = read('components/ForumHome.tsx')
  const discovery = read('components/ForumDiscoveryHome.tsx')
  const replies = read('components/PostRepliesSection.tsx')
  const css = read('app/globals.css')

  assert.match(home, /ForumDiscoveryHome/)
  assert.doesNotMatch(home, /forum-hero-actions|forum-plaza-mode-button|切换到小臣书模式|forum-theme-switch-floating/)
  assert.match(discovery, /forum-discovery-header-actions/)
  assert.doesNotMatch(discovery, /forum-discovery-mode-button|切换到广场模式|onSwitchToPlaza/)
  assert.doesNotMatch(css, /forum-theme-switch-floating/)
  assert.doesNotMatch(css, /forum-discovery-mode-button|forum-plaza-mode-button/)
  assert.match(replies, /热门 #\{index \+ 1\}/)
  assert.doesNotMatch(replies, /热度最高|最高热度/)
})

test('发帖创建、编辑和上传器统一使用九张上限，并拒绝第十张', () => {
  const uploader = read('components/ContentImageUploader.tsx')
  const createForm = read('components/PostCreateForm.tsx')
  const editForm = read('components/PostEditForm.tsx')
  const createRoute = read('app/api/posts/route.ts')
  const editRoute = read('app/api/posts/[postId]/route.ts')

  assert.equal(MAX_CONTENT_IMAGES, 9)
  assert.match(uploader, /MAX_CONTENT_IMAGES/)
  assert.match(uploader, /existingCount/)
  assert.match(uploader, /已忽略超出的/)
  assert.match(createForm, /<ContentImageUploader value=\{imageUrls\}/)
  assert.match(editForm, /existingCount=\{keptCount\}/)
  assert.match(createRoute, /hasTooManyContentImages\(body\?\.imageUrls\)/)
  assert.match(createRoute, /status: 400/)
  assert.match(createRoute, /MAX_CONTENT_IMAGES/)
  assert.match(editRoute, /keptCount \+ addImageUrls\.length > MAX_CONTENT_IMAGES/)
  assert.match(editRoute, /keepMediaIds/)
  assert.doesNotMatch(editRoute, /keepMediaIds[\s\S]{0,240}slice\(0,\s*MAX_CONTENT_IMAGES\)/)
})

test('帖子详情按 sortOrder 返回一套多图 carousel，支持首尾、淡出、失败占位和邻图加载', () => {
  const api = read('app/api/posts/[postId]/route.ts')
  const detail = read('app/posts/[postId]/page.tsx')
  const carousel = read('components/PostMediaCarousel.tsx')
  const css = read('app/globals.css')

  assert.match(api, /PostMedia:[\s\S]*orderBy: \{ sortOrder: 'asc' \}/)
  assert.match(detail, /<PostMediaCarousel/)
  assert.match(carousel, /CONTROL_HIDE_DELAY_MS = 2_200/)
  assert.match(carousel, /scroll-snap-type|post-media-carousel-viewport/)
  assert.match(carousel, /onPointerDown/)
  assert.match(carousel, /onPointerMove/)
  assert.match(carousel, /currentIndex > 0/)
  assert.match(carousel, /currentIndex < items.length - 1/)
  assert.match(carousel, /failedImageIds/)
  assert.match(carousel, /loading=\{index <= currentIndex \+ 1 \? 'eager' : 'lazy'\}/)
  assert.match(css, /\.post-media-carousel-controls\.is-visible \{[^}]*opacity:1/)
  assert.match(css, /\.post-media-carousel-counter\.is-visible \{[^}]*opacity:1/)
  assert.match(css, /transition:opacity \.35s ease/)
  assert.match(css, /object-fit:contain/)
})

test('移动端回复 Bottom Sheet、textarea、action row 和贴纸面板都受 viewport 宽度约束', () => {
  const css = read('app/globals.css')
  const sheet = read('components/PostReplyBottomSheet.tsx')

  assert.match(sheet, /post-reply-bottom-sheet/)
  assert.match(css, /\.post-reply-bottom-sheet \{[^}]*width:100%; max-width:100%; min-width:0; box-sizing:border-box/)
  assert.match(css, /\.post-reply-bottom-sheet-header \{[^}]*width:100%; max-width:100%; min-width:0/)
  assert.match(css, /\.post-reply-bottom-sheet \.post-reply-form \{[^}]*width:100%; max-width:100%; min-width:0; box-sizing:border-box/)
  assert.match(css, /\.post-reply-bottom-sheet \.post-reply-form label,[\s\S]*textarea \{ width:100%; max-width:100%; min-width:0; box-sizing:border-box; \}/)
  assert.match(css, /post-reply-bottom-sheet \.post-reply-form > \.relative\.mt-3 \{ display:flex; width:100%; max-width:100%; min-width:0/)
  assert.match(css, /safe-area-inset-left/)
  assert.match(css, /safe-area-inset-right/)
  assert.doesNotMatch(css, /post-reply-bottom-sheet[^}]*?(?<!max-)width:100vw/)
})
