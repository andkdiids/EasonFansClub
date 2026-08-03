import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { resolveMusicPlayback } from '../lib/music-playback'

const read = (path: string) => readFileSync(path, 'utf8')

test('EasMusic playback API uses the JSON contract and never redirects the audio element', () => {
  const route = read('app/api/music/songs/[songId]/playback/route.ts')
  assert.match(route, /const response: MusicPlaybackResponse/)
  assert.match(route, /ok: true/)
  assert.match(route, /url: location/)
  assert.match(route, /isFullPlayback/)
  assert.match(route, /NextResponse\.json\(response/)
  assert.doesNotMatch(route, /NextResponse\.redirect/)
})

test('playback resolution keeps preview fallback and full permission separate', () => {
  const source = {
    id: 'song-1',
    previewUrl: 'https://public.example/preview.mp3',
    previewDuration: 60,
    sourceAudioPath: 'guess-song/music/song-1.mp3',
    sourceAudioDurationMs: 181_000,
  }

  assert.deepEqual(resolveMusicPlayback(source, null), {
    songId: 'song-1',
    previewUrl: '/api/music/songs/song-1/playback',
    previewDuration: 60,
    isFullPlayback: false,
  })
  assert.deepEqual(resolveMusicPlayback(source, { role: 'SUPER_ADMIN', canPlayFullMusic: false }), {
    songId: 'song-1',
    previewUrl: '/api/music/songs/song-1/playback',
    previewDuration: 181,
    isFullPlayback: true,
  })
  assert.equal(resolveMusicPlayback({ id: 'song-2', sourceAudioPath: 'private/source.mp3' }, null).previewUrl, '')
  assert.equal(resolveMusicPlayback({ id: 'song-3', previewUrl: 'https://public.example/preview.mp3', sourceAudioPath: null }, { role: 'ADMIN', canPlayFullMusic: true }).isFullPlayback, false)
})

test('the single player resolves the API before assigning one audio source and logs sanitized state', () => {
  const provider = read('components/music/MusicPlayerProvider.tsx')
  assert.equal((provider.match(/new Audio\(\)/g) || []).length, 1)
  assert.match(provider, /fetch\(nextTrack\.previewUrl/)
  assert.match(provider, /payload = await response\.json\(\)/)
  assert.match(provider, /body\?\.ok !== true/)
  assert.match(provider, /audio\.pause\(\)/)
  assert.match(provider, /audio\.src = nextTrack\.previewUrl/)
  assert.match(provider, /audio\.load\(\)/)
  assert.match(provider, /audioCurrentSrcExists/)
  assert.match(provider, /errorName/)
  assert.match(provider, /浏览器暂未允许播放，请再次点击播放按钮。/)
})
