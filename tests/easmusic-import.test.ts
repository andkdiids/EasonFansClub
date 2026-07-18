import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import * as XLSX from 'xlsx'
import { parseMusicImportWorkbook } from '../lib/music-import'

function asArrayBuffer(buffer: Buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
}

test('XLSX 同时解析 Albums、Songs 并识别辅助 Sheet', () => {
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{
    album_name: 'U87', artist: '陈奕迅', release_year: 2005, language: '粤语', cover_url: '/u87.jpg', description: '专辑介绍', era: '2000s', album_type: '录音室专辑',
  }]), 'Albums')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{
    title: '夕阳无限好', album_name: 'U87', track_number: 1, release_year: 2005, language: '粤语', lyricist: '林夕', composer: 'Eric Kwok', arranger: 'Eric Kwok', producer: 'Alvin Leong', story: '歌曲故事', tags: '经典,粤语', era: '2000s', track_type: '录音室', concert_version: '', mood: '怀念', scene: '夜晚', recommend_level: 'S',
  }]), 'Songs')
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ tag: '经典' }]), 'SongTags')
  const file = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer

  const parsed = parseMusicImportWorkbook('easmusic.xlsx', asArrayBuffer(file))
  assert.equal(parsed.failures.length, 0)
  assert.equal(parsed.albums.length, 1)
  assert.equal(parsed.albums[0].albumType, '录音室专辑')
  assert.equal(parsed.songs.length, 1)
  assert.equal(parsed.songs[0].recommendLevel, 'S')
  assert.deepEqual(parsed.ignoredSheets, ['SongTags'])
})

test('CSV 根据表头识别歌曲数据', () => {
  const csv = '\uFEFFtitle,album_name,track_number,release_year,language\n陀飞轮,Time Flies,3,2010,粤语\n'
  const bytes = new TextEncoder().encode(csv)
  const parsed = parseMusicImportWorkbook('songs.csv', bytes.buffer as ArrayBuffer)
  assert.equal(parsed.failures.length, 0)
  assert.equal(parsed.albums.length, 0)
  assert.equal(parsed.songs[0].title, '陀飞轮')
  assert.equal(parsed.songs[0].trackNumber, 3)
})

test('无效年份和曲序会返回逐行失败原因', () => {
  const csv = 'title,album_name,track_number,release_year\n测试歌曲,测试专辑,0,abcd\n'
  const bytes = new TextEncoder().encode(csv)
  const parsed = parseMusicImportWorkbook('invalid.csv', bytes.buffer as ArrayBuffer)
  assert.equal(parsed.songs.length, 0)
  assert.equal(parsed.failures.length, 2)
  assert.ok(parsed.failures.every((failure) => failure.sheet === 'Songs' && failure.row === 2))
})

test('导入 API 使用管理员权限、Serializable 事务且只新增数据', () => {
  const route = readFileSync('app/api/admin/music/import/route.ts', 'utf8')
  assert.match(route, /requireAdmin\('music_manage'\)/)
  assert.match(route, /prisma\.\$transaction/)
  assert.match(route, /TransactionIsolationLevel\.Serializable/)
  assert.match(route, /musicAlbum\.create/)
  assert.match(route, /musicSong\.createMany/)
  assert.doesNotMatch(route, /musicAlbum\.(update|delete)/)
  assert.doesNotMatch(route, /musicSong\.(update|delete)/)
  assert.match(route, /事务已回滚/)
})

test('重复规则按 album_name 与 title + album 组合处理', () => {
  const route = readFileSync('app/api/admin/music/import/route.ts', 'utf8')
  assert.match(route, /normalizeMusicImportKey\(album\.name\)/)
  assert.match(route, /normalizeMusicImportKey\(song\.title\)/)
  assert.match(route, /skippedAlbums \+= 1/)
  assert.match(route, /skippedSongs \+= 1/)
})

test('导入扩展字段具有 migration 且不修改其他业务模型', () => {
  const schema = readFileSync('prisma/schema.prisma', 'utf8')
  const migration = readFileSync('prisma/migrations/20260718190000_add_easmusic_import_fields/migration.sql', 'utf8')
  assert.match(schema, /model MusicAlbum \{[\s\S]*era\s+String\?[\s\S]*albumType\s+String\?/)
  assert.match(schema, /model MusicSong \{[\s\S]*recommendLevel\s+String\?[\s\S]*@@unique\(\[albumId, title\]\)/)
  assert.match(migration, /ALTER TABLE "MusicAlbum"/)
  assert.match(migration, /ALTER TABLE "MusicSong"/)
  assert.match(migration, /MusicSong_albumId_title_key/)
  assert.doesNotMatch(migration, /"User"|"Post"|"CheckIn"|"Friendship"|"PointLog"/)
})

test('后台导入页限制文件格式并展示结果与失败原因', () => {
  const page = readFileSync('app/admin/music/import/page.tsx', 'utf8')
  const panel = readFileSync('app/admin/music/import/MusicImportPanel.tsx', 'utf8')
  assert.match(page, /requireAdminPage\('\/admin\/music\/import', 'music_manage'\)/)
  assert.match(panel, /accept="\.xlsx,\.csv/)
  assert.match(panel, /新增专辑/)
  assert.match(panel, /新增歌曲/)
  assert.match(panel, /失败原因/)
  assert.match(panel, /未写入 \/ 已回滚/)
})
