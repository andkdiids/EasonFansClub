import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import sharp from 'sharp'
import { convertMusicCoverToWebp, MUSIC_COVER_MAX_WIDTH, MUSIC_COVER_QUALITY } from '../lib/music-cover'

test('EasMusic CMS schema 补齐发布、故事、排序和歌曲介绍字段', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  assert.match(schema, /enum MusicPublicationStatus \{[\s\S]*DRAFT[\s\S]*PUBLISHED/)
  assert.match(schema, /model MusicAlbum \{[\s\S]*releaseDate\s+DateTime\?[\s\S]*company\s+String\?[\s\S]*story\s+String\?[\s\S]*status\s+MusicPublicationStatus[\s\S]*displayOrder\s+Int/)
  assert.match(schema, /model MusicSong \{[\s\S]*description\s+String\?[\s\S]*lyrics\s+String\?/)
  assert.match(schema, /model MusicTrack \{/)
})

test('CMS migration 只追加音乐内容字段和发布索引', () => {
  const migration = readFileSync('prisma/migrations/20260718210000_easmusic_cms/migration.sql', 'utf8')
  assert.match(migration, /CREATE TYPE "MusicPublicationStatus"/)
  assert.match(migration, /ALTER TABLE "MusicAlbum"/)
  assert.match(migration, /ALTER TABLE "MusicSong" ADD COLUMN "description"/)
  assert.match(migration, /MusicAlbum_status_displayOrder_releaseYear_idx/)
  assert.doesNotMatch(migration, /"User"|"Post"|"CheckIn"|"Friendship"|"PointLog"/)
})

test('后台专辑和歌曲创建 API 均受 music_manage 权限保护', () => {
  const album = readFileSync('app/api/admin/music/albums/route.ts', 'utf8')
  const song = readFileSync('app/api/admin/music/songs/route.ts', 'utf8')
  assert.match(album, /requireAdmin\('music_manage'\)/)
  assert.match(album, /musicAlbum\.create/)
  assert.match(album, /status: 'DRAFT'/)
  assert.doesNotMatch(album, /coverUrl:/)
  assert.match(song, /requireAdmin\('music_manage'\)/)
  assert.match(song, /musicSong\.create/)
  assert.match(song, /description: optionalMusicText/)
  assert.doesNotMatch(song, /coverUrl:/)
})

test('发布专辑必须有封面且可取消发布', () => {
  const route = readFileSync('app/api/admin/music/albums/[albumId]/route.ts', 'utf8')
  assert.match(route, /requestedStatus === 'PUBLISHED' && !current\.coverUrl/)
  assert.match(route, /status: requestedStatus/)
  assert.match(route, /专辑已发布/)
  assert.match(route, /专辑草稿已保存/)
})

test('JPG 封面自动转换为限宽 WebP 并清除 metadata', async () => {
  const source = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#1985c2' } }).jpeg({ quality: 90 }).withMetadata({ orientation: 1 }).toBuffer()
  const output = await convertMusicCoverToWebp(source)
  const metadata = await sharp(output).metadata()
  assert.equal(metadata.format, 'webp')
  assert.equal(metadata.width, MUSIC_COVER_MAX_WIDTH)
  assert.equal(metadata.height, 1000)
  assert.equal(metadata.exif, undefined)
  assert.equal(MUSIC_COVER_QUALITY, 82)
})

test('PNG 封面自动转换为 WebP 且不放大小图', async () => {
  const source = await sharp({ create: { width: 640, height: 900, channels: 4, background: { r: 10, g: 100, b: 180, alpha: 0.8 } } }).png().toBuffer()
  const output = await convertMusicCoverToWebp(source)
  const metadata = await sharp(output).metadata()
  assert.equal(metadata.format, 'webp')
  assert.equal(metadata.width, 640)
  assert.equal(metadata.height, 900)
})

test('封面 API 使用 music-cover Bucket、固定 WebP 路径和 Supabase Storage', () => {
  const route = readFileSync('app/api/admin/music/covers/route.ts', 'utf8')
  assert.match(route, /SUPABASE_MUSIC_BUCKET \|\| 'music-cover'/)
  assert.match(route, /music-cover\/\$\{entityType === 'album' \? 'albums' : 'songs'\}\/\$\{entityId\}\/cover\.webp/)
  assert.match(route, /'Content-Type': 'image\/webp'/)
  assert.match(route, /'x-upsert': 'true'/)
  assert.match(route, /musicAlbum\.update/)
  assert.match(route, /musicSong\.update/)
})

test('后台提供专辑、歌曲、单曲与 Live 四个 CMS 模块', () => {
  const page = readFileSync('app/admin/music/page.tsx', 'utf8')
  assert.match(page, /专辑管理/)
  assert.match(page, /歌曲管理/)
  assert.match(page, /单曲管理/)
  assert.match(page, /Live 版本管理/)
  for (const file of ['app/admin/music/albums/page.tsx', 'app/admin/music/songs/page.tsx', 'app/admin/music/singles/page.tsx', 'app/admin/music/live/page.tsx']) assert.equal(existsSync(file), true)
})

test('前台只获取已发布专辑和已发布专辑下的歌曲', () => {
  const home = readFileSync('app/music/page.tsx', 'utf8')
  const albums = readFileSync('app/music/albums/page.tsx', 'utf8')
  const album = readFileSync('app/music/album/[id]/page.tsx', 'utf8')
  const song = readFileSync('app/music/song/[id]/page.tsx', 'utf8')
  for (const source of [home, albums, album, song]) assert.match(source, /status: 'PUBLISHED'/)
})

test('沉浸式专辑墙支持 Framer Motion、拖动、滚轮、触摸和详情跳转', () => {
  const carousel = readFileSync('components/music/MusicAlbumCarousel.tsx', 'utf8')
  const card = readFileSync('components/music/MusicAlbum3DCard.tsx', 'utf8')
  const hero = readFileSync('components/music/MusicHero.tsx', 'utf8')
  const search = readFileSync('components/music/MusicSearchDialog.tsx', 'utf8')
  assert.match(carousel, /from 'framer-motion'/)
  assert.match(carousel, /drag=\{interactionPaused \? false : 'x'\}/)
  assert.match(carousel, /onWheel=\{onWheel\}/)
  assert.match(carousel, /touch-pan-y/)
  assert.match(carousel, /router\.push\(`\/music\/album\/\$\{album\.id\}`\)/)
  assert.doesNotMatch(card, /rotateY|perspective/)
  assert.match(card, /scale: selected \? 1\.06 : 0\.92/)
  assert.match(card, /opacity:/)
  assert.match(card, /260px/)
  assert.match(card, /Tracks/)
  assert.match(hero, /variant="glass"/)
  assert.match(search, /backdrop-blur/)
  assert.match(carousel, /Math\.abs\(offsets\[index\]\) <= 1/)
  assert.match(carousel, /sm:w-\[540px\]/)
  assert.match(carousel, /lg:w-\[660px\]/)
  assert.match(card, /left-1\/2/)
  assert.match(card, /-translate-x-1\/2/)
  assert.doesNotMatch(card, /translateZ|rotate:/)
})

test('音乐搜索弹窗使用 body portal、最高层级并锁定底层交互', () => {
  const dialog = readFileSync('components/music/MusicSearchDialog.tsx', 'utf8')
  const carousel = readFileSync('components/music/MusicAlbumCarousel.tsx', 'utf8')
  assert.match(dialog, /createPortal/)
  assert.match(dialog, /document\.body/)
  assert.match(dialog, /z-\[10000\]/)
  assert.match(dialog, /body\.style\.overflow = 'hidden'/)
  assert.match(dialog, /easmusic:search-dialog/)
  assert.match(dialog, /backdrop-blur-\[18px\]/)
  assert.match(carousel, /interactionPaused/)
  assert.match(carousel, /easmusic:search-dialog/)
})

test('音乐首页、专辑详情和歌曲详情统一使用沉浸式档案馆视觉', () => {
  const home = readFileSync('app/music/page.tsx', 'utf8')
  const album = readFileSync('app/music/album/[id]/page.tsx', 'utf8')
  const song = readFileSync('app/music/song/[id]/page.tsx', 'utf8')
  const shell = readFileSync('components/music/MusicArchiveShell.tsx', 'utf8')
  for (const source of [home, album, song]) assert.match(source, /MusicArchiveShell/)
  assert.match(shell, /#050914/)
  assert.match(shell, /#07182d/)
  assert.match(shell, /#0b2038/)
  assert.match(album, /formatMusicReleaseDate/)
  assert.match(album, /album\.story/)
  assert.match(album, /song\.arranger/)
  assert.match(song, /song\.album\.coverUrl/)
  assert.match(song, /whitespace-pre-wrap/)
  assert.match(song, /max-h-\[680px\]/)
})

test('音乐搜索覆盖歌曲、专辑、年份、作词和作曲', () => {
  const route = readFileSync('app/api/music/search/route.ts', 'utf8')
  const dialog = readFileSync('components/music/MusicSearchDialog.tsx', 'utf8')
  assert.match(route, /title: \{ contains: query/)
  assert.match(route, /lyricist: \{ contains: query/)
  assert.match(route, /composer: \{ contains: query/)
  assert.match(route, /album: \{ name: \{ contains: query/)
  assert.match(route, /yearFilter/)
  assert.match(dialog, /\/api\/music\/search\?q=/)
  assert.match(dialog, /\/music\/song\/\$\{song\.id\}/)
})

test('音乐封面统一使用 next/image 并保持懒加载', () => {
  const cover = readFileSync('components/music/MusicCover.tsx', 'utf8')
  const card = readFileSync('components/music/MusicAlbum3DCard.tsx', 'utf8')
  assert.match(cover, /import Image from 'next\/image'/)
  assert.match(cover, /loading="lazy"/)
  assert.match(card, /import Image from 'next\/image'/)
  assert.match(card, /loading="lazy"/)
  assert.doesNotMatch(`${cover}\n${card}`, /<img/)
})

test('Excel 导入功能与 xlsx 依赖已移除', () => {
  const packageJson = readFileSync('package.json', 'utf8')
  assert.equal(existsSync('app/admin/music/import/page.tsx'), false)
  assert.equal(existsSync('app/api/admin/music/import/route.ts'), false)
  assert.doesNotMatch(packageJson, /"xlsx"/)
})

test('播放器仍为中立框架且不连接音频', () => {
  const player = readFileSync('components/music/MusicPlayer.tsx', 'utf8')
  assert.match(player, /播放入口（框架）/)
  assert.doesNotMatch(player, /<audio|new Audio|\.play\(/)
})
