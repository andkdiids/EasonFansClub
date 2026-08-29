import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('推荐页桌面刷新按钮复用现有 loadPage，移动端隐藏且避免重复请求', () => {
  const home = read('components/ForumHome.tsx')
  const discovery = read('components/ForumDiscoveryHome.tsx')
  const css = read('app/globals.css')

  assert.match(home, /showDesktopRefresh=\{isMobile === false\}/)
  assert.match(discovery, /showDesktopRefresh && mode === 'recommend'/)
  assert.match(discovery, /onClick=\{\(\) => void refresh\(true\)\}/)
  assert.match(discovery, /disabled=\{isRefreshing\}/)
  assert.match(discovery, /if \(refreshingRef\.current\) return/)
  assert.match(discovery, /await loadPage\(true, true\)/)
  assert.doesNotMatch(discovery, /window\.location\.reload|router\.refresh\(\)/)
  assert.match(css, /@media \(max-width:767px\)[\s\S]*\.forum-discovery-refresh-button \{ display:none; \}/)
  assert.match(css, /\.forum-discovery-refresh-button\.is-refreshing span \{ animation:forum-discovery-refresh-spin/)
})

test('帖子多图查看器使用统一 3 秒 timeout，自动循环且手动交互暂停并清理', () => {
  const viewer = read('components/ImageViewer.tsx')
  const carousel = read('components/PostMediaCarousel.tsx')
  const postPage = read('app/posts/[postId]/page.tsx')

  assert.match(viewer, /IMAGE_VIEWER_AUTO_PLAY_INTERVAL_MS = 3_000/)
  assert.match(viewer, /autoPlay && viewerItems\.length > 1/)
  assert.match(viewer, /window\.setTimeout\(/)
  assert.match(viewer, /\}, IMAGE_VIEWER_AUTO_PLAY_INTERVAL_MS\)/)
  assert.match(viewer, /\(safeCurrentIndex \+ 1\) % viewerItems\.length/)
  assert.match(viewer, /clearAutoPlayTimeout\(\)/)
  assert.match(viewer, /useEffect\(\(\) => \(\) => clearAutoPlayTimeout\(\)/)
  assert.match(viewer, /const pauseAutoPlay = useCallback/)
  assert.match(viewer, /onPointerDown[\s\S]*pauseAutoPlay\(\)/)
  assert.match(viewer, /onPointerMove[\s\S]*pauseAutoPlay\(\)/)
  assert.match(viewer, /if \(open && zoom !== 1\) pauseAutoPlay\(\)/)
  assert.match(viewer, /onWheel[\s\S]*pauseAutoPlay\(\)/)
  assert.match(viewer, /goTo\(safeCurrentIndex - 1\)/)
  assert.match(carousel, /gallery=\{viewerGallery\}/)
  assert.match(carousel, /autoPlay=\{viewerGallery\.length > 1\}/)
  assert.match(carousel, /viewerGallery = items[\s\S]*filter\(\(item\) => !item\.broken && !failedImageIds\.has\(item\.id\)\)/)
  assert.match(postPage, /where: \{ type: 'IMAGE' as const \}/)
})
