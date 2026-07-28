import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { parseBulkSetlist, parseSetlistItems } from '../lib/music-live'

const read = (path: string) => readFileSync(path, 'utf8')

test('现场档案 Prisma 模型复用发布状态并安全定义删除关系', () => {
  const schema = read('prisma/schema.prisma')
  for (const model of ['MusicTour', 'MusicConcert', 'MusicConcertSetlistItem', 'MusicConcertHighlight']) assert.match(schema, new RegExp(`model ${model} \\{`))
  assert.match(schema, /model MusicTour \{[\s\S]*status\s+MusicPublicationStatus[\s\S]*MusicConcert\s+MusicConcert\[\]/)
  assert.match(schema, /MusicTour\s+MusicTour\s+@relation\(fields: \[tourId\], references: \[id\], onDelete: Restrict\)/)
  assert.match(schema, /MusicConcert\s+MusicConcert\s+@relation\(fields: \[concertId\], references: \[id\], onDelete: Cascade\)/)
  assert.match(schema, /MusicSong\s+MusicSong\?\s+@relation\(fields: \[songId\], references: \[id\], onDelete: SetNull\)/)
})

test('MySQL migration 只新增现场表、索引和外键', () => {
  const sql = read('prisma/migrations/20260729160000_add_easmusic_live_archive/migration.sql')
  assert.match(sql, /CREATE TABLE `MusicTour`/)
  assert.match(sql, /CREATE TABLE `MusicConcert`/)
  assert.match(sql, /ON DELETE RESTRICT/)
  assert.match(sql, /ON DELETE CASCADE/)
  assert.doesNotMatch(sql, /DROP TABLE|DROP COLUMN|RENAME|TRUNCATE|DELETE FROM/)
})

test('非管理员不能访问巡演和演唱会管理 API', () => {
  for (const path of ['app/api/admin/music/tours/route.ts', 'app/api/admin/music/tours/[tourId]/route.ts', 'app/api/admin/music/concerts/route.ts', 'app/api/admin/music/concerts/[concertId]/route.ts']) {
    assert.match(read(path), /requireAdmin\('music_manage'\)/)
  }
})

test('公开接口过滤草稿巡演、草稿场次及草稿所属巡演', () => {
  const home = read('app/api/music/live/route.ts')
  const tour = read('app/api/music/live/tours/[tourId]/route.ts')
  const concert = read('app/api/music/live/concerts/[concertId]/route.ts')
  assert.match(home, /musicTour\.findMany\([\s\S]*status: 'PUBLISHED'/)
  assert.match(home, /musicConcert\.findMany\([\s\S]*status: 'PUBLISHED', MusicTour: \{ status: 'PUBLISHED' \}/)
  assert.match(tour, /id: tourId, status: 'PUBLISHED'/)
  assert.match(concert, /id: concertId, status: 'PUBLISHED', MusicTour: \{ status: 'PUBLISHED' \}/)
})

test('歌单项必须有 songId 或 displayName 且顺序连续归一化', () => {
  const invalid = parseSetlistItems([{ songId: null, displayName: ' ', section: 'MAIN', position: 99 }])
  assert.equal(invalid.items, undefined)
  const valid = parseSetlistItems([
    { songId: null, displayName: '清唱', section: 'SPECIAL', position: 90 },
    { songId: 'song-1', displayName: '', section: 'MAIN', position: 2 },
  ])
  assert.deepEqual(valid.items?.map((item) => item.position), [1, 2])
})

test('删除含场次巡演被阻止并返回关联数量', () => {
  const route = read('app/api/admin/music/tours/[tourId]/route.ts')
  assert.match(route, /_count\.MusicConcert > 0/)
  assert.match(route, /已有 \$\{tour\._count\.MusicConcert\} 个场次/)
  assert.match(route, /status: 409/)
})

test('删除场次依赖数据库只级联其歌单和特别时刻', () => {
  const route = read('app/api/admin/music/concerts/[concertId]/route.ts')
  assert.match(route, /musicConcert\.delete\(\{ where: \{ id: concertId \} \}\)/)
  assert.doesNotMatch(route, /musicSong\.delete|musicTour\.delete/)
})

test('场次保存以事务更新基本信息并重建当前场次附属资料', () => {
  const route = read('app/api/admin/music/concerts/[concertId]/route.ts')
  assert.match(route, /prisma\.\$transaction/)
  assert.match(route, /musicConcertSetlistItem\.deleteMany\(\{ where: \{ concertId \} \}\)/)
  assert.match(route, /musicConcertHighlight\.deleteMany\(\{ where: \{ concertId \} \}\)/)
  assert.doesNotMatch(route, /musicSong\.delete/)
})

test('批量粘贴去除序号、项目符号、空行和多余空格', () => {
  assert.deepEqual(parseBulkSetlist('1. 2001太空漫游\n\n 2、 美丽有罪 \n- 任我行\n• 人来人往'), ['2001太空漫游', '美丽有罪', '任我行', '人来人往'])
})

test('同名歌曲只在精确唯一匹配时自动关联', () => {
  const route = read('app/api/admin/music/live-song-match/route.ts')
  assert.match(route, /title: \{ in: uniqueNames \}/)
  assert.match(route, /matches\.length === 1 \? matches\[0\]\.id : null/)
  assert.match(route, /candidates: matches/)
  assert.doesNotMatch(route, /contains: name/)
})

test('巡演与场次搜索只返回已发布资料并保留歌词搜索', () => {
  const route = read('app/api/music/search/route.ts')
  assert.match(route, /musicTour\.findMany\([\s\S]*status: 'PUBLISHED'/)
  assert.match(route, /musicConcert\.findMany\([\s\S]*MusicTour: \{ status: 'PUBLISHED' \}/)
  assert.match(route, /lyrics: \{ contains: query \}/)
  assert.match(route, /buildMusicLyricSnippet/)
})

test('场次详情仅选择歌曲必要字段且不返回完整歌词', () => {
  for (const path of ['app/api/music/live/concerts/[concertId]/route.ts', 'app/music/live/concerts/[concertId]/page.tsx']) {
    const source = read(path)
    assert.match(source, /MusicSong: \{ select: \{/)
    assert.doesNotMatch(source, /lyrics: true|story: true/)
  }
})

test('Eason现场公开页面覆盖空状态、巡演和场次详情', () => {
  for (const path of ['app/music/live/page.tsx', 'app/music/live/tours/[tourId]/page.tsx', 'app/music/live/concerts/[concertId]/page.tsx']) assert.equal(existsSync(path), true)
  const home = read('app/music/live/page.tsx')
  assert.match(home, /现场档案正在整理中/)
  assert.match(home, /status: 'PUBLISHED'/)
  assert.match(read('app/music/live/tours/[tourId]/page.tsx'), /notFound\(\)/)
  assert.match(read('app/music/live/concerts/[concertId]/page.tsx'), /notFound\(\)/)
})

test('未关联歌曲不生成链接，已关联歌曲复用现有详情路由', () => {
  const page = read('app/music/live/concerts/[concertId]/page.tsx')
  assert.match(page, /item\.MusicSong \? <Link href=\{`\/music\/song\/\$\{item\.MusicSong\.id\}`\}/)
  assert.match(page, /: <span className=.*>\{name\}<\/span>/)
})

test('现场首页和详情继续使用 EasMusic 深蓝壳层并限制横向溢出', () => {
  const shell = read('components/music/MusicArchiveShell.tsx')
  assert.match(shell, /min-h-screen \[overflow-x:clip\] bg-\[#06101d\]/)
  for (const path of ['app/music/live/page.tsx', 'app/music/live/tours/[tourId]/page.tsx', 'app/music/live/concerts/[concertId]/page.tsx']) assert.match(read(path), /MusicArchiveShell/)
})

test('320px 现场布局采用 min-w-0、移动歌单布局和无固定宽度主表', () => {
  const sources = [read('app/music/live/page.tsx'), read('app/music/live/tours/[tourId]/page.tsx'), read('app/music/live/concerts/[concertId]/page.tsx'), read('components/music/live/LiveConcertList.tsx')].join('\n')
  assert.match(sources, /min-w-0/)
  assert.match(sources, /grid-cols-\[36px_minmax\(0,1fr\)\]/)
  assert.doesNotMatch(sources, /min-w-\[(?:8|9|10)\d\dpx\]/)
})

test('后台编辑器支持搜索、拖动、上下移动、批量粘贴、复制和未保存提示', () => {
  const editor = read('app/admin/music/concerts/[concertId]/AdminConcertEditor.tsx')
  assert.match(editor, /draggable/)
  assert.match(editor, /onDragStart/)
  assert.match(editor, /aria-label="上移"/)
  assert.match(editor, /批量粘贴歌单/)
  assert.match(editor, /从已有场次复制歌单/)
  assert.match(editor, /beforeunload/)
  assert.match(editor, /尚未写入数据库/)
})

test('后台入口只有通过页面管理员权限校验后展示', () => {
  const tours = read('app/admin/music/tours/page.tsx')
  const concerts = read('app/admin/music/concerts/page.tsx')
  assert.match(tours, /requireAdminPage\('\/admin\/music\/tours', 'music_manage'\)/)
  assert.match(concerts, /requireAdminPage\('\/admin\/music\/concerts', 'music_manage'\)/)
  const admin = read('app/admin/music/page.tsx')
  assert.match(admin, /巡演管理/)
  assert.match(admin, /演唱会管理/)
})

test('现有 EasMusic 首页保留精选 fallback、搜索和新增现场入口', () => {
  const home = read('app/music/page.tsx')
  assert.match(home, /featuredAlbums\.length > 0/)
  assert.match(home, /MusicSearchDialog/)
  assert.match(home, /Eason现场/)
  assert.match(home, /href="\/music\/live"/)
})

test('现有移动导航仍保持五项且 EasMusic 入口不变', () => {
  const navigation = read('components/layout/navigation.ts')
  assert.match(navigation, /href: '\/music'/)
  assert.doesNotMatch(navigation, /href: '\/music\/live'/)
  const mobile = read('components/layout/MobileNavigation.tsx')
  assert.match(mobile, /primaryNavigation\.filter\(\(item\) => item\.mobile\)/)
})
