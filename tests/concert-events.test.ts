import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { recordingSessionsEventSeed, recordingSessionsShowsSeed, recordingSessionsTimelineSeed, recordingSessionsTutorialSeed } from '@/lib/recording-sessions-data'
import { parseConcertDate, parseConcertEventInput, parseConcertShowInputs, parseConcertTimelineInputs, parseConcertTutorialInputs } from '@/lib/concert-admin-input'
import { parseHttpsRegistrationUrl } from '@/lib/concert-events'
import { isConcertMarkVisible, publicConcertMarkUserWhere } from '@/lib/concert-privacy'
import { getConcertReminderInstant, getConcertReminderNotificationContent } from '@/lib/concert-reminders'
import { concertDateKey, concertLocalDateKey, filterConcertShows, getConcertCalendarCells, getConcertTimelineState, isConcertWeekend } from '@/lib/concert-timeline'

const source = (relativePath: string) => readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')

test('Recording Sessions seed has 26 unique, ordered dates in the specified range', () => {
  const dates = recordingSessionsShowsSeed.map((show) => show.date)
  assert.equal(dates.length, 26)
  assert.equal(new Set(dates).size, 26)
  assert.deepEqual(dates, [...dates].sort())
  assert.equal(dates[0], '2026-12-12')
  assert.equal(dates.at(-1), '2027-02-20')
  assert.equal(recordingSessionsEventSeed.venue, '香港演艺学院 Lyric 剧院')
})

test('date-only helpers preserve calendar dates independent of local process timezone', () => {
  assert.equal(concertDateKey(new Date('2026-12-12T00:00:00.000Z')), '2026-12-12')
  assert.equal(concertLocalDateKey(new Date('2026-10-27T16:30:00.000Z'), 'Asia/Hong_Kong'), '2026-10-28')
})

test('weekend filter returns only Saturday and Sunday shows', () => {
  const weekends = recordingSessionsShowsSeed.filter((show) => isConcertWeekend(show.date))
  assert.ok(weekends.length > 0)
  assert.ok(weekends.every((show) => [0, 6].includes(new Date(`${show.date}T00:00:00Z`).getUTCDay())))
  assert.deepEqual(filterConcertShows(recordingSessionsShowsSeed, '2026-12', true), weekends.filter((show) => show.date.startsWith('2026-12')))
})

test('month calendar has a stable six-week grid and links the exact show date', () => {
  const cells = getConcertCalendarCells('2026-12', recordingSessionsShowsSeed)
  assert.equal(cells.length, 42)
  const showCell = cells.find((cell) => cell.key === '2026-12-12')
  assert.equal(showCell?.shows.length, 1)
  assert.equal(showCell?.shows[0].date, '2026-12-12')
  assert.equal(getConcertCalendarCells('2026-13', recordingSessionsShowsSeed).length, 0)
})

test('timeline countdown uses exact registration opening and Hong Kong server time', () => {
  const state = getConcertTimelineState(recordingSessionsTimelineSeed, new Date('2026-10-28T02:59:00.000Z'), 'Asia/Hong_Kong')
  assert.equal(state.phaseLabel, '登记即将开放')
  assert.equal(state.target, '2026-10-28T03:00:00.000Z')
})

test('registration phase counts down to the explicit closing instant', () => {
  const state = getConcertTimelineState(recordingSessionsTimelineSeed, new Date('2026-10-28T04:00:00.000Z'), 'Asia/Hong_Kong')
  assert.equal(state.phaseLabel, '登记抽签进行中')
  assert.equal(state.countdownLabel, '登记截止')
  assert.equal(state.target, '2026-10-29T15:59:00.000Z')
})

test('date-only result milestones never invent a countdown time', () => {
  const before = getConcertTimelineState(recordingSessionsTimelineSeed, new Date('2026-10-30T00:00:00.000Z'), 'Asia/Hong_Kong')
  assert.equal(before.phaseLabel, '等待首轮抽签结果')
  assert.equal(before.target, null)
  assert.equal(before.dateOnly, true)
  const onDate = getConcertTimelineState(recordingSessionsTimelineSeed, new Date('2026-11-02T02:00:00.000Z'), 'Asia/Hong_Kong')
  assert.equal(onDate.phaseLabel, '等待首轮抽签结果 · 今天')
  assert.equal(onDate.target, null)
})

test('completed timeline reports ended without a fabricated next target', () => {
  const state = getConcertTimelineState(recordingSessionsTimelineSeed, new Date('2027-02-21T00:00:00.000Z'), 'Asia/Hong_Kong')
  assert.equal(state.phaseLabel, '活动时间线已结束')
  assert.equal(state.target, null)
})

