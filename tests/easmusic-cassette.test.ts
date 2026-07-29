import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { selectCassetteSongs } from '../lib/music-cassette'
import type { CassetteSong } from '../types/music-cassette'

const read = (path: string) => readFileSync(path, 'utf8')

const songs: CassetteSong[] = Array.from({ length: 12 }, (_, index) => ({
  id: `song-${index}`,
  title: `歌曲 ${index}`,
  artist: '陈奕迅',
  albumId: `album-${Math.floor(index / 3)}`,
  albumTitle: `专辑 ${Math.floor(index / 3)}`,
  releaseYear: 2000 + index,
  previewUrl: `/preview/${index}.mp3`,
  previewDuration: 60,
}))

test('随机磁带同一会话稳定、去重并尽量分散专辑', () => {
  const first = selectCassetteSongs(songs, 8, 20260730)
  const second = selectCassetteSongs(songs, 8, 20260730)
  assert.deepEqual(first.map((song) => song.id), second.map((song) => song.id))
  assert.equal(new Set(first.map((song) => song.id)).size, first.length)
  assert.ok(first.every((song, index) => index === 0 || song.albumId !== first[index - 1].albumId))
})

test('EasMusic 首页仅查询公开试听所需字段并过滤已发布专辑', () => {
  const page = read('app/music/page.tsx')
  const query = page.slice(page.indexOf('prisma.musicSong.findMany'), page.lastIndexOf('getPublishedPageLayoutConfig'))
  assert.match(query, /previewUrl: \{ not: null \}/)
  assert.match(query, /MusicAlbum: \{ status: 'PUBLISHED' \}/)
  assert.match(query, /take: 60/)
  assert.doesNotMatch(query, /sourceAudioPath|sourceAudioRevision|GuessSong/)
})

test('互动录音机复用全局播放器且没有创建第二个 Audio', () => {
  const hero = read('components/music/cassette/EasMusicCassetteHero.tsx')
  const provider = read('components/music/MusicPlayerProvider.tsx')
  assert.match(hero, /useMusicPlayer/)
  assert.match(hero, /player\.playTrack/)
  assert.match(hero, /player\.eject/)
  assert.doesNotMatch(hero, /new Audio\(/)
  assert.equal((provider.match(/new Audio\(\)/g) || []).length, 1)
})

test('磁带支持 Pointer Events、触屏点击备用操作和明确状态', () => {
  const drag = read('hooks/useCassetteDrag.ts')
  const hero = read('components/music/cassette/EasMusicCassetteHero.tsx')
  const recorder = read('components/music/cassette/CassetteRecorder.tsx')
  assert.match(drag, /onPointerDown/)
  assert.match(drag, /setPointerCapture/)
  assert.match(drag, /requestAnimationFrame/)
  assert.match(hero, /放入录音机/)
  for (const phase of ['idle', 'dragging', 'inserting', 'loading', 'playing', 'paused', 'ended', 'ejecting', 'error']) {
    assert.match(`${hero}\n${recorder}`, new RegExp(`['\"]?${phase}['\"]?`))
  }
})

test('猜歌页面使用全屏声纹、无外围大框并统一命名为听听', () => {
  const css = read('app/globals.css')
  const catalog = read('lib/game-catalog.ts')
  assert.match(css, /\.guess-waveform[^}]*width:100vw/)
  assert.match(css, /\.guess-play-shell[^}]*border:0/)
  assert.match(catalog, /title: '听听'/)
  assert.doesNotMatch(`${catalog}\n${read('app/entertainment/guess-song/GuessSongGame.tsx')}`, /E声猜歌/)
})
