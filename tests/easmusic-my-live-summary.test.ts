import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getSessionCookieDeletionOptions, getSessionCookieOptions, SESSION_MAX_AGE_SECONDS } from '../lib/auth'
import { summarizePersonalLiveSummaryRows } from '../lib/music-personal-live'

const read = (path: string) => readFileSync(path, 'utf8')

function summaryRow({ id, tourId, tourName, city, date }: { id: string; tourId: string; tourName: string; city: string; date: string }) {
  return {
    MusicConcert: {
      id,
      tourId,
      concertDate: new Date(date),
      city,
      MusicTour: { id: tourId, name: tourName },
    },
  }
}

test('My Live 无记录返回 0 和 null', () => {
  assert.deepEqual(summarizePersonalLiveSummaryRows([]), {
    attendedShowCount: 0,
    attendedTourCount: 0,
    attendedCityCount: 0,
    latestAttendedShow: null,
  })
})

test('同一巡演多场按真实场次计数、巡演按 tourId 去重', () => {
  const result = summarizePersonalLiveSummaryRows([
    summaryRow({ id: 'show-1', tourId: 'tour-1', tourName: 'Fear and Dreams', city: '澳门', date: '2025-08-08T12:00:00.000Z' }),
    summaryRow({ id: 'show-2', tourId: 'tour-1', tourName: 'Fear and Dreams', city: '澳门', date: '2025-08-09T12:00:00.000Z' }),
    summaryRow({ id: 'show-3', tourId: 'tour-2', tourName: 'DUO', city: '香港', date: '2024-08-09T12:00:00.000Z' }),
  ])
  assert.equal(result.attendedShowCount, 3)
  assert.equal(result.attendedTourCount, 2)
  assert.equal(result.attendedCityCount, 2)
})

test('重复关系读取时按 concertId 去重，最近观看按演出日期排序', () => {
  const result = summarizePersonalLiveSummaryRows([
    summaryRow({ id: 'show-1', tourId: 'tour-1', tourName: '旧名称', city: '上海', date: '2025-01-01T12:00:00.000Z' }),
    summaryRow({ id: 'show-1', tourId: 'tour-1', tourName: '旧名称', city: '上海', date: '2025-01-01T12:00:00.000Z' }),
    summaryRow({ id: 'show-2', tourId: 'tour-2', tourName: '新巡演', city: '北京', date: '2026-01-01T12:00:00.000Z' }),
  ])
  assert.equal(result.attendedShowCount, 2)
  assert.equal(result.latestAttendedShow?.showId, 'show-2')
  assert.equal(result.latestAttendedShow?.tourName, '新巡演')
})

test('取消一场看过记录后，重新聚合立即减少具体场次统计', () => {
  const rows = [
    summaryRow({ id: 'show-1', tourId: 'tour-1', tourName: 'Fear and Dreams', city: '澳门', date: '2025-08-08T12:00:00.000Z' }),
    summaryRow({ id: 'show-2', tourId: 'tour-1', tourName: 'Fear and Dreams', city: '澳门', date: '2025-08-09T12:00:00.000Z' }),
  ]
  assert.equal(summarizePersonalLiveSummaryRows(rows).attendedShowCount, 2)
  assert.equal(summarizePersonalLiveSummaryRows(rows.slice(0, 1)).attendedShowCount, 1)
})

test('聚合 API 只使用当前 Session 用户且未登录返回 401', () => {
  const route = read('app/api/music/live/me/route.ts')
  assert.match(route, /requireUser\(\)/)
  assert.match(route, /getPersonalLiveOverview\(guard\.user\.id\)/)
  assert.match(route, /withPersonalNoStore\(guard\.response\)/)
  assert.doesNotMatch(route, /userId.*searchParams|searchParams.*userId/)
  assert.match(route, /status: 503/)
})

