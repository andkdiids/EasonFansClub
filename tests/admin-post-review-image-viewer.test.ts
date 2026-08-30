import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const viewer = read('components/ImageViewer.tsx')
const reviewManager = read('app/admin/posts/review/PostReviewManager.tsx')
const reviewPage = read('app/admin/posts/review/page.tsx')
const reviewRoute = read('app/api/admin/posts/review/route.ts')
const globals = read('app/globals.css')

test('审核中心单图缩略图使用站内 ImageViewer 打开大图', () => {
  assert.match(reviewManager, /<ImageViewer/)
  assert.match(reviewManager, /aria-label=\{`帖子图片，共 \$\{imageItems\.length\} 张`\}/)
  assert.match(viewer, /aria-haspopup="dialog"/)
  assert.doesNotMatch(reviewManager, /window\.open\(/)
})

test('多图从被点击图片的 initialIndex 开始预览', () => {
  assert.match(reviewManager, /gallery=\{imageItems\}/)
  assert.match(reviewManager, /initialIndex=\{index\}/)
  assert.match(viewer, /const nextIndex = clampIndex\(initialIndex, viewerItems\.length\)/)
  assert.match(viewer, /setCurrentIndex\(nextIndex\)/)
})

test('画廊提供上一张、下一张和当前位置提示', () => {
  assert.match(viewer, /上一张图片/)
  assert.match(viewer, /下一张图片/)
  assert.match(viewer, /\{safeCurrentIndex \+ 1\} \/ \{viewerItems\.length\}/)
  assert.match(viewer, /function goTo\(nextIndex: number/)
})

test('首张和末张不会越界，最后一张仍可关闭或回退', () => {
  assert.match(viewer, /disabled=\{safeCurrentIndex === 0\}/)
  assert.match(viewer, /disabled=\{safeCurrentIndex === viewerItems\.length - 1\}/)
  assert.match(viewer, /clampIndex\(nextIndex, viewerItems\.length\)/)
  assert.match(viewer, /aria-label="关闭图片查看器"/)
})

test('图片点击会阻止审核卡片事件冒泡', () => {
  assert.match(viewer, /onClick=\{\(event\) => \{ event\.stopPropagation\(\); openViewer\(\) \}\}/)
  assert.match(viewer, /onClick=\{\(event\) => \{ event\.stopPropagation\(\); goTo\(/)
})

test('桌面端支持 ESC、遮罩空白区域和关闭按钮退出', () => {
  assert.match(viewer, /event\.key === 'Escape'/)
  assert.match(viewer, /if \(event\.currentTarget === event\.target\) close\(\)/)
  assert.match(viewer, /aria-label="关闭图片查看器"/)
})

test('移动端预览覆盖安全区并位于导航、Sheet、普通 Dialog 之上', () => {
  assert.match(viewer, /z-\[var\(--layer-image-viewer\)\]/)
  assert.match(viewer, /pt-\[env\(safe-area-inset-top\)\]/)
  assert.match(viewer, /bottom-\[calc\(1rem\+env\(safe-area-inset-bottom\)\)\]/)
  assert.match(viewer, /h-\[100dvh\] w-\[100vw\]/)
  assert.match(globals, /--layer-image-viewer:\s*100000/)
})

test('移动端保留 Pointer 双指缩放、双击缩放和左右滑动', () => {
  assert.match(viewer, /onPointerDown=\{onPointerDown\}/)
  assert.match(viewer, /onPointerUp=\{onPointerEnd\}/)
  assert.match(viewer, /pinchRef/)
  assert.match(viewer, /pointersRef/)
  assert.match(viewer, /onDoubleClick=/)
  assert.match(viewer, /SWIPE_COMMIT_THRESHOLD_PX/)
})

test('原图加载期间有状态提示，失败后可继续使用 viewer', () => {
  assert.match(viewer, /图片加载中…/)
  assert.match(viewer, /图片加载失败/)
  assert.match(viewer, /onLoad=\{handleOriginalLoad\}/)
  assert.match(viewer, /onError=\{handleOriginalError\}/)
  assert.match(viewer, /imageState === 'error'/)
})

test('审核列表仍保持缩略图网格布局并使用 zoom-in 光标', () => {
  assert.match(reviewManager, /h-28 w-40 rounded-xl object-cover/)
  assert.match(reviewManager, /h-28 w-40 cursor-zoom-in/)
  assert.match(reviewManager, /imageClassName="h-28 w-40 rounded-xl object-cover"/)
})

test('审核卡片内的详情内容和图片共用同一帖子媒体数据，详情区域同样可预览', () => {
  assert.match(reviewManager, /<article key=\{post\.id\}/)
  assert.match(reviewManager, /post\.content/)
  assert.match(reviewManager, /post\.PostMedia\.flatMap/)
  assert.match(reviewManager, /gallery=\{imageItems\}/)
})

test('通过、拒绝、精选和置顶操作仍由原审核控制逻辑处理', () => {
  assert.match(reviewManager, /requestReview\(post, 'APPROVED'\)/)
  assert.match(reviewManager, /requestReview\(post, 'REJECTED'\)/)
  assert.match(reviewManager, /toggleFlag\(post\.id, 'isFeatured'/)
  assert.match(reviewManager, /toggleFlag\(post\.id, 'isPinned'/)
})

test('只读取图片媒体并复用统一公开 URL 与管理员权限校验', () => {
  assert.match(reviewPage, /PostMedia: \{ where: \{ type: 'IMAGE' \}/)
  assert.match(reviewRoute, /PostMedia: \{ where: \{ type: 'IMAGE'/)
  assert.match(reviewPage, /publicImageUrl\(media\.url\)/)
  assert.match(reviewRoute, /publicImageUrl\(media\.url\)/)
  assert.match(reviewRoute, /const guard = await requireAdmin\('post_manage'\)/)
})
