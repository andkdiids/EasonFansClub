import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('MusicSong 增加专家模式开关，旧歌曲通过默认值保持开启', () => {
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20260810140000_add_music_song_expert_enabled/migration.sql')
  const songModel = schema.slice(schema.indexOf('model MusicSong'))

  assert.match(songModel, /expertEnabled\s+Boolean\s+@default\(true\)/)
  assert.match(migration, /ALTER TABLE `MusicSong`[\s\S]*ADD COLUMN `expertEnabled` BOOLEAN NOT NULL DEFAULT true/)
  assert.doesNotMatch(migration, /\b(DROP|DELETE|TRUNCATE)\b/i)
})

test('只有专家模式题目查询使用歌曲级 expertEnabled', () => {
  const session = read('lib/guess-song-session.ts')
  const expertFilter = session.slice(session.indexOf('function eligibleSourceFilter'))

  assert.match(expertFilter, /mode === 'EXPERT'[\s\S]*MusicSong: \{ expertEnabled: true \}/)
  assert.match(expertFilter, /MusicSong: \{ expertEnabled: true, MusicAlbum: \{ status: 'PUBLISHED' \} \}/)
  assert.match(expertFilter, /: \{ MusicSong: \{ MusicAlbum: \{ status: 'PUBLISHED' \} \} \}/)
  assert.match(session, /where: eligibleQuestionWhere\(mode, autoEnabled\)/)
})

test('后台听听歌曲库直接切换专家模式并禁用缓存', () => {
  const listRoute = read('app/api/admin/entertainment/guess-song/questions/route.ts')
  const toggleRoute = read('app/api/admin/entertainment/guess-song/music-songs/[songId]/route.ts')
  const manager = read('app/admin/entertainment/guess-song/AdminGuessSongManager.tsx')

  assert.match(listRoute, /expertEnabled: true/)
  assert.match(listRoute, /Cache-Control', 'private, no-store'/)
  assert.match(toggleRoute, /requireAdmin\('entertainment_manage'\)/)
  assert.match(toggleRoute, /data: \{ expertEnabled: body\.expertEnabled \}/)
  assert.match(manager, /cache: 'no-store'/)
  assert.match(manager, /music-songs\/\$\{song\.id\}/)
  assert.match(manager, /专家模式：控制该歌曲是否进入专家模式/)
  assert.match(manager, /不参与专家模式/)
})

test('新增歌曲没有覆盖 expertEnabled，交由 Prisma 默认值 true', () => {
  const createRoute = read('app/api/admin/music/songs/route.ts')
  assert.match(createRoute, /musicSong\.create\(/)
  assert.doesNotMatch(createRoute, /expertEnabled:\s*false/)
})
