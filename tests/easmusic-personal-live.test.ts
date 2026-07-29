import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  buildPersonalSongAtlas,
  normalizedCityKey,
  parseAttendanceInput,
  parseAttendanceVersion,
  parsePersonalPageSize,
  summarizePersonalLiveRows,
  type PersonalLiveRow,
} from '../lib/music-personal-live'

const read = (path: string) => readFileSync(path, 'utf8')

function row(overrides: {
  id?: string
  concertId?: string
  tourId?: string
  date?: string
  city?: string
  status?: 'DRAFT' | 'PUBLISHED'
  tourStatus?: 'DRAFT' | 'PUBLISHED'
  isPublic?: boolean
  setlist?: PersonalLiveRow['MusicConcert']['MusicConcertSetlistItem']
} = {}): PersonalLiveRow {
  return {
    id: overrides.id || 'record-1',
    seatInfo: null,
    mood: null,
    note: null,
    isPublic: overrides.isPublic || false,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    MusicConcert: {
      id: overrides.concertId || 'concert-1',
      title: null,
      concertDate: new Date(overrides.date || '2026-05-31T12:00:00Z'),
      city: overrides.city ?? '上海',
      venue: '测试场馆',
      sessionNumber: null,
      posterUrl: null,
      status: overrides.status || 'PUBLISHED',
      tourId: overrides.tourId || 'tour-1',
      MusicTour: { id: overrides.tourId || 'tour-1', name: '测试巡演', posterUrl: null, status: overrides.tourStatus || 'PUBLISHED' },
      MusicConcertSetlistItem: overrides.setlist || [],
    },
  }
}

const linkedSong = (id = 'song-1', title = '任我行') => ({
  songId: id,
  displayName: null,
  section: 'MAIN',
  MusicSong: { id, title, MusicAlbum: { id: 'album-1', name: '专辑', coverUrl: null } },
})

test('同一用户同一场次只能有一条记录', () => {
  assert.match(read('prisma/schema.prisma'), /@@unique\(\[userId, concertId\]\)/)
})

test('User删除时个人记录级联删除', () => {
  assert.match(read('prisma/schema.prisma'), /User\s+User\s+@relation\(fields: \[userId\], references: \[id\], onDelete: Cascade\)/)
})

test('场次外键使用Restrict保护个人观演历史', () => {
  assert.match(read('prisma/schema.prisma'), /MusicConcert\s+MusicConcert\s+@relation\(fields: \[concertId\], references: \[id\], onDelete: Restrict\)/)
})

test('场次存在观演记录时后台删除被阻止', () => {
  const source = read('app/api/admin/music/concerts/[concertId]/route.ts')
  assert.match(source, /_count\.UserMusicConcert > 0/)
  assert.match(source, /status: 409/)
})

test('migration无破坏性SQL', () => {
  const sql = read('prisma/migrations/20260729220000_add_user_music_concert/migration.sql')
  assert.match(sql, /CREATE TABLE `UserMusicConcert`/)
  assert.doesNotMatch(sql, /\bDROP\b|\bTRUNCATE\b|DELETE FROM/i)
})

test('isPublic默认false', () => {
  assert.match(read('prisma/schema.prisma'), /isPublic\s+Boolean\s+@default\(false\)/)
  assert.match(read('prisma/migrations/20260729220000_add_user_music_concert/migration.sql'), /`isPublic` BOOLEAN NOT NULL DEFAULT false/)
})

test('未登录不能读取我的现场', () => {
  assert.match(read('app/api/music/live/me/route.ts'), /requireUser\(\)/)
})

test('未登录不能标记我看过', () => {
  assert.match(read('app/api/music/live/concerts/[concertId]/attendance/route.ts'), /export async function POST[\s\S]*requireUser\(\)/)
})

