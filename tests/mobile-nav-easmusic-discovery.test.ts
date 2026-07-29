import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { buildMusicLyricSnippet } from '../lib/music-search'

test('移动底部导航固定为首页、广场、E院中心、EasMusic、我的', () => {
  const navigation = readFileSync('components/layout/navigation.ts', 'utf8')
  const mobile = readFileSync('components/layout/MobileNavigation.tsx', 'utf8')
  const shell = readFileSync('components/layout/AppShell.tsx', 'utf8')
  assert.match(navigation, /href: '\/music'[\s\S]*mobile: true/)
  assert.doesNotMatch(navigation, /href: '\/notifications'[\s\S]{0,120}mobile: true/)
  assert.match(mobile, /aria-label="E院中心"/)
  assert.match(mobile, /UiIcon name="grid"/)
  for (const href of ['/posts/new', '/checkin', '/games', '/activities', '/notifications', '/trending', '/feedback']) {
    assert.match(mobile, new RegExp(`href: '${href.replace('/', '\\/')}'`))
  }
  assert.doesNotMatch(mobile, /href: '\/rankings'/)
  assert.match(mobile, /canAccessAdmin[\s\S]*href: '\/admin'/)
  assert.match(shell, /canAccessAdmin=\{canAccessAdmin\}/)
})

test('E院中心抽屉支持遮罩、关闭、返回键、路由变化及滚动锁定', () => {
  const mobile = readFileSync('components/layout/MobileNavigation.tsx', 'utf8')
  assert.match(mobile, /mobile-center-backdrop/)
  assert.match(mobile, /createPortal\(/)
  assert.match(mobile, /onPointerDown=\{consumeBackdropEvent\}/)
  assert.match(mobile, /event\.preventDefault\(\)/)
  assert.match(mobile, /event\.stopPropagation\(\)/)
  assert.match(mobile, /history\.pushState/)
  assert.match(mobile, /window\.history\.back/)
  assert.match(mobile, /addEventListener\('popstate'/)
  assert.match(mobile, /useEffect\(\(\) => setCenterOpen\(false\), \[pathname\]\)/)
  assert.match(mobile, /root\.style\.overflow = 'hidden'/)
  assert.match(mobile, /body\.style\.overflow = 'hidden'/)
})

test('历史精选字段保持兼容，但 EasMusic 首页展示全部已发布专辑', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  const migration = readFileSync('prisma/migrations/20260729010000_add_music_album_featured_fields/migration.sql', 'utf8')
  const home = readFileSync('app/music/page.tsx', 'utf8')
  const createApi = readFileSync('app/api/admin/music/albums/route.ts', 'utf8')
  const updateApi = readFileSync('app/api/admin/music/albums/[albumId]/route.ts', 'utf8')
  const manager = readFileSync('app/admin/music/albums/AdminAlbumManager.tsx', 'utf8')
  const editor = readFileSync('app/admin/music/albums/[albumId]/AdminAlbumEditor.tsx', 'utf8')
  assert.match(schema, /isFeatured\s+Boolean\s+@default\(false\)/)
  assert.match(schema, /featuredOrder\s+Int\?/)
  assert.match(migration, /ALTER TABLE `MusicAlbum`/)
  assert.match(migration, /`isFeatured` BOOLEAN NOT NULL DEFAULT false/)
  assert.doesNotMatch(migration, /DROP|DELETE|TRUNCATE/)
  assert.match(home, /musicAlbum\.findMany\(\{ where: \{ status: 'PUBLISHED' \}/)
  assert.match(home, /displayOrder: 'asc'/)
  assert.doesNotMatch(home, /isFeatured: true|featuredAlbums/)
  for (const source of [createApi, updateApi]) {
    assert.match(source, /parseMusicFeatured/)
    assert.match(source, /featuredOrder/)
  }
  for (const source of [manager, editor]) {
    assert.match(source, /设为精选专辑/)
    assert.match(source, /精选排序/)
  }
})

test('音乐搜索覆盖歌词与完整资料字段，且只返回歌词命中片段', () => {
  const route = readFileSync('app/api/music/search/route.ts', 'utf8')
  const dialog = readFileSync('components/music/MusicSearchDialog.tsx', 'utf8')
  for (const field of ['title', 'lyrics', 'lyricist', 'composer', 'arranger', 'story', 'description', 'artist']) {
    assert.match(route, new RegExp(`${field}: \\{ contains: query \\}`))
  }
  assert.match(route, /take: 30/)
  assert.match(route, /buildMusicLyricSnippet\(lyrics, query\)/)
  assert.doesNotMatch(route, /\.\.\.song,\s*lyrics/)
  assert.match(dialog, /歌词命中：\{song\.lyricSnippet\}/)
  assert.match(dialog, /歌曲 · \{song\.album\.name\}/)
  const snippet = buildMusicLyricSnippet('沿途与他车厢中私奔般恋爱，再挤逼都不放开。', '车厢中私奔')
  assert.match(snippet || '', /车厢中私奔/)
  assert.ok((snippet || '').length < 80)
})

test('EasMusic 路由为 html、body、AppShell、Footer 和固定视觉层提供深蓝背景', () => {
  const shell = readFileSync('components/music/MusicArchiveShell.tsx', 'utf8')
  const appShell = readFileSync('components/layout/AppShell.tsx', 'utf8')
  const css = readFileSync('app/globals.css', 'utf8')
  assert.match(shell, /easmusic-route-active/)
  assert.match(shell, /fixed inset-0 z-0/)
  assert.match(appShell, /data-music-route/)
  assert.match(css, /html\.easmusic-route-active/)
  assert.match(css, /app-shell\[data-music-route='true'\][\s\S]*site-footer-info/)
})
