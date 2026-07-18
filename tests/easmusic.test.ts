import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

test('Prisma 新增音乐专辑与歌曲关系并保留旧曲目模型', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  assert.match(schema, /model MusicAlbum \{[\s\S]*name\s+String[\s\S]*songs\s+MusicSong\[\]/)
  assert.match(schema, /model MusicSong \{[\s\S]*albumId\s+String[\s\S]*album\s+MusicAlbum @relation/)
  assert.match(schema, /sourceType\s+String\?[\s\S]*sourceUrl\s+String\?/)
  assert.match(schema, /model MusicTrack \{/)
})

test('EasMusic migration 创建索引、关系与专辑级联删除', () => {
  const migration = readFileSync('prisma/migrations/20260718170000_add_easmusic_catalog/migration.sql', 'utf8')
  assert.match(migration, /CREATE TABLE "MusicAlbum"/)
  assert.match(migration, /CREATE TABLE "MusicSong"/)
  assert.match(migration, /MusicSong_albumId_trackNumber_key/)
  assert.match(migration, /REFERENCES "MusicAlbum"\("id"\) ON DELETE CASCADE/)
})

test('后台音乐管理沿用 music_manage 权限并提供完整 CRUD', () => {
  const adminPage = readFileSync('app/admin/music/page.tsx', 'utf8')
  const manager = readFileSync('app/admin/music/AdminMusicManager.tsx', 'utf8')
  const albumCollection = readFileSync('app/api/admin/music/albums/route.ts', 'utf8')
  const albumItem = readFileSync('app/api/admin/music/albums/[albumId]/route.ts', 'utf8')
  const songCollection = readFileSync('app/api/admin/music/songs/route.ts', 'utf8')
  const songItem = readFileSync('app/api/admin/music/songs/[songId]/route.ts', 'utf8')
  assert.match(adminPage, /requireAdminPage\('\/admin\/music', 'music_manage'\)/)
  for (const route of [albumCollection, albumItem, songCollection, songItem]) assert.match(route, /requireAdmin\('music_manage'\)/)
  assert.match(albumCollection, /export async function POST/)
  assert.match(albumItem, /export async function PATCH/)
  assert.match(albumItem, /export async function DELETE/)
  assert.match(songCollection, /export async function POST/)
  assert.match(songItem, /export async function PATCH/)
  assert.match(songItem, /export async function DELETE/)
  assert.match(manager, /新增专辑/)
  assert.match(manager, /新增歌曲/)
})

test('前台音乐馆包含推荐、热门专辑和全部专辑', () => {
  const page = readFileSync('app/music/page.tsx', 'utf8')
  assert.match(page, /🎵 EasMusic/)
  assert.match(page, /今日推荐/)
  assert.match(page, /热门专辑/)
  assert.match(page, /全部专辑/)
  assert.match(page, /songs\.length - a\.songs\.length/)
})

test('专辑墙、专辑详情与歌曲详情路由均已建立', () => {
  const albums = readFileSync('app/music/albums/page.tsx', 'utf8')
  const album = readFileSync('app/music/album/[id]/page.tsx', 'utf8')
  const song = readFileSync('app/music/song/[id]/page.tsx', 'utf8')
  assert.match(albums, /专辑墙/)
  assert.match(album, /歌曲列表/)
  assert.match(album, /\/music\/song\/\$\{song\.id\}/)
  assert.match(song, /歌曲故事/)
  assert.match(song, /预留区域/)
})

test('播放器只建立中立框架且没有音频元素', () => {
  const player = readFileSync('components/music/MusicPlayer.tsx', 'utf8')
  const miniPlayer = readFileSync('components/music/MusicMiniPlayer.tsx', 'utf8')
  assert.match(player, /播放入口（框架）/)
  assert.match(player, /netease、qq、apple 或 custom/)
  assert.doesNotMatch(player, /<audio|new Audio|\.play\(/)
  assert.match(miniPlayer, /迷你播放器框架/)
  assert.doesNotMatch(miniPlayer, /<audio|new Audio|\.play\(/)
})

test('音乐资料页面使用移动端优先响应式网格', () => {
  const home = readFileSync('app/music/page.tsx', 'utf8')
  const albums = readFileSync('app/music/albums/page.tsx', 'utf8')
  const detail = readFileSync('app/music/album/[id]/page.tsx', 'utf8')
  assert.match(home, /grid-cols-2[\s\S]*sm:grid-cols-3/)
  assert.match(albums, /grid-cols-2[\s\S]*sm:grid-cols-3/)
  assert.match(detail, /sm:grid-cols-\[minmax\(240px,360px\)_minmax\(0,1fr\)\]/)
})