test('client countdown is anchored to server time and advances monotonically without Date.now', () => {
  const clock = source('../components/concerts/useServerClock.ts')
  assert.match(clock, /Date\.parse\(serverNow\)/)
  assert.match(clock, /performance\.now\(\)/)
  assert.doesNotMatch(clock, /Date\.now\(\)/)
})

test('registration URL accepts only credential-free HTTPS', () => {
  assert.equal(parseHttpsRegistrationUrl('https://tickets.example.test/register'), 'https://tickets.example.test/register')
  assert.equal(parseHttpsRegistrationUrl('http://tickets.example.test/register'), null)
  assert.equal(parseHttpsRegistrationUrl('javascript:alert(1)'), null)
  assert.equal(parseHttpsRegistrationUrl('https://user:password@tickets.example.test/'), null)
  assert.equal(parseHttpsRegistrationUrl(''), null)
})

test('admin event input keeps registration disabled without an approved HTTPS link', () => {
  const input = parseConcertEventInput({ ...recordingSessionsEventSeed, registrationUrl: '', registrationEnabled: false })
  assert.equal(input.registrationUrl, null)
  assert.equal(input.registrationEnabled, false)
  assert.throws(() => parseConcertEventInput({ ...recordingSessionsEventSeed, registrationUrl: 'http://invalid.test', registrationEnabled: true }))
})

test('admin date parser accepts leap day and rejects invalid dates', () => {
  assert.equal(parseConcertDate('2028-02-29')?.toISOString(), '2028-02-29T00:00:00.000Z')
  assert.throws(() => parseConcertDate('2027-02-29'))
  assert.throws(() => parseConcertDate('2026-2-01'))
})

test('admin show validator accepts all seed rows and rejects invalid time and oversized setlists', () => {
  assert.equal(parseConcertShowInputs(recordingSessionsShowsSeed).length, 26)
  assert.throws(() => parseConcertShowInputs([{ ...recordingSessionsShowsSeed[0], startTime: '24:00' }]))
  assert.throws(() => parseConcertShowInputs([{ ...recordingSessionsShowsSeed[0], songs: Array(81).fill('song') }]))
})

test('admin timeline validator preserves date-only milestones and rejects reversed ranges', () => {
  const timeline = parseConcertTimelineInputs(recordingSessionsTimelineSeed)
  assert.equal(timeline.length, 8)
  assert.equal(timeline.find((item) => item.type === 'FIRST_DRAW_RESULT')?.startsAt, null)
  assert.throws(() => parseConcertTimelineInputs([{ date: '2026-10-28', type: 'CUSTOM', title: 'bad', startsAt: '2026-10-28T12:00:00Z', endsAt: '2026-10-28T11:00:00Z' }]))
})

test('admin tutorial validator accepts published registration and draft ticketing guides', () => {
  const tutorials = parseConcertTutorialInputs(recordingSessionsTutorialSeed)
  assert.equal(tutorials.length, 2)
  assert.equal(tutorials[0].status, 'PUBLISHED')
  assert.equal(tutorials[1].status, 'DRAFT')
  assert.throws(() => parseConcertTutorialInputs([{ title: 'bad', steps: [{ title: 'missing body' }] }]))
})

test('tutorial step CMS accepts project media URLs and HTTPS links without exposing arbitrary image hosts', () => {
  const tutorial = parseConcertTutorialInputs([{ type: 'REGISTRATION', title: 'Guide', steps: [{ title: 'Step', body: 'Read', imageUrl: 'https://ecfc-1306412725.cos.ap-guangzhou.myqcloud.com/tutorials/step.webp', imageAlt: 'Registration step', caution: 'Do not share credentials', linkUrl: 'https://tickets.example.test/guide', linkLabel: 'Read guide' }] }])[0]
  assert.equal((tutorial.steps[0] as { imageUrl: string }).imageUrl, 'https://ecfc-1306412725.cos.ap-guangzhou.myqcloud.com/tutorials/step.webp')
  assert.equal((tutorial.steps[0] as { linkUrl: string }).linkUrl, 'https://tickets.example.test/guide')
  assert.equal((tutorial.steps[0] as { caution: string }).caution, 'Do not share credentials')
  assert.throws(() => parseConcertTutorialInputs([{ title: 'Guide', steps: [{ title: 'Step', body: 'Read', imageUrl: 'https://attacker.example/image.png' }] }]))
  assert.throws(() => parseConcertTutorialInputs([{ title: 'Guide', steps: [{ title: 'Step', body: 'Read', imageUrl: 'data:image/png;base64,AAAA' }] }]))
  assert.throws(() => parseConcertTutorialInputs([{ title: 'Guide', steps: [{ title: 'Step', body: 'Read', linkUrl: 'javascript:alert(1)' }] }]))
})

