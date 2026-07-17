import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { calculateCheckinStreaks, getShanghaiDateKey } from '../lib/checkin'
import { FEEDBACK_DESCRIPTION_MIN_LENGTH, FEEDBACK_MAX_ATTACHMENTS, FEEDBACK_MAX_FILE_SIZE } from '../lib/feedback'
import { buildForumHref, clampForumPage, excerptForumPost, getForumOffset, getForumPageWindow, getForumTotalPages, parseForumSort } from '../lib/forum'
import { getNotificationTarget } from '../lib/notification-target'
import { calculateGridHeightFromPixels, isDeprecatedLayoutModule, normalizeLayoutItemHeight } from '../lib/page-layout/normalize'

test('旧好友动态与论坛碎片模块会被过滤', () => {
  assert.equal(isDeprecatedLayoutModule('profile', 'profile.friendActivity'), true)
  assert.equal(isDeprecatedLayoutModule('forum', 'forum.pinnedPosts'), true)
  assert.equal(isDeprecatedLayoutModule('forum', 'forum.main'), false)
})

test('异常旧布局高度会按默认高度规范化', () => {
  assert.equal(normalizeLayoutItemHeight({ x: 0, y: 0, w: 12, h: 40 }, { x: 0, y: 0, w: 12, h: 4 }, { auto: true }).h, 4)
  assert.equal(calculateGridHeightFromPixels(173), 3)
})

test('连续九个北京时间自然日计算为九天', () => {
  const keys = Array.from({ length: 9 }, (_, index) => `2026-07-${String(index + 9).padStart(2, '0')}`)
  assert.deepEqual(calculateCheckinStreaks(keys, new Date('2026-07-17T12:00:00+08:00')), { currentStreak: 9, longestStreak: 9, totalDays: 9 })
})

test('重复挂号日期只计一次且中断后正确计算', () => {
  const result = calculateCheckinStreaks(['2026-07-10', '2026-07-10', '2026-07-12', '2026-07-13'], new Date('2026-07-13T12:00:00+08:00'))
  assert.deepEqual(result, { currentStreak: 2, longestStreak: 2, totalDays: 3 })
})

test('北京时间零点边界使用 Asia/Shanghai 日期键', () => {
  assert.equal(getShanghaiDateKey(new Date('2026-07-16T16:00:00.000Z')), '2026-07-17')
  assert.equal(getShanghaiDateKey(new Date('2026-07-16T15:59:59.999Z')), '2026-07-16')
})

test('论坛默认排序与非法排序统一回退到最新', () => {
  assert.equal(parseForumSort(null), 'latest')
  assert.equal(parseForumSort('unknown'), 'latest')
  assert.equal(parseForumSort('featured'), 'featured')
})

test('帖子摘要被压缩为空格并限制长度', () => {
  assert.equal(excerptForumPost('  hello   world  ', 20), 'hello world')
  assert.equal(excerptForumPost('123456', 4), '1234…')
})

test('通知目标支持显式链接、好友、私信和无目标通知', () => {
  const base = { id: 'n1', source: 'personal' as const, link: null, targetUrl: null }
  assert.equal(getNotificationTarget({ ...base, type: 'FRIEND_REQUEST' }), '/friends#received-requests')
  assert.equal(getNotificationTarget({ ...base, type: 'MESSAGE' }), '/notifications?category=message')
  assert.equal(getNotificationTarget({ ...base, type: 'SYSTEM' }), '/notifications?detail=personal:n1')
  assert.equal(getNotificationTarget({ ...base, type: 'REPLY', link: '/posts/p1' }), '/posts/p1')
})

test('反馈前后端共享十字、五图与 10MB 限制', () => {
  assert.equal(FEEDBACK_DESCRIPTION_MIN_LENGTH, 10)
  assert.equal(FEEDBACK_MAX_ATTACHMENTS, 5)
  assert.equal(FEEDBACK_MAX_FILE_SIZE, 10 * 1024 * 1024)
})

