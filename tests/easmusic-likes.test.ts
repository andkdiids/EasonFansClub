import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('EasMusic 点赞关系只绑定用户与正式歌曲/专辑，并由数据库唯一约束去重', () => {
  const schema = read('prisma/schema.prisma')
  assert.match(schema, /model MusicSongLike \{[\s\S]*userId\s+String[\s\S]*songId\s+String[\s\S]*MusicSong\s+MusicSong[\s\S]*@@unique\(\[userId, songId\]\)[\s\S]*@@index\(\[songId\]\)/)
  assert.match(schema, /model MusicAlbumLike \{[\s\S]*userId\s+String[\s\S]*albumId\s+String[\s\S]*MusicAlbum\s+MusicAlbum[\s\S]*@@unique\(\[userId, albumId\]\)[\s\S]*@@index\(\[albumId\]\)/)
  assert.doesNotMatch(schema, /DailyRecommendationLike/)
  const songLikeModel = schema.match(/model MusicSongLike \{[\s\S]*?\n\}/)?.[0] || ''
  const albumLikeModel = schema.match(/model MusicAlbumLike \{[\s\S]*?\n\}/)?.[0] || ''
  assert.doesNotMatch(songLikeModel, /likeCount/)
  assert.doesNotMatch(albumLikeModel, /likeCount/)
})

test('点赞写入使用事务、skipDuplicates 和关系表 count，重复 POST/DELETE 不会漂移', () => {
  const service = read('lib/easmusic-likes.ts')
  assert.match(service, /prisma\.\$transaction\(async \(tx\)/)
  assert.match(service, /musicSongLike\.createMany\([\s\S]*skipDuplicates: true/)
  assert.match(service, /musicAlbumLike\.createMany\([\s\S]*skipDuplicates: true/)
  assert.match(service, /musicSongLike\.deleteMany/)
  assert.match(service, /musicAlbumLike\.deleteMany/)
  assert.match(service, /musicSongLike\.count\(\{ where: \{ songId/)
  assert.match(service, /musicAlbumLike\.count\(\{ where: \{ albumId/)
})

test('Song/Album API 均使用统一登录校验、发布状态校验和 no-store 返回', () => {
  for (const [kind, id, route] of [
    ['song', 'songId', 'app/api/music/songs/[songId]/like/route.ts'],
    ['album', 'albumId', 'app/api/music/albums/[albumId]/like/route.ts'],
  ] as const) {
    assert.equal(existsSync(route), true)
    const source = read(route)
    assert.match(source, /requireUser\(\)/)
    assert.match(source, /rejectInvalidRequestOrigin\(request\)/)
    assert.match(source, /export async function POST/)
    assert.match(source, /export async function DELETE/)
    assert.match(source, /Cache-Control.*private, no-store/)
    assert.match(source, new RegExp(`${id}.*trim`))
    assert.match(source, new RegExp(`writeEasMusic${kind === 'song' ? 'Song' : 'Album'}Like`))
    assert.doesNotMatch(source, /request\.json|body\??\.userId/)
  }
})

test('批量读取点赞状态使用 groupBy 和一次性用户关系查询，不按歌曲逐条 count', () => {
  const service = read('lib/easmusic-likes.ts')
  assert.equal((service.match(/\.groupBy\(/g) || []).length, 2)
  assert.match(service, /musicSongLike\.findMany\([\s\S]*songId: \{ in: ids \}/)
  assert.match(service, /musicAlbumLike\.findMany\([\s\S]*albumId: \{ in: ids \}/)
  assert.doesNotMatch(service, /for[\s\S]{0,120}music(?:Song|Album)Like\.count/)
})

test('首页与专辑详情复用同一份 SongLike/AlbumLike 状态', () => {
  const home = read('lib/home-data.ts')
  const daily = read('lib/daily-music.ts')
  const api = read('app/api/home/route.ts')
  const album = read('app/music/album/[id]/page.tsx')
  const surface = read('components/HomeLayoutSurface.tsx')
  const tracks = read('components/music/MusicAlbumTrackList.tsx')
  assert.match(home, /getEasMusicAlbumLikeStates/)
  assert.match(daily, /getEasMusicSongLikeState/)
  assert.match(api, /getHomeAlbums\(user\?\.id\)/)
  assert.match(album, /getEasMusicAlbumLikeState/)
  assert.match(album, /getEasMusicSongLikeStates/)
  assert.match(surface, /type="song"[\s\S]*initialCount=\{data\.dailyMusic\.likeCount\}/)
  assert.match(surface, /type="album"[\s\S]*initialCount=\{album\.likeCount\}/)
  assert.match(tracks, /type="song"[\s\S]*initialCount=\{song\.likeCount\}/)
})

test('通用按钮提供 optimistic 回滚、请求中禁用和现有登录 next 引导', () => {
  const button = read('components/music/EasMusicLikeButton.tsx')
  assert.match(button, /setLiked\(nextLiked\)/)
  assert.match(button, /setCount\(Math\.max\(0, previousCount \+ \(nextLiked \? 1 : -1\)\)\)/)
  assert.match(button, /setLiked\(previousLiked\)/)
  assert.match(button, /disabled=\{isSubmitting\}/)
  assert.match(button, /\/login\?next=/)
  assert.match(button, /redirectToLoginAfterConfirmedSessionInvalid/)
  assert.match(button, /cache: 'no-store'/)
})

test('每日歌曲推荐使用上海日期的全局 deterministic seed，点赞不参与抽取', () => {
  const daily = read('lib/daily-music.ts')
  assert.match(daily, /DAILY_MUSIC_RECOMMENDATION_SEED = 'easmusic-global'/)
  assert.match(daily, /getShanghaiDateKey\(now\)/)
  assert.match(daily, /globalDailyRecommendationIndex\(recommendDate, candidates\.length\)/)
  assert.doesNotMatch(daily, /userId\s*\|\|\s*anonymousId\s*\|\|\s*'anonymous'/)
  assert.doesNotMatch(daily, /userDailyMusicRecommendation\.(findUnique|findMany|create)/)
})

test('点赞 migration 只新增关系表、唯一键和级联外键，不触碰评分或音乐内容数据', () => {
  const migration = read('prisma/migrations/20260823140000_add_easmusic_likes/migration.sql')
  assert.match(migration, /CREATE TABLE `MusicSongLike`/)
  assert.match(migration, /UNIQUE INDEX `MusicSongLike_userId_songId_key`/)
  assert.match(migration, /CREATE TABLE `MusicAlbumLike`/)
  assert.match(migration, /UNIQUE INDEX `MusicAlbumLike_userId_albumId_key`/)
  assert.match(migration, /ON DELETE CASCADE/)
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM|ALTER TABLE `MusicSong`|ALTER TABLE `MusicAlbum`|ALTER TABLE `User`/i)
})
