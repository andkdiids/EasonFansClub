import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('EasMusic 试听 CTA 在午夜主题仍保持白底深字，并覆盖播放状态', () => {
  const page = read('app/music/song/[id]/page.tsx')
  const player = read('components/music/MusicPlayer.tsx')
  const styles = read('app/globals.css')

  assert.match(page, /className="easmusic-preview-button rounded-full bg-white[^\"]*text-\[#07182d\]/)
  assert.match(page, /播放试听/)
  assert.match(player, /className="easmusic-preview-button[^\"]*bg-white[^\"]*text-brand-950/)
  assert.match(player, /加载中…/)
  assert.match(player, /playing \? '暂停'/)
  assert.match(styles, /\.easmusic-preview-button\s*\{[\s\S]*color:\s*#07182d;[\s\S]*background-color:\s*#fff;/)
  assert.match(styles, /\.easmusic-preview-button:hover:not\(:disabled\)/)
  assert.match(styles, /\.easmusic-preview-button:active:not\(:disabled\)/)
  assert.match(styles, /\.easmusic-preview-button:focus-visible/)
  assert.match(styles, /\.easmusic-preview-button:disabled/)
  assert.match(styles, /:root\[data-theme='midnight'\] \.easmusic-preview-button\s*\{[\s\S]*color:\s*#07182d;[\s\S]*background-color:\s*#fff;/)

  const returnLink = page.match(/<Link href=\{`\/music\/album\/\$\{song\.albumId\}`\} className="([^"]+)"[^>]*>返回专辑<\/Link>/)
  assert.ok(returnLink)
  assert.doesNotMatch(returnLink[1], /easmusic-preview-button/)
})
