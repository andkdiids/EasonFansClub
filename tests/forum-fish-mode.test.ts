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
  assert.match(css, /\.fish-mode-feed \{ width:min\(1180px/)
  assert.match(css, /\.fish-mode-preview-drawer/)
  assert.match(css, /data-forum-minimal='true'/)
  assert.doesNotMatch(row, /autoPlay=\{true\}/)
  assert.doesNotMatch(css, /forum-discovery-mode-button|forum-plaza-mode-button/)
  assert.equal(FORUM_PRESENTATION_MODE_STORAGE_KEY, 'forum-presentation-mode')
  assert.equal(FORUM_FISH_MINIMAL_STORAGE_KEY, 'forum-fish-minimal')
  assert.doesNotMatch(read('prisma/schema.prisma'), /fish|摸鱼模式/i)
})

test('摸鱼模式桌面宽度在大屏受控放大，小臣书和移动端规则不变', () => {
  const css = read('app/globals.css')
  const fishWidth = css.match(/\.fish-mode-feed \{ width:min\((\d+)px,calc\(100% - 40px\)\)/u)
  assert.equal(fishWidth?.[1], '1180')
  assert.equal(Math.min(1180, 1440 - 40), 1180)
  assert.equal(Math.min(1180, 1920 - 40), 1180)
  assert.match(css, /\.forum-discovery-grid \{ display:grid; width:min\(80rem,calc\(100% - 40px\)\)/u)
  assert.match(css, /@media \(max-width:767px\) \{\s+\.forum-presentation-switcher,\s+\.forum-fish-minimal-control,\s+\.fish-mode-feed,\s+\.fish-mode-preview-layer \{ display:none; \}/u)
})