test('用户不能修改其他用户记录', () => {
  assert.match(read('app/api/music/live/concerts/[concertId]/attendance/route.ts'), /updateMany\([\s\S]*userId: guard\.user\.id, concertId/)
})

test('用户不能删除其他用户记录', () => {
  assert.match(read('app/api/music/live/concerts/[concertId]/attendance/route.ts'), /deleteMany\([\s\S]*userId: guard\.user\.id, concertId/)
})

test('客户端传入userId被拒绝', () => {
  assert.equal(parseAttendanceInput({ userId: 'other', isPublic: false }).data, undefined)
})

test('草稿场次不能标记', () => {
  assert.match(read('app/api/music/live/concerts/[concertId]/attendance/route.ts'), /status: 'PUBLISHED'/)
})

test('所属巡演草稿时不能标记', () => {
  assert.match(read('app/api/music/live/concerts/[concertId]/attendance/route.ts'), /MusicTour: \{ status: 'PUBLISHED' \}/)
})

test('不存在场次返回404', () => {
  assert.match(read('app/api/music/live/concerts/[concertId]/attendance/route.ts'), /暂未公开' \}, \{ status: 404/)
})

test('重复标记不会创建重复记录', () => {
  const source = read('app/api/music/live/concerts/[concertId]/attendance/route.ts')
  assert.match(source, /error\.code === 'P2002'/)
  assert.match(source, /status: 409/)
})

test('创建记录使用服务端session用户', () => {
  assert.match(read('app/api/music/live/concerts/[concertId]/attendance/route.ts'), /create\([\s\S]*userId: guard\.user\.id, concertId/)
})

test('编辑seatInfo mood note和isPublic', () => {
  const parsed = parseAttendanceInput({ seatInfo: 'A区', mood: '开心', note: '难忘', isPublic: true })
  assert.deepEqual(parsed.data, { seatInfo: 'A区', mood: '开心', note: '难忘', isPublic: true })
})

test('空字符串标准化为null', () => {
  assert.deepEqual(parseAttendanceInput({ seatInfo: ' ', mood: '', note: '\n', isPublic: false }).data, { seatInfo: null, mood: null, note: null, isPublic: false })
})

test('超长字段被拒绝', () => {
  assert.equal(parseAttendanceInput({ seatInfo: 'x'.repeat(101) }).data, undefined)
  assert.equal(parseAttendanceInput({ mood: 'x'.repeat(101) }).data, undefined)
  assert.equal(parseAttendanceInput({ note: 'x'.repeat(5001) }).data, undefined)
})

test('分页默认20且最大50', () => {
  assert.equal(parsePersonalPageSize(null), 20)
  assert.equal(parsePersonalPageSize('999'), 50)
})

test('双标签页编辑使用更新时间检测并发覆盖', () => {
  assert.ok(parseAttendanceVersion('2026-07-29T12:00:00.000Z') instanceof Date)
  assert.equal(parseAttendanceVersion('not-a-date'), undefined)
  const source = read('app/api/music/live/concerts/[concertId]/attendance/route.ts')
  assert.match(source, /updatedAt: expectedUpdatedAt/)
  assert.match(source, /status: exists \? 409 : 404/)
})

test('删除只影响当前用户当前场次', () => {
  const source = read('app/api/music/live/concerts/[concertId]/attendance/route.ts')
  assert.match(source, /where: \{ userId: guard\.user\.id, concertId \}/)
  assert.doesNotMatch(source, /musicConcert\.delete|musicSong\.delete/)
})

test('场次数统计正确', () => {
  assert.equal(summarizePersonalLiveRows([row(), row({ id: 'r2', concertId: 'c2' })]).concertCount, 2)
})

test('巡演去重正确', () => {
  assert.equal(summarizePersonalLiveRows([row(), row({ id: 'r2', concertId: 'c2' })]).tourCount, 1)
})

test('城市去重会忽略空格和大小写', () => {
  assert.equal(normalizedCityKey(' Hong Kong '), normalizedCityKey('hong kong'))
  assert.equal(summarizePersonalLiveRows([row({ city: ' Hong Kong ' }), row({ id: 'r2', concertId: 'c2', city: 'hong kong' })]).cityCount, 1)
})

test('不同歌曲按songId去重', () => {
  const stats = summarizePersonalLiveRows([row({ setlist: [linkedSong(), linkedSong()] })])
  assert.equal(stats.unlockedSongCount, 1)
})

test('累计现场听歌次数包含重复歌单项', () => {
  const stats = summarizePersonalLiveRows([row({ setlist: [linkedSong(), linkedSong()] })])
  assert.equal(stats.totalLiveSongCount, 2)
})

test('同一场同一歌出现两次累计为2', () => {
  assert.equal(buildPersonalSongAtlas([row({ setlist: [linkedSong(), linkedSong()] })])[0].occurrenceCount, 2)
})

test('未关联纯文本曲目不计入正式歌曲数', () => {
  const stats = summarizePersonalLiveRows([row({ setlist: [{ songId: null, displayName: '清唱', section: 'SPECIAL', MusicSong: null }] })])
  assert.equal(stats.unlockedSongCount, 0)
})

test('纯文本曲目计入累计歌单次数', () => {
  const stats = summarizePersonalLiveRows([row({ setlist: [{ songId: null, displayName: '清唱', section: 'SPECIAL', MusicSong: null }] })])
  assert.equal(stats.totalLiveSongCount, 1)
})

test('TALK空条目不计入听歌次数', () => {
  const stats = summarizePersonalLiveRows([row({ setlist: [{ songId: null, displayName: ' ', section: 'TALK', MusicSong: null }] })])
  assert.equal(stats.totalLiveSongCount, 0)
})

test('首次和最近听到日期正确', () => {
  const atlas = buildPersonalSongAtlas([row({ date: '2025-01-01', setlist: [linkedSong()] }), row({ id: 'r2', concertId: 'c2', date: '2026-01-01', setlist: [linkedSong()] })])[0]
  assert.equal(atlas.first.date.getUTCFullYear(), 2025)
  assert.equal(atlas.latest?.date.getUTCFullYear(), 2026)
})

test('关联场次数与出现次数区分正确', () => {
  const atlas = buildPersonalSongAtlas([row({ setlist: [linkedSong(), linkedSong()] })])[0]
  assert.equal(atlas.occurrenceCount, 2)
  assert.equal(atlas.concertCount, 1)
})

test('他人只能看到isPublic true记录', () => {
  assert.match(read('app/api/music/live/users/[uid]/route.ts'), /where: \{[\s\S]*isPublic: true/)
})

test('公开统计只基于公开记录', () => {
  const source = read('app/api/music/live/users/[uid]/route.ts')
  assert.match(source, /UserMusicConcert:[\s\S]*isPublic: true/)
  assert.match(source, /concertCount: user\.UserMusicConcert\.length/)
})

test('私人笔记不在公开API返回', () => {
  const source = read('app/api/music/live/users/[uid]/route.ts')
  assert.doesNotMatch(source, /\bnote:\s*true\b|\bnote:\s*record/)
})

test('草稿场次不在公开用户页展示', () => {
  assert.match(read('app/api/music/live/users/[uid]/route.ts'), /MusicConcert: \{ status: 'PUBLISHED', MusicTour: \{ status: 'PUBLISHED' \} \}/)
})

test('个人接口响应不可公共缓存', () => {
  const helper = read('lib/music-personal-live.ts')
  assert.match(helper, /'Cache-Control': 'private, no-store, max-age=0'/)
  assert.match(helper, /response\.headers\.set/)
  assert.match(read('app/api/music/live/me/route.ts'), /withPersonalNoStore\(guard\.response\)/)
})

test('用户间缓存不会碰撞', () => {
  const source = read('app/api/music/live/me/route.ts')
  assert.match(source, /guard\.user\.id/)
  assert.doesNotMatch(source, /unstable_cache|revalidate/)
})

test('未登录进入我的现场跳登录并带redirect', () => {
  assert.match(read('app/music/live/me/page.tsx'), /redirect\('\/login\?redirect=%2Fmusic%2Flive%2Fme'\)/)
})

test('无记录时显示正常空状态', () => {
  assert.match(read('components/music/live/MyLiveDashboard.tsx'), /还没有记录看过的演唱会/)
})

test('场次详情提供标记我看过按钮', () => {
  assert.match(read('components/music/live/AttendancePanel.tsx'), /标记我看过/)
})

test('已标记时显示编辑和取消', () => {
  const source = read('components/music/live/AttendancePanel.tsx')
  assert.match(source, /✓ 我看过/)
  assert.match(source, /编辑记录/)
  assert.match(source, /取消标记/)
})

test('歌曲图鉴链接进入现有歌曲详情', () => {
  assert.match(read('components/music/live/MyLiveDashboard.tsx'), /href=\{`\/music\/song\/\$\{song\.songId\}`\}/)
})

test('未关联曲目不会进入歌曲图鉴', () => {
  assert.equal(buildPersonalSongAtlas([row({ setlist: [{ songId: null, displayName: '翻唱', section: 'MAIN', MusicSong: null }] })]).length, 0)
})

test('320px布局不使用固定宽度主面板', () => {
  const source = read('components/music/live/MyLiveDashboard.tsx') + read('components/music/live/AttendancePanel.tsx')
  assert.match(source, /min-w-0/)
  assert.doesNotMatch(source, /min-w-\[(?:8|9|10)\d\dpx\]/)
})

test('我的现场继续使用EasMusic深蓝壳层', () => {
  assert.match(read('app/music/live/me/page.tsx'), /MusicArchiveShell/)
  assert.match(read('components/music/MusicArchiveShell.tsx'), /bg-\[#06101d\]/)
})

test('旧现场入口保持兼容并使用 Eason in Concert 名称', () => {
  const source = read('app/music/live/page.tsx')
  assert.match(source, /Eason in Concert/)
  assert.match(source, /现场档案正在整理中/)
})

test('歌曲详情个人数据由客户端隔离请求', () => {
  const source = read('components/music/live/PersonalSongHistory.tsx')
  assert.match(source, /fetch\(`\/api\/music\/live\/me\/songs\/\$\{songId\}`/)
  assert.match(source, /cache: 'no-store'/)
})

test('移动导航仍保持原EasMusic入口且未新增我的现场底栏', () => {
  const source = read('components/layout/navigation.ts')
  assert.match(source, /href: '\/music'/)
  assert.doesNotMatch(source, /href: '\/music\/live\/me'/)
})

test('取消标记有明确二次确认文案', () => {
  assert.match(read('components/music/live/AttendancePanel.tsx'), /取消后，该场演唱会将从你的观演记录和歌曲解锁统计中移除。是否继续？/)
})
