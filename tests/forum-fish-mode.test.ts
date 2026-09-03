import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  FORUM_FISH_MINIMAL_STORAGE_KEY,
  FORUM_PRESENTATION_MODE_STORAGE_KEY,
  parseForumPresentationMode,
} from '../lib/forum-discovery'

const read = (path: string) => readFileSync(path, 'utf8')

test('摸鱼模式是同一发现流上的桌面展示偏好', () => {
  const home = read('components/ForumDiscoveryHome.tsx')
  const row = read('components/ForumFishModePostRow.tsx')
  const preview = read('components/ForumFishModePreview.tsx')
  const css = read('app/globals.css')

  assert.equal(parseForumPresentationMode(undefined), 'xiaochenshu')
  assert.equal(parseForumPresentationMode('fish'), 'fish')
  assert.equal(parseForumPresentationMode('unexpected'), 'xiaochenshu')
  assert.match(home, /useIsDesktopMediaQuery/)
  assert.match(home, /localStorage\.setItem\(FORUM_PRESENTATION_MODE_STORAGE_KEY/)
  assert.match(home, /data-forum-presentation=\{presentationMode\}/)
  assert.match(home, /presentationMode === 'fish'/)
  assert.equal((home.match(/fetch\('\/api\/forum\/discover'/g) || []).length, 1)
  assert.match(row, /摸鱼模式帖子列表|fish-mode-post-row/)
  assert.match(row, /▣ \{summary\.imageCount\} 张图片/)
  assert.match(row, /autoPlay=\{false\}/)
  assert.match(row, /preload="metadata"/)
  assert.match(row, /activeVideoId/)
  assert.match(preview, /fetch\(`\/api\/posts\/\$\{post\.id\}`/)
  assert.match(preview, /ReplyForm postId=\{post\.id\}/)
  assert.match(home, /event\.isComposing \|\| event\.keyCode === 229/)
  assert.match(home, /key === 'j' \|\| key === 'k'/)
  assert.match(home, /event\.key === 'Enter'/)
  assert.match(home, /key === 'l'/)
  assert.match(home, /forum-discovery-content/)
  assert.match(css, /\.fish-mode-feed \{ width:100%/)
  assert.match(css, /\.fish-mode-preview-drawer/)
  assert.match(css, /data-forum-minimal='true'/)
  assert.doesNotMatch(row, /autoPlay=\{true\}/)
  assert.doesNotMatch(css, /forum-discovery-mode-button|forum-plaza-mode-button/)
  assert.equal(FORUM_PRESENTATION_MODE_STORAGE_KEY, 'forum-presentation-mode')
  assert.equal(FORUM_FISH_MINIMAL_STORAGE_KEY, 'forum-fish-minimal')
  assert.doesNotMatch(read('prisma/schema.prisma'), /fish|摸鱼模式/i)
})

test('小臣书与摸鱼模式共享更宽的桌面容器，小臣书卡片与移动端规则不变', () => {
  const home = read('components/ForumDiscoveryHome.tsx')
  const css = read('app/globals.css')
  assert.equal((home.match(/className="forum-discovery-content"/g) || []).length, 2)
  assert.match(css, /\.forum-discovery-content \{ width:min\(1360px,calc\(100% - 40px\)\); margin:0 auto; \}/u)
  assert.match(css, /@media \(min-width:768px\) \{\s+\.forum-page-main \{ max-width:none; padding-inline:0; \}/u)
  assert.match(css, /\.forum-discovery-header-row \{ display:flex; width:100%;/u)
  assert.match(css, /\.forum-discovery-tabs \{ display:flex; width:100%;/u)
  assert.match(css, /\.forum-discovery-grid \{ display:grid; width:100%;/u)
  assert.match(css, /\.fish-mode-feed \{ width:100%;/u)
  assert.doesNotMatch(css, /\.fish-mode-feed \{ width:min\(/u)
  assert.deepEqual([1366, 1440, 1600, 1920].map((viewport) => Math.min(1360, viewport - 192 - 40)), [1134, 1208, 1360, 1360])
  assert.match(css, /@media \(max-width:767px\) \{\s+\.forum-presentation-switcher,\s+\.forum-fish-minimal-control,\s+\.fish-mode-feed,\s+\.fish-mode-preview-layer \{ display:none; \}/u)
})
