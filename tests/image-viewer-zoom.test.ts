import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  calculateImageViewerFit,
  clampImageViewerPan,
  clampImageViewerZoom,
  IMAGE_VIEWER_AUTO_PLAY_INTERVAL_MS,
  IMAGE_VIEWER_MAX_ZOOM,
  IMAGE_VIEWER_MIN_ZOOM,
  IMAGE_VIEWER_ZOOM_STEP,
} from '../components/ImageViewer'

const read = (path: string) => readFileSync(path, 'utf8')
const viewer = read('components/ImageViewer.tsx')

test('100% is the complete-fit baseline and zoom bounds keep the existing range', () => {
  assert.equal(clampImageViewerZoom(1), 1)
  assert.equal(clampImageViewerZoom(0), IMAGE_VIEWER_MIN_ZOOM)
  assert.equal(clampImageViewerZoom(99), IMAGE_VIEWER_MAX_ZOOM)
  assert.equal(IMAGE_VIEWER_MIN_ZOOM, 0.5)
  assert.equal(IMAGE_VIEWER_MAX_ZOOM, 4)
  assert.equal(IMAGE_VIEWER_ZOOM_STEP, 0.25)
})

test('fit sizing uses one unscaled base size, including very tall images', () => {
  const fit = calculateImageViewerFit({ width: 1080, height: 3000 }, { width: 1200, height: 800 })
  assert.equal(fit.width, 288)
  assert.equal(fit.height, 800)
})

test('pan is bounded by the scaled visual size and returns to center at 100%', () => {
  const fit = { width: 288, height: 800 }
  const viewport = { width: 1200, height: 800 }
  assert.deepEqual(clampImageViewerPan({ x: 0, y: 9999 }, 3, fit, viewport), { x: 0, y: 800 })
  assert.deepEqual(clampImageViewerPan({ x: 9999, y: 9999 }, 1, fit, viewport), { x: 0, y: 0 })
})

test('image uses translate3d plus scale and removes fit constraints after base measurement', () => {
  assert.match(viewer, /transform: `translate3d\(\$\{pan\.x\}px, \$\{pan\.y\}px, 0\) scale\(\$\{zoom\}\)`/)
  assert.match(viewer, /maxWidth: 'none'/)
  assert.match(viewer, /maxHeight: 'none'/)
  assert.match(viewer, /calculateImageViewerFit\(naturalSizeRef\.current, nextViewportSize\)/)
  assert.match(viewer, /data-image-viewer-image="true"/)
})

test('desktop drag, bounded pan, pointer capture and unified pointer pinch use one zoom source', () => {
  assert.match(viewer, /onPointerDown=\{onPointerDown\}/)
  assert.match(viewer, /onPointerMove=\{onPointerMove\}/)
  assert.match(viewer, /onPointerUp=\{onPointerEnd\}/)
  assert.match(viewer, /setPointerCapture\(event\.pointerId\)/)
  assert.match(viewer, /clampImageViewerPan\(\{ x: drag\.startPan\.x \+ deltaX, y: drag\.startPan\.y \+ deltaY \}/)
  assert.match(viewer, /pinchRef\.current\.startZoom \* currentDistance \/ pinchRef\.current\.startDistance/)
  assert.match(viewer, /applyTransform\(nextZoom, \{/)
})

test('100% reset, close and gallery switching clear both zoom and pan', () => {
  assert.match(viewer, /function resetTransform\(\)/)
  assert.match(viewer, /setZoom\(1\)/)
  assert.match(viewer, /setPan\(ZERO_POINT\)/)
  assert.match(viewer, /setOpen\(false\)[\s\S]*resetTransform\(\)/)
  assert.match(viewer, /function goTo\(nextIndex: number/)
  assert.match(viewer, /setCurrentIndex\(nextSafeIndex\)[\s\S]*resetTransform\(\)/)
})

test('viewer locks the page while open and releases the lock on close', () => {
  assert.match(viewer, /documentElement\.style\.overflow = 'hidden'/)
  assert.match(viewer, /document\.body\.style\.overflow = 'hidden'/)
  assert.match(viewer, /documentElement\.style\.overflow = previousDocumentOverflow/)
  assert.match(viewer, /document\.body\.style\.overflow = previousBodyOverflow/)
  assert.match(viewer, /overscroll-contain touch-none/)
})

test('多图默认每三秒自动切图，最后一张回到第一张，单图不启用 timer', () => {
  assert.equal(IMAGE_VIEWER_AUTO_PLAY_INTERVAL_MS, 3_000)
  assert.match(viewer, /setIsAutoPlaying\(autoPlay && viewerItems\.length > 1\)/)
  assert.match(viewer, /\(safeCurrentIndex \+ 1\) % viewerItems\.length/)
  assert.match(viewer, /if \(!open \|\| !autoPlay \|\| !isGallery \|\| !isAutoPlaying/)
})

test('点击、切图、拖动和缩放只重置计时，关闭才清理自动播放', () => {
  assert.match(viewer, /const beginInteraction = useCallback/)
  assert.match(viewer, /const endInteraction = useCallback/)
  assert.match(viewer, /onPointerDown[\s\S]*beginInteraction\(\)/)
  assert.match(viewer, /onPointerMove[\s\S]*beginInteraction\(\)/)
  assert.match(viewer, /onWheel[\s\S]*beginInteraction\(\)[\s\S]*endInteraction\(\)/)
  assert.match(viewer, /onDoubleClick=\{\(event\) => \{ event\.stopPropagation\(\); applyTransform\([\s\S]*restartAutoPlayTimer\(\)/)
  assert.doesNotMatch(viewer, /const pauseAutoPlay|hasUserInteracted/)
  assert.match(viewer, /setOpen\(false\)[\s\S]*setIsAutoPlaying\(false\)/)
  assert.match(viewer, /return clearAutoPlayTimeout/)
})