test('反馈接口使用幂等键且挂号先建唯一记录再发经验', () => {
  const feedbackRoute = readFileSync('app/api/feedback/route.ts', 'utf8')
  const checkinRoute = readFileSync('app/api/checkin/route.ts', 'utf8')
  assert.match(feedbackRoute, /Idempotency-Key/)
  assert.ok(checkinRoute.indexOf('const createdCheckIn = await tx.checkIn.create') < checkinRoute.indexOf('const expAward = await awardExperience'))
  assert.match(checkinRoute, /PrismaClientKnownRequestError/)
})

test('论坛 Feed 使用服务端分页筛选且用户态禁止公共缓存', () => {
  const route = readFileSync('app/api/forum/feed/route.ts', 'utf8')
  assert.match(route, /skip: getForumOffset\(page, pageSize\)/)
  assert.match(route, /total,\s*totalPages,\s*page,/)
  assert.match(route, /private, no-store/)
  assert.match(route, /likedByMe/)
})

test('旧分区路由统一重定向到单页论坛', () => {
  const route = readFileSync('app/boards/[slug]/page.tsx', 'utf8')
  assert.match(route, /redirect\(`\/forum\?board=/)
})

test('论坛分页窗口始终显示连续页码并在边界正确收缩', () => {
  assert.equal(getForumTotalPages(41, 20), 3)
  assert.equal(getForumTotalPages(0, 20), 1)
  assert.equal(clampForumPage(99, 6), 6)
  assert.deepEqual(getForumPageWindow(1, 9), [1, 2, 3])
  assert.deepEqual(getForumPageWindow(5, 9), [4, 5, 6])
  assert.deepEqual(getForumPageWindow(9, 9), [7, 8, 9])
  assert.deepEqual(getForumPageWindow(1, 2), [1, 2])
  assert.equal(getForumOffset(2, 20), 20)
  assert.equal(getForumOffset(3, 20), 40)
  assert.equal(buildForumHref('/forum', 'board=concert&sort=featured&query=live', { page: 2 }), '/forum?board=concert&sort=featured&query=live&page=2')
  assert.equal(buildForumHref('/forum', 'board=concert&page=2', { sort: 'latest', page: null }), '/forum?board=concert&sort=latest')
})

test('论坛翻页同步 URL、重新请求并用新 props 刷新双列列表', () => {
  const forumHome = readFileSync('components/ForumHome.tsx', 'utf8')
  const postList = readFileSync('components/PostList.tsx', 'utf8')
  assert.match(forumHome, /page: String\(page\)/)
  assert.match(forumHome, /buildForumHref\(pathname, query, \{ page \}\)/)
  assert.match(forumHome, /label="下一页" page=\{page \+ 1\}/)
  assert.match(forumHome, /responsiveColumns/)
  assert.match(postList, /useEffect\(\(\) => setVisiblePosts\(posts\), \[posts\]\)/)
  assert.match(postList, /md:grid-cols-2/)
})

test('好友挂号留言只查询当前用户好友且空好友缓存不与公开缓存碰撞', () => {
  const messages = readFileSync('lib/checkin-messages.ts', 'utf8')
  const route = readFileSync('app/api/checkin/messages/route.ts', 'utf8')
  const friends = readFileSync('lib/friends.ts', 'utf8')
  assert.match(messages, /friends:\$\{\[\.\.\.userIds\]\.sort\(\)\.join\(','\) \|\| 'none'\}/)
  assert.match(route, /scope === 'friends'/)
  assert.match(route, /getFriendIds\(user\.id\)/)
  assert.match(friends, /prisma\.friendship\.findMany/)
  assert.match(friends, /userA: activeUserWhere/)
  assert.match(friends, /userB: activeUserWhere/)
})

test('好友入口、申请锚点和个人资料卡结构保持统一', () => {
  const menu = readFileSync('components/UserNotificationMenu.tsx', 'utf8')
  const friendsPage = readFileSync('app/friends/page.tsx', 'utf8')
  const profile = readFileSync('components/ProfileSummary.tsx', 'utf8')
  assert.match(menu, />我的好友<Badge/)
  assert.match(friendsPage, /id="received-requests"/)
  assert.match(profile, /admissionInfo\.date/)
  assert.match(profile, /已住院 \{admissionInfo\.days\} 天/)
  assert.match(profile, /w-56 max-w-full/)
})