test('看过场次使用 UserMusicConcert 的唯一关系，不新增 Prisma 表或 migration', () => {
  const schema = read('prisma/schema.prisma')
  assert.match(schema, /model UserMusicConcert \{[\s\S]*@@unique\(\[userId, concertId\]\)/)
  assert.match(read('components/music/MusicConcertTimeline.tsx'), /categoryId/)
  assert.match(read('components/music/MusicConcertTimeline.tsx'), /CONCERT_CATEGORY_ENUM_TO_SLUG/)
})

test('看过保存和取消只通知 My Live 重新从服务端读取', () => {
  const attendance = read('components/music/live/AttendancePanel.tsx')
  const timeline = read('components/music/MusicConcertTimeline.tsx')
  assert.match(attendance, /music-live:attendance-updated/)
  assert.match(timeline, /fetch\('\/api\/music\/live\/me'/)
  assert.match(timeline, /window\.addEventListener\('music-live:attendance-updated'/)
  assert.match(timeline, /window\.removeEventListener\('music-live:attendance-updated'/)
})

test('移动端封面使用正方形双层结构并有统一兜底', () => {
  const cover = read('components/music/ConcertCover.tsx')
  const css = read('app/globals.css')
  assert.match(cover, /concert-cover-backdrop/)
  assert.match(cover, /concert-cover-foreground/)
  assert.match(cover, /onError/)
  assert.match(css, /\.concert-cover[^\n]*aspect-ratio:1\/1/)
  assert.match(css, /\.concert-cover-foreground[^\n]*object-fit:cover[^\n]*object-position:center center/)
  assert.match(css, /\.music-concert-gallery-image[^\n]*aspect-ratio:1\/1/)
})

test('移动端详情只有遮罩层滚动，详情卡片直接作为遮罩层主体', () => {
  const css = read('app/globals.css')
  const timeline = read('components/music/MusicConcertTimeline.tsx')
  assert.match(css, /\.music-concert-gallery-modal-root \{[^}]*position:fixed[^}]*z-index:9999[^}]*inset:0[^}]*display:flex[^}]*width:100vw[^}]*height:100vh[^}]*align-items:center[^}]*justify-content:center/)
  assert.match(css, /\.music-concert-gallery-modal-scroll \{[^}]*overflow-x:hidden[^}]*overflow-y:auto/)
  assert.doesNotMatch(css, /music-concert-gallery-modal-panel/)
  assert.match(timeline, /className="music-concert-gallery-modal-backdrop"/)
  assert.match(timeline, /className="music-concert-gallery-modal-scroll"/)
  assert.match(timeline, /className="music-concert-gallery-modal-card" role="dialog"/)
  assert.doesNotMatch(css, /\.music-concert-gallery-modal-card[^}]*height:100%|\.music-concert-gallery-modal-card[^}]*overflow:auto/)
  assert.match(css, /\.music-concert-gallery-modal-close \{[^}]*width:44px[^}]*height:44px/)
  assert.match(timeline, /document\.documentElement/)
  assert.match(timeline, /window\.scrollTo\(\{ left: scrollX, top: scrollY/)
})

test('不同标题和简介长度使用统一居中 Modal 高度与固定内容槽位', () => {
  const css = read('app/globals.css')
  const timeline = read('components/music/MusicConcertTimeline.tsx')
  assert.match(css, /\.music-concert-gallery-modal-scroll \{[^}]*align-items:center[^}]*overflow-y:auto/)
  assert.match(css, /\.music-concert-gallery-modal-scroll \{[^}]*display:flex[^}]*align-items:center[^}]*justify-content:center/)
  assert.match(css, /\.music-concert-gallery-modal-scroll \{[^}]*width:100vw[^}]*height:100vh/)
  assert.doesNotMatch(css, /\.music-concert-gallery-modal-scroll \{[^}]*100dvh/)
  assert.match(css, /\.music-concert-gallery-modal-scroll \{[^}]*padding:0 24px/)
  assert.match(css, /@media \(max-width:767px\)[\s\S]*\.music-concert-gallery-modal-scroll \{[^}]*padding:0 16px/)
  assert.match(css, /\.music-concert-gallery-modal-card \{[^}]*width:min\(720px,calc\(100vw - 48px\)\)[^}]*height:360px[^}]*grid-template-columns:240px minmax\(0,1fr\)[^}]*overflow:hidden/)
  assert.doesNotMatch(css, /\.music-concert-gallery-modal-card \{[^}]*overflow-(?:x|y)?:\s*(?:auto|scroll)/)
  assert.match(css, /\.music-concert-gallery-modal-copy h2 \{[^}]*height:2\.1em[^}]*-webkit-line-clamp:2/)
  assert.match(css, /\.music-concert-gallery-modal-description \{[^}]*max-height:80px[^}]*-webkit-line-clamp:4/)
  assert.match(css, /\.music-concert-gallery-modal-card>\.music-concert-gallery-image \{[^}]*width:240px[^}]*height:240px/)
  assert.match(css, /@media \(max-width:767px\)[\s\S]*\.music-concert-gallery-modal-description \{[^}]*-webkit-line-clamp:3/)
  assert.match(css, /\.music-concert-gallery-modal-description \{[^}]*overflow:hidden[^}]*text-overflow:ellipsis/)
  assert.match(css, /\.music-concert-gallery-modal-copy>a \{[^}]*margin-top:16px/)
  assert.doesNotMatch(css, /\.music-concert-gallery-modal-copy>a \{[^}]*position:absolute/)
  const modalCard = timeline.indexOf('className="music-concert-gallery-modal-card"')
  const cover = timeline.indexOf('<ArchivePoster tour={tour}', modalCard)
  const year = timeline.indexOf('<time>')
  const title = timeline.indexOf('<h2 id="concert-gallery-modal-title">')
  const count = timeline.indexOf('className="music-concert-gallery-modal-count"')
  const description = timeline.indexOf('className="music-concert-gallery-modal-description"')
  const detailLink = timeline.indexOf('查看完整巡演详情')
  assert.ok(modalCard < cover && cover < year && year < title && title < count && count < description && description < detailLink)
})

