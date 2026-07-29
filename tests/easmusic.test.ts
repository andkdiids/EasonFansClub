import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import sharp from 'sharp'
import { convertMusicCoverToWebp, MUSIC_COVER_MAX_WIDTH, MUSIC_COVER_QUALITY } from '../lib/music-cover'
import { formatTrackCount } from '../lib/music-display'
import { isMusicRoute } from '../lib/navigation'

test('EasMusic CMS schema 补齐发布、故事、排序和歌曲介绍字段', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  assert.match(schema, /enum MusicPublicationStatus \{[\s\S]*DRAFT[\s\S]*PUBLISHED/)
  assert.match(schema, /model MusicAlbum \{[\s\S]*releaseDate\s+DateTime\?[\s\S]*company\s+String\?[\s\S]*story\s+String\?[\s\S]*status\s+MusicPublicationStatus[\s\S]*displayOrder\s+Int/)
  assert.match(schema, /model MusicSong \{[\s\S]*description\s+String\?/)
  assert.match(schema, /model MusicSong \{[\s\S]*lyrics\s+String\?/)
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
  assert.match(song, /coverUrl: optionalMusicText\(body\?\.coverUrl, 1000\) \|\| album\.coverUrl/)
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
  assert.equal(metadata.hasAlpha, false)
})

test('CMYK JPG 标准化后可转换为 WebP', async () => {
  const source = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: '#f2c230' },
  }).toColourspace('cmyk').jpeg({ quality: 90 }).toBuffer()
  const sourceMetadata = await sharp(source).metadata()
  assert.equal(sourceMetadata.format, 'jpeg')
  assert.equal(sourceMetadata.space, 'cmyk')

  const output = await convertMusicCoverToWebp(source)
  const metadata = await sharp(output).metadata()
  assert.equal(metadata.format, 'webp')
  assert.equal(metadata.width, 1200)
  assert.equal(metadata.height, 800)
  assert.equal(metadata.space, 'srgb')
  assert.equal(metadata.hasAlpha, false)
})

test('WebP 封面标准化后仍输出 WebP', async () => {
  const source = await sharp({
    create: { width: 900, height: 600, channels: 4, background: { r: 20, g: 90, b: 160, alpha: 0.5 } },
  }).webp({ quality: 95 }).toBuffer()
  const output = await convertMusicCoverToWebp(source)
  const metadata = await sharp(output).metadata()
  assert.equal(metadata.format, 'webp')
  assert.equal(metadata.width, 900)
  assert.equal(metadata.height, 600)
  assert.equal(metadata.hasAlpha, false)
})