test('public concert mark filter requires an active public profile and honors private history setting', () => {
  assert.equal(publicConcertMarkUserWhere.status, 'ACTIVE')
  const visible = { isPublic: true, user: { status: 'ACTIVE', isDeleted: false, Profile: { wallVisibility: 'PUBLIC' }, UserPrivacySetting: null } }
  assert.equal(isConcertMarkVisible(visible), true)
  assert.equal(isConcertMarkVisible({ ...visible, user: { ...visible.user, UserPrivacySetting: { showConcertHistory: false } } }), false)
  assert.equal(isConcertMarkVisible({ ...visible, isPublic: false }), false)
  assert.equal(isConcertMarkVisible({ ...visible, user: { ...visible.user, Profile: { wallVisibility: 'PRIVATE' } } }), false)
})

test('new concert marks stay off the public list unless the user explicitly opts in', () => {
  const route = source('../app/api/concert-events/[slug]/shows/[showId]/mark/route.ts')
  const actions = source('../components/concerts/ConcertShowActions.tsx')
  const schema = source('../prisma/schema.prisma')
  const migration = source('../prisma/migrations/20261027100000_add_concert_event_system/migration.sql')
  assert.match(route, /isPublic:\s*input\.isPublic\s*===\s*true/)
  assert.match(actions, /mark\?\.isPublic\s*\?\?\s*false/)
  assert.match(schema, /model ConcertShowMark[\s\S]*?isPublic\s+Boolean\s+@default\(false\)/)
  assert.match(migration, /`isPublic` BOOLEAN NOT NULL DEFAULT false/)
})

test('show reminder is scheduled 24 hours before the known Hong Kong show time', () => {
  const target = getConcertReminderInstant({ targetType: 'SHOW', show: { date: new Date('2026-12-12T00:00:00.000Z'), startTime: '20:00' }, timeline: null, event: { timezone: 'Asia/Hong_Kong' } })
  assert.equal(target?.toISOString(), '2026-12-11T12:00:00.000Z')
})

test('show reminder with unknown show time uses a prior-day reminder schedule, not a claimed show time', () => {
  const target = getConcertReminderInstant({ targetType: 'SHOW', show: { date: new Date('2026-12-12T00:00:00.000Z'), startTime: null }, timeline: null, event: { timezone: 'Asia/Hong_Kong' } })
  assert.equal(target?.toISOString(), '2026-12-11T01:00:00.000Z')
  const content = getConcertReminderNotificationContent({ targetType: 'SHOW', show: { date: new Date('2026-12-12T00:00:00.000Z'), startTime: null, albumTitle: '测试专辑' }, timeline: null, event: { title: 'Recording Sessions' } })
  assert.match(content, /演出时间以主办方公告为准/)
  assert.doesNotMatch(content, /20:00/)
})

test('timeline reminders use exact time when available and an explicit local morning schedule for date-only nodes', () => {
  const exact = getConcertReminderInstant({ targetType: 'TIMELINE', show: null, timeline: { date: new Date('2026-10-28T00:00:00Z'), startsAt: new Date('2026-10-28T03:00:00Z'), endsAt: null }, event: { timezone: 'Asia/Hong_Kong' } })
  const dateOnly = getConcertReminderInstant({ targetType: 'TIMELINE', show: null, timeline: { date: new Date('2026-11-02T00:00:00Z'), startsAt: null, endsAt: null }, event: { timezone: 'Asia/Hong_Kong' } })
  assert.equal(exact?.toISOString(), '2026-10-28T02:45:00.000Z')
  assert.equal(dateOnly?.toISOString(), '2026-11-02T01:00:00.000Z')
})

