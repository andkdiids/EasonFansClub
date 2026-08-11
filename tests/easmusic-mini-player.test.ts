import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const root = process.cwd()
const readSource = (path: string) => readFileSync(`${root}/${path}`, 'utf8')

test('EasMusic mini player keeps dragging on a dedicated Pointer Events handle', () => {
  const source = readSource('components/music/MusicMiniPlayer.tsx')
  const css = readSource('app/globals.css')

  assert.match(source, /easmusic-player-drag-handle/)
  assert.match(source, /onPointerDown=\{handlePointerDown\}/)
  assert.match(source, /onPointerMove=\{handlePointerMove\}/)
  assert.match(source, /setPointerCapture\(event\.pointerId\)/)
  assert.match(source, /DRAG_THRESHOLD = 5/)
  assert.match(source, /requestAnimationFrame\(applyPendingTransform\)/)
  assert.match(source, /translate3d\(\$\{offset\.x\}px, \$\{offset\.y\}px, 0\)/)
  assert.match(source, /onPositionChange\(next\)/)
  assert.doesNotMatch(source, /props\.onPositionChange\(clampPosition\(/)
  assert.match(css, /\.easmusic-mini-player\.is-dragging \{ transition:none !important;/)
  assert.match(source, /onToggleCollapsed/)
  assert.doesNotMatch(source, /touch-action:\s*none/)
})

test('EasMusic mini player shows a close button in both collapsed and expanded states', () => {
  const source = readSource('components/music/MusicMiniPlayer.tsx')

  assert.equal((source.match(/easmusic-player-close-button/g) || []).length, 2)
  assert.match(source, /props\.collapsed \? \(/)
  assert.match(source, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\} onClick=\{props\.onClose\}/)
  assert.match(source, /onPointerCancel=\{finishPointer\}/)
})

test('EasMusic mini player persists collapsed state and viewport position locally', () => {
  const source = readSource('components/music/MusicPlayerProvider.tsx')

  assert.match(source, /easmusic:mini-player-ui/)
  assert.match(source, /localStorage\.getItem\(MINI_PLAYER_STORAGE_KEY\)/)
  assert.match(source, /localStorage\.setItem\(MINI_PLAYER_STORAGE_KEY/)
  assert.match(source, /collapsed/)
  assert.match(source, /miniPlayerPosition/)
})
