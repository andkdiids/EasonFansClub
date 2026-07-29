import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('三种音频用途拥有独立的服务端上限与对象路径', () => {
  const preview = read('lib/music-preview.ts')
  const guessConfig = read('lib/guess-song-config.ts')
  const uploadRoute = read('app/api/admin/music/songs/[songId]/preview/route.ts')
  const guessAudio = read('lib/guess-song-admin-audio.ts')
  assert.match(preview, /EASMUSIC_PREVIEW_MAX_SECONDS = 60/)
  assert.match(guessConfig, /GUESS_SONG_AUDIO_DURATIONS = \[2, 3, 4, 5, 6, 7\]/)
  assert.match(uploadRoute, /music-sources\//)
  assert.match(uploadRoute, /music-preview\//)
  assert.match(guessAudio, /questions\/\$\{questionId\}\/variants\/\$\{revision\}/)
})

test('猜歌从 MusicSong 私有源生成且不复制为题目源文件', () => {
  const audio = read('lib/guess-song-admin-audio.ts')
  assert.match(audio, /generateGuessSongAudioFromMusicSong/)
  assert.match(audio, /downloadGuessSongObject\(question\.MusicSong\.sourceAudioPath\)/)
  assert.match(audio, /audioSourceType: 'EASMUSIC_SONG'/)
  assert.match(audio, /persistSource: false/)
})

test('音乐源更新只标记猜歌片段过期并由管理员确认重建', () => {
  const route = read('app/api/admin/entertainment/guess-song/questions/route.ts')
  const admin = read('app/admin/entertainment/guess-song/AdminGuessSongManager.tsx')
  assert.match(route, /sourceStale:/)
  assert.match(route, /question\.musicSourceRevision !== MusicSong\.sourceAudioRevision/)
  assert.match(admin, /歌曲音频已更新，当前猜歌片段仍为旧版本/)
  assert.match(admin, /重新生成猜歌片段/)
})

test('旧手动上传题目继续使用题目私有源并保持可重新生成', () => {
  const audio = read('lib/guess-song-admin-audio.ts')
  const admin = read('app/admin/entertainment/guess-song/AdminGuessSongManager.tsx')
  assert.match(audio, /audioSourceType: 'MANUAL_UPLOAD'/)
  assert.match(audio, /persistSource: true/)
  assert.match(audio, /question\?\.sourceAudioPath/)
  assert.match(admin, /手动上传音频/)
})

test('普通搜索结果只返回公开资料而不会返回原始音频路径', () => {
  const search = read('app/api/search/route.ts')
  assert.match(search, /prisma\.musicSong\.findMany/)
  assert.match(search, /hasPreview/)
  assert.doesNotMatch(search, /sourceAudioPath|sourceAudioRevision/)
})

test('专辑与歌曲详情均复用全站播放器并展示版权说明', () => {
  const album = read('components/music/MusicAlbumTrackList.tsx')
  const song = read('app/music/song/[id]/page.tsx')
  const player = read('components/music/MusicPlayer.tsx')
  assert.match(album, /useMusicPlayer/)
  assert.match(song, /<MusicPlayer/)
  assert.match(player, /本站仅提供最长 60 秒试听片段/)
  assert.match(album, /完整版，请前往各大音乐平台/)
})

test('猜歌开始播放前会暂停 EasMusic 全局播放器', () => {
  const game = read('app/entertainment/guess-song/GuessSongGame.tsx')
  const provider = read('components/music/MusicPlayerProvider.tsx')
  assert.match(game, /easmusic:pause-all/)
  assert.match(provider, /window\.addEventListener\('easmusic:pause-all'/)
})

test('管理员接口校验权限、真实音频内容和文件大小', () => {
  const musicRoute = read('app/api/admin/music/songs/[songId]/preview/route.ts')
  const guessRoute = read('app/api/admin/entertainment/guess-song/questions/[questionId]/from-music/route.ts')
  assert.match(musicRoute, /requireAdmin\('music_manage'\)/)
  assert.match(musicRoute, /detectMusicAudioType/)
  assert.match(musicRoute, /MUSIC_AUDIO_MAX_FILE_SIZE/)
  assert.match(guessRoute, /requireAdmin\('entertainment_manage'\)/)
})

test('可空兼容迁移保留旧歌曲和旧题目', () => {
  const migration = read('prisma/migrations/20260730190000_reuse_music_song_audio/migration.sql')
  assert.match(migration, /sourceAudioPath.*NULL/)
  assert.match(migration, /audioSourceType.*NULL/)
  assert.match(migration, /musicSourceRevision.*NULL/)
  assert.doesNotMatch(migration, /\b(DROP|TRUNCATE|DELETE|UPDATE)\b/i)
})