test('封面 API 使用固定 WebP 路径和腾讯云 COS', () => {
  const route = readFileSync('app/api/admin/music/covers/route.ts', 'utf8')
  assert.match(route, /const folder = entityType === 'album' \? 'albums'[\s\S]*'tours' : 'concerts'/)
  assert.match(route, /music-cover\/\$\{folder\}\/\$\{entityId\}\/cover\.webp/)
  assert.match(route, /uploadMusicMedia\(\{ kind: 'cover'/)
  assert.match(route, /contentType: 'image\/webp'/)
  assert.doesNotMatch(route, /SUPABASE|supabase/i)
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

test('沉浸式专辑墙使用 rAF 缓动、跟手拖动、滚轮、触摸和详情跳转', () => {
  const carousel = readFileSync('components/music/MusicAlbumCarousel.tsx', 'utf8')
  const card = readFileSync('components/music/MusicAlbum3DCard.tsx', 'utf8')
  const hero = readFileSync('components/music/MusicHero.tsx', 'utf8')
  const search = readFileSync('components/music/MusicSearchDialog.tsx', 'utf8')
  assert.match(carousel, /requestAnimationFrame/)
  assert.doesNotMatch(carousel, /setInterval|setTimeout/)
  assert.match(carousel, /0\.22, 1, 0\.36, 1/)
  assert.match(carousel, /onPointerDown=\{onPointerDown\}/)
  assert.match(carousel, /onPointerMove=\{onPointerMove\}/)
  assert.match(carousel, /onWheel=\{onWheel\}/)
  assert.match(carousel, /touch-pan-y/)
  assert.match(carousel, /router\.push\(`\/music\/album\/\$\{album\.id\}`\)/)
  assert.doesNotMatch(card, /rotateY|perspective/)
  assert.match(card, /1 - 0\.1 \* blend/)
  assert.match(card, /1 - 0\.24 \* blend/)
  assert.match(card, /translate3d/)
  assert.match(card, /willChange: 'transform, opacity'/)
  assert.match(card, /backfaceVisibility: 'hidden'/)
  assert.match(card, /opacity:/)
  assert.match(card, /width: cardWidth/)
  assert.match(card, /formatTrackCount/)
  assert.match(hero, /variant="glass"/)
  assert.match(search, /backdrop-blur/)
  assert.match(carousel, /Math\.abs\(offsets\[index\]\) <= layout\.visibleRange/)
  assert.match(carousel, /md:w-\[calc\(100%-144px\)\]/)
  assert.match(carousel, /xl:w-\[calc\(100%-160px\)\]/)
  assert.match(card, /left-1\/2/)
  assert.match(card, /calc\(-50%/)
  assert.doesNotMatch(card, /translateZ|rotate:/)
})

test('EasMusic 轮播按舞台宽度展示至多五张且移动端保持收窄', () => {
  const carousel = readFileSync('components/music/MusicAlbumCarousel.tsx', 'utf8')
  const card = readFileSync('components/music/MusicAlbum3DCard.tsx', 'utf8')
  const navigation = readFileSync('components/SiteNavigation.tsx', 'utf8')
  assert.match(card, /style=\{\{ width: cardWidth/)
  assert.match(card, /selected \? 30/)
  assert.match(card, /12 - distance/)
  assert.match(carousel, /cardWidth \* 0\.64/)
  assert.match(carousel, /\(width - cardWidth\) \/ 4/)
  assert.match(carousel, /visibleRange: 2/)
  assert.match(carousel, /Math\.abs\(offsets\[index\]\) <= layout\.visibleRange/)
  assert.match(carousel, /max-w-7xl/)
  assert.match(carousel, /md:w-\[calc\(100%-144px\)\]/)
  assert.match(carousel, /h-\[250px\]/)
  assert.match(carousel, /absolute left-0/)
  assert.match(carousel, /absolute right-0/)
  assert.match(carousel, /hidden size-\[52px\][\s\S]*md:grid/)
  assert.equal((carousel.match(/查看当前专辑/g) || []).length, 0)
  assert.match(carousel, /clickedIndex === selected/)
  assert.match(carousel, /animateTo\(drag\.clickedIndex\)/)
  assert.match(navigation, /usePathname/)
  assert.match(navigation, /aria-current=\{active \? 'page'/)
  assert.match(navigation, /isMusicRoute\(pathname\)/)
})

test('EasMusic Canvas 粒子只在音乐壳层运行并清理动画与交互监听', () => {
  const shell = readFileSync('components/music/MusicArchiveShell.tsx', 'utf8')
  const canvas = readFileSync('components/music/MusicParticleCanvas.tsx', 'utf8')
  assert.match(shell, /<MusicParticleCanvas \/>/)
  assert.match(canvas, /requestAnimationFrame\(draw\)/)
  assert.match(canvas, /cancelAnimationFrame\(frame\)/)
  assert.match(canvas, /removeEventListener\('pointermove'/)
  assert.match(canvas, /removeEventListener\('click'/)
  assert.match(canvas, /ResizeObserver/)
  assert.match(canvas, /hover: hover/)
})

test('歌曲数量统一中文格式且异常输入安全归零', () => {
  assert.equal(formatTrackCount(10), '10 首')
  assert.equal(formatTrackCount(0), '0 首')
  assert.equal(formatTrackCount(undefined), '0 首')
  assert.equal(formatTrackCount(null), '0 首')
  assert.equal(formatTrackCount(Number.NaN), '0 首')
  assert.equal(formatTrackCount(Number.POSITIVE_INFINITY), '0 首')
  assert.equal(formatTrackCount(-3), '0 首')
  const sources = [
    'app/music/page.tsx',
    'app/music/albums/page.tsx',
    'app/music/album/[id]/page.tsx',
    'app/music/song/[id]/page.tsx',
    'components/music/MusicAlbumCard.tsx',
    'components/music/MusicAlbum3DCard.tsx',
  ].map((file) => readFileSync(file, 'utf8')).join('\n')
  assert.doesNotMatch(sources, /\bTracks?\b/)
})

test('音乐路由主题覆盖所有子路由且不误判相似路径', () => {
  assert.equal(isMusicRoute('/music'), true)
  assert.equal(isMusicRoute('/music/albums'), true)
  assert.equal(isMusicRoute('/music/album/abc'), true)
  assert.equal(isMusicRoute('/music/song/abc'), true)
  assert.equal(isMusicRoute('/musical'), false)
  assert.equal(isMusicRoute('/musicology'), false)
  assert.equal(isMusicRoute('/forum'), false)
  const frame = readFileSync('components/SiteHeaderFrame.tsx', 'utf8')
  const navigation = readFileSync('components/SiteNavigation.tsx', 'utf8')
  assert.match(frame, /isMusicRoute\(pathname\)/)
  assert.match(navigation, /isMusicRoute\(pathname\)/)
})

test('专辑墙、移动端精选卡片与轻量背景动效统一为音乐档案馆视觉', () => {
  const albums = readFileSync('app/music/albums/page.tsx', 'utf8')
  const home = readFileSync('app/music/page.tsx', 'utf8')
  const card = readFileSync('components/music/MusicAlbumCard.tsx', 'utf8')
  const shell = readFileSync('components/music/MusicArchiveShell.tsx', 'utf8')
  const globalCss = readFileSync('app/globals.css', 'utf8')
  assert.match(albums, /MusicArchiveShell/)
  assert.match(albums, /grid-cols-2[\s\S]*sm:grid-cols-3[\s\S]*lg:grid-cols-4[\s\S]*xl:grid-cols-5/)
  assert.match(albums, /theme="dark"/)
  assert.match(home, /grid-cols-1[\s\S]*min-\[360px\]:grid-cols-2[\s\S]*sm:grid-cols-3[\s\S]*md:grid-cols-4[\s\S]*lg:grid-cols-5[\s\S]*xl:grid-cols-7[\s\S]*2xl:grid-cols-8/)
  assert.match(home, /albums\.map\(\(album\)/)
  assert.match(card, /max-w-\[175px\]/)
  assert.match(card, /line-clamp-2[\s\S]*xl:min-h-10[\s\S]*xl:text-\[15px\]/)
  assert.match(shell, /matchMedia\('\(hover: hover\) and \(pointer: fine\) and \(min-width: 768px\)'\)/)
  assert.match(shell, /requestAnimationFrame/)
  assert.match(shell, /removeEventListener\('pointermove'/)
  assert.match(shell, /useReducedMotion/)
  assert.match(globalCss, /prefers-reduced-motion: reduce/)
})

test('音乐搜索弹窗使用 body portal、最高层级并锁定底层交互', () => {
  const dialog = readFileSync('components/music/MusicSearchDialog.tsx', 'utf8')
  const carousel = readFileSync('components/music/MusicAlbumCarousel.tsx', 'utf8')
  assert.match(dialog, /createPortal/)
  assert.match(dialog, /document\.body/)
  assert.match(dialog, /z-\[var\(--layer-dialog\)\]/)
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
  assert.match(song, /song\.MusicAlbum\.coverUrl/)
  assert.match(song, /whitespace-pre-wrap/)
  assert.doesNotMatch(song, /max-h-\[680px\]|overflow-y-auto/)
  assert.match(shell, /\[overflow-x:clip\]/)
})

test('音乐搜索覆盖歌曲、专辑、歌词、年份和创作资料', () => {
  const route = readFileSync('app/api/music/search/route.ts', 'utf8')
  const dialog = readFileSync('components/music/MusicSearchDialog.tsx', 'utf8')
  assert.match(route, /title: \{ contains: query/)
  assert.match(route, /lyricist: \{ contains: query/)
  assert.match(route, /composer: \{ contains: query/)
  assert.match(route, /arranger: \{ contains: query/)
  assert.match(route, /lyrics: \{ contains: query/)
  assert.match(route, /MusicAlbum: \{ name: \{ contains: query/)
  assert.match(route, /artist: \{ contains: query/)
  assert.match(route, /buildMusicLyricSnippet/)
  assert.match(route, /yearFilter/)
  assert.match(dialog, /\/api\/music\/search\?q=/)
  assert.match(dialog, /\/music\/song\/\$\{song\.id\}/)
})

test('音乐封面保持懒加载且轮播卡片使用隔离的原生图片层', () => {
  const cover = readFileSync('components/music/MusicCover.tsx', 'utf8')
  const card = readFileSync('components/music/MusicAlbum3DCard.tsx', 'utf8')
  assert.match(cover, /import Image from 'next\/image'/)
  assert.match(cover, /loading="lazy"/)
  assert.doesNotMatch(card, /import Image from 'next\/image'/)
  assert.match(card, /loading="lazy"/)
  assert.match(card, /<img/)
  assert.doesNotMatch(card, /filter|mix-blend-mode|mask/)
})

test('Excel 导入功能与 xlsx 依赖已移除', () => {
  const packageJson = readFileSync('package.json', 'utf8')
  assert.equal(existsSync('app/admin/music/import/page.tsx'), false)
  assert.equal(existsSync('app/api/admin/music/import/route.ts'), false)
  assert.doesNotMatch(packageJson, /"xlsx"/)
})

test('播放器只连接服务器生成的7秒试听且不循环', () => {
  const player = readFileSync('components/music/MusicPlayer.tsx', 'utf8')
  assert.match(player, /<audio/)
  assert.match(player, /previewUrl/)
  assert.match(player, /Math\.min\(7, previewDuration \|\| 7\)/)
  assert.match(player, /loop=\{false\}/)
  assert.match(player, /audio\.currentTime >= duration/)
})