test('所有用户现场歌单查询按 position、createdAt、id 稳定排序', () => {
  const overview = read('lib/music-personal-live.ts')
  assert.match(overview, /orderBy: \[\{ position: 'asc' as const \}, \{ createdAt: 'asc' as const \}, \{ id: 'asc' as const \}\]/)
})

test('Session JWT 和持久 Cookie 同为 30 天，退出使用匹配的删除配置', () => {
  assert.equal(SESSION_MAX_AGE_SECONDS, 60 * 60 * 24 * 30)
  const auth = read('lib/auth.ts')
  const authCookie = read('lib/auth-cookie.ts')
  assert.match(auth, /setExpirationTime\(`\$\{SESSION_MAX_AGE_SECONDS\}s`\)/)
  assert.match(authCookie, /expires: new Date\(Date\.now\(\) \+ SESSION_MAX_AGE_SECONDS \* 1000\)/)
  const local = getSessionCookieOptions(new Request('http://localhost:3000/api/auth/login'))
  assert.equal(local.secure, false)
  assert.equal(local.domain, undefined)
  assert.equal(local.maxAge, SESSION_MAX_AGE_SECONDS)
  assert.ok(local.expires instanceof Date)
  const canonical = getSessionCookieOptions(new Request('https://ecfc.fans/api/auth/login'))
  assert.equal(canonical.domain, '.ecfc.fans')
  assert.equal(canonical.httpOnly, true)
  assert.equal(canonical.sameSite, 'lax')
  const deletion = getSessionCookieDeletionOptions(new Request('https://ecfc.fans/api/auth/logout'))
  assert.equal(deletion.maxAge, 0)
  assert.equal(deletion.expires?.getTime(), 0)
  assert.equal(deletion.path, '/')
  assert.match(read('app/api/auth/logout/route.ts'), /getSessionCookieDeletionOptions\(request\)/)
})

test('ecfc.fans 与 www.ecfc.fans 共享会话域，HTTPS 升级保留原始 host', () => {
  const apex = getSessionCookieOptions(new Request('https://ecfc.fans/api/auth/login'))
  const www = getSessionCookieOptions(new Request('https://www.ecfc.fans/api/auth/login'))
  assert.equal(apex.domain, '.ecfc.fans')
  assert.equal(www.domain, '.ecfc.fans')

  const middleware = read('middleware.ts')
  assert.match(middleware, /secureUrl\.hostname = requestHost/)
  assert.doesNotMatch(middleware, /requestHost === 'www\.ecfc\.fans'/)
})

test('登录表单允许密码管理器识别账号和当前密码，redirect 只允许站内路径', () => {
  const login = read('app/login/LoginForm.tsx')
  assert.match(login, /name="identifier"/)
  assert.match(login, /autoComplete="username"/)
  assert.match(login, /name="password"/)
  assert.match(login, /autoComplete="current-password"/)
  assert.match(login, /!path\.startsWith\('\/\/'\)/)
})