test('reminder delivery failures are isolated from other server jobs and log only a safe error class', () => {
  const server = source('../server.ts')
  assert.match(server, /const concertReminderTask = deliverDueConcertReminders\(\)[\s\S]*?\.catch\(\(error\) => \{[\s\S]*?errorName:/)
  assert.match(server, /concertReminders\.failed/)
  const reminderTask = server.match(/const concertReminderTask = ([\s\S]*?)\n      const \[expirationResult/)
  assert.ok(reminderTask)
  assert.doesNotMatch(reminderTask[1], /error\.message|String\(error\)/)
})

test('registration link opens a new tab with opener isolation', () => {
  const component = source('../components/concerts/RecordingSessionsSpotlight.tsx')
  assert.match(component, /target="_blank"\s+rel="noopener noreferrer"/)
  assert.match(component, /event\.registrationUrl/)
  assert.doesNotMatch(component, /cultural\.cityline\.com/)
})

test('mark and reminder mutations derive user identity from request authentication', () => {
  const markRoute = source('../app/api/concert-events/[slug]/shows/[showId]/mark/route.ts')
  const reminderRoute = source('../app/api/concert-events/[slug]/reminders/route.ts')
  assert.match(markRoute, /resolveRequestAuth\(request\)/)
  assert.match(markRoute, /userId:\s*auth\.user\.id/)
  assert.match(markRoute, /eventId:\s*event\.id/)
  assert.match(markRoute, /upsert\(/)
  assert.match(markRoute, /userId_showId/)
  assert.match(markRoute, /deleteMany\(/)
  assert.match(markRoute, /allowMarking:\s*true/)
  assert.match(reminderRoute, /resolveRequestAuth\(request\)/)
  assert.match(reminderRoute, /userId:\s*auth\.user\.id/)
  assert.doesNotMatch(markRoute, /input\.userId|input\.eventId/)
  assert.doesNotMatch(reminderRoute, /input\.userId|input\.eventId/)
})

test('show discussions reuse the existing post and moderation flow', () => {
  const postsApi = source('../app/api/posts/route.ts')
  const createPage = source('../app/posts/new/page.tsx')
  const createForm = source('../components/PostCreateForm.tsx')
  assert.match(postsApi, /concertShowId/)
  assert.match(postsApi, /status:\s*'SCHEDULED'/)
  assert.match(createPage, /concertShowId/)
  assert.match(createForm, /concertShowId/)
})

test('admin event mutations require activity management and record an audit action', () => {
  const collectionApi = source('../app/api/admin/concert-events/route.ts')
  const itemApi = source('../app/api/admin/concert-events/[eventId]/route.ts')
  assert.match(collectionApi, /requireAdmin\('activity_manage'/)
  assert.match(itemApi, /requireAdmin\('activity_manage'/)
  assert.match(itemApi, /prisma\.\$transaction/)
  assert.match(itemApi, /createAdminActionAudit/)
  assert.match(itemApi, /tx\.concertShow\.updateMany/)
  assert.match(itemApi, /tx\.concertTimelineEvent\.updateMany/)
  assert.match(itemApi, /tx\.concertTutorial\.updateMany/)
  assert.match(itemApi, /homepageFeatured\) await tx\.concertEvent\.updateMany/)
})

test('tutorial seed preserves source uncertainty and does not claim ticketing instructions', () => {
  assert.equal(recordingSessionsTutorialSeed[1].status, 'DRAFT')
  assert.match(recordingSessionsTutorialSeed[0].steps[0].body, /不会收集.*密码/)
  assert.match(recordingSessionsEventSeed.sourceNote, /未独立核验/)
})

test('anonymous interactions enter the existing login flow with a return path', () => {
  const eventPage = source('../components/concerts/ConcertEventPage.tsx')
  const showActions = source('../components/concerts/ConcertShowActions.tsx')
  assert.match(eventPage, /if \(!isAuthenticated\)[\s\S]*?router\.push\(`\/login\?redirect=/)
  assert.match(showActions, /if \(!isAuthenticated\)[\s\S]*?router\.push\(`\/login\?redirect=/)
  assert.match(eventPage, /encodeURIComponent\(`\/concerts\/\$\{event\.slug\}`\)/)
})

test('public mark displays and registration buttons honor their configured eligibility', () => {
  const eventPage = source('../components/concerts/ConcertEventPage.tsx')
  const spotlight = source('../components/concerts/RecordingSessionsSpotlight.tsx')
  assert.match(eventPage, /event\.allowMarking && event\.status !== 'ENDED'/)
  assert.match(spotlight, /event\.registrationEnabled && event\.registrationUrl/)
  assert.match(spotlight, /target="_blank"\s+rel="noopener noreferrer"/)
})

test('migration contains first event, all 26 shows, timeline and tutorials without applying it', () => {
  const migration = source('../prisma/migrations/20261027100000_add_concert_event_system/migration.sql')
  assert.equal((migration.match(/INSERT INTO `ConcertShow`/g) || []).length, 26)
  assert.equal((migration.match(/INSERT INTO `ConcertTimelineEvent`/g) || []).length, 8)
  assert.equal((migration.match(/INSERT INTO `ConcertTutorial`/g) || []).length, 2)
  assert.match(migration, /recording-sessions-event-v1/)
  assert.match(migration, /cultural\.cityline\.com/)
})
