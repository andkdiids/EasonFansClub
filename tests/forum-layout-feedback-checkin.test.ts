import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { calculateCheckinStreaks, getShanghaiDateKey } from '../lib/checkin'
import { formatBeijingDateTimeMinute } from '../lib/beijing-time'
import { anonymizeCheckInMessages } from '../lib/checkin-messages'
import { FEEDBACK_DESCRIPTION_MIN_LENGTH, FEEDBACK_MAX_ATTACHMENTS, FEEDBACK_MAX_FILE_SIZE } from '../lib/feedback'
import { buildForumHref, clampForumPage, excerptForumPost, getForumOffset, getForumPageWindow, getForumTotalPages, parseForumSort } from '../lib/forum'
import { getNotificationTarget } from '../lib/notification-target'

test('公开 E友留言隐藏身份，好友留言保留原始身份', () => {
  const message = {
    id: 'm1', userId: 'u1', date: '', mood: 'HAPPY', content: 'hello', isPinned: false, isFeatured: false, likeCount: 0, favoriteCount: 0, commentCount: 0, isDeleted: false, deletedAt: null, createdAt: '', updatedAt: '',
    canDelete: true,
    user: { uid: 12, nickname: 'Eason', avatarUrl: '/avatar.webp', level: 2, profile: { displayName: '陈生', avatarUrl: '/avatar.webp' } },
    likes: [],
    favorites: [],
    comments: [{ id: 'c1', messageId: 'm1', authorId: 'u1', parentId: null, content: 'reply', isDeleted: false, deletedAt: null, createdAt: '', updatedAt: '', canDelete: true, author: { id: 'u1', uid: 12, nickname: 'Eason', avatarUrl: '/avatar.webp', level: 2, profile: { displayName: '陈生', avatarUrl: '/avatar.webp' } } }],
  }
  const anonymous = anonymizeCheckInMessages([message] as unknown as Parameters<typeof anonymizeCheckInMessages>[0])
  assert.deepEqual(anonymous[0].author, { type: 'anonymous', name: '匿名E友' })
  assert.equal('userId' in anonymous[0], false)
  assert.equal('user' in anonymous[0], false)
  assert.equal(anonymous[0].canDelete, true)
  assert.equal('id' in anonymous[0].comments[0].author, false)
  assert.equal(anonymous[0].comments[0].canDelete, true)
  assert.equal(JSON.stringify(anonymous).includes('profile'), false)
  assert.equal(JSON.stringify(anonymous).includes('avatarUrl'), false)
  assert.equal(message.user.nickname, 'Eason')
})

test('单密保迁移先备份和统计，再在同一事务中清理', () => {
  const migration = readFileSync('prisma/migrations/20260718090000_single_security_question/migration.sql', 'utf8')
  assert.match(migration, /^BEGIN;/)
  assert.match(migration, /LOCK TABLE "UserSecurityQuestion"/)
  assert.match(migration, /CREATE TABLE "UserSecurityQuestion_backup_20260718"/)
  assert.match(migration, /multi_question_user_count/)
  assert.match(migration, /delete_question_count/)
  assert.match(migration, /COMMIT;\s*$/)
  assert.ok(migration.indexOf('CREATE TABLE "UserSecurityQuestion_backup_20260718"') < migration.indexOf('DELETE FROM "UserSecurityQuestion"'))
})

test('个人主页保持自己的代码布局并直接渲染业务模块', () => {
  const profile = readFileSync('components/ProfilePageSurface.tsx', 'utf8')
  const page = readFileSync('app/profile/page.tsx', 'utf8')
  assert.match(profile, /<PublicUserModules/)
  assert.equal((profile.match(/<PublicUserModules/g) || []).length, 1)
  assert.match(page, /<ProfilePageSurface/)
  assert.doesNotMatch(page, /PageLayoutRenderer|getPublishedPageLayoutConfig|layoutConfig/)
})

test('统一返回按钮优先返回历史，无历史时回首页或业务列表', () => {
  const button = readFileSync('components/BackButton.tsx', 'utf8')
  const detail = readFileSync('app/posts/[postId]/page.tsx', 'utf8')
  assert.match(button, /window\.history\.length > 1/)
  assert.match(button, /router\.push\(fallbackHref\)/)
  assert.match(detail, /<BackButton fallbackHref="\/forum"/)
})

test('验收修复保持真实签到记录、整卡点击、申请过滤与通知清除', () => {
  const checkin = readFileSync('app/api/checkin/route.ts', 'utf8')
  const cards = readFileSync('components/PostList.tsx', 'utf8')
  const friends = readFileSync('app/friends/page.tsx', 'utf8')
  const notifications = readFileSync('app/api/notifications/route.ts', 'utf8')
  assert.match(checkin, /withDbTimeout\(\s*'CheckIn\.findUnique checkinApi\.todayCheckIn'/)
  assert.doesNotMatch(checkin, /isSameLocalDay|resolvedTodayCheckIn/)
  assert.match(cards, /absolute inset-0 z-20/)
  assert.match(friends, /senderId: user\.id, User_FriendRequest_receiverIdToUser: activeUserFilter/)
  assert.match(notifications, /export async function DELETE/)
})

test('帖子与回复图片在浏览器压缩为 WebP 且服务端限制格式', () => {
  const uploader = readFileSync('components/ContentImageUploader.tsx', 'utf8')
  const route = readFileSync('app/api/uploads/content-image/route.ts', 'utf8')
  const posts = readFileSync('app/api/posts/route.ts', 'utf8')
  assert.match(uploader, /form\.set\('file', file\)/)
  assert.match(route, /sharp\(buffer/)
  assert.match(route, /ALLOWED_IMAGE_FORMATS/)
  assert.match(posts, /postMedia\.createMany/)
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

test('挂号时间按北京时间显示真实创建分钟', () => {
  assert.equal(formatBeijingDateTimeMinute(new Date('2026-07-18T08:03:19.000Z')), '2026-07-18 16:03')
  const route = readFileSync('app/api/checkin/route.ts', 'utf8')
  assert.match(route, /const checkedAt = new Date\(\)/)
  assert.match(route, /const today = startOfLocalDay\(checkedAt\)/)
  assert.match(route, /const todayKey = getShanghaiDateKey\(checkedAt\)/)
  assert.match(route, /checkDate: checkedAt,\s*checkinDateKey: todayKey,\s*createdAt: checkedAt,/)
  assert.doesNotMatch(route, /checkDate: today,\s*checkinDateKey: todayKey/)
  assert.doesNotMatch(route, /createdAt: today/)
})

test('每日挂号费与经验区域提供成长体系说明', () => {
  const button = readFileSync('components/CheckInButton.tsx', 'utf8')
  const guide = readFileSync('components/CheckInGrowthGuideCard.tsx', 'utf8')
  const layout = readFileSync('components/CheckInPageSurface.tsx', 'utf8')
  const feePanel = readFileSync('components/TodayRegistrationFeePanel.tsx', 'utf8')
  assert.match(layout, /<CheckInGrowthGuideCard \/>/)
  assert.doesNotMatch(button, /<CheckInGrowthGuideCard \/>/)
  assert.match(guide, /🏥 挂号费获取指南/)
  assert.match(guide, /title="经验值 EXP"/)
  assert.match(guide, /title="什么是挂号费"/)
  assert.match(guide, /title="如何获取挂号费"/)
  assert.match(guide, /经验值 EXP ≠ 挂号费/)
  assert.match(guide, /粉丝活动报名/)
  assert.match(guide, /长期患者奖励/)
  assert.doesNotMatch(guide, /每日普通获取上限|今日实际获得|每日 30 挂号费获取上限/)
  assert.match(guide, /百日病历/)
  assert.match(layout, /TodayRegistrationFeePanel/)
  assert.match(feePanel, /医保余额/)
  assert.doesNotMatch(feePanel, /收入流水|今日挂号费/)
  assert.match(feePanel, /今日共获取/)
  assert.match(feePanel, /今日获取记录/)
  assert.match(feePanel, /record\.sourceLabel/)
  assert.match(feePanel, /record\.amount/)
  assert.match(feePanel, /record\.displayTime/)
})

test('移动端资料卡和个人主页继续使用页面自身尺寸', () => {
  const profile = readFileSync('components/ProfileSummary.tsx', 'utf8')
  const page = readFileSync('app/profile/page.tsx', 'utf8')
  assert.match(profile, /w-40 max-w-full sm:w-56/)
  assert.match(page, /<ProfilePageSurface/)
  assert.doesNotMatch(page, /PageLayoutRenderer|getPublishedPageLayoutConfig|layoutConfig/)
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

test('通知目标支持显式链接、好友、活动和无目标通知', () => {
  const base = { id: 'n1', source: 'personal' as const, link: null, targetUrl: null }
  assert.equal(getNotificationTarget({ ...base, type: 'FRIEND_REQUEST' }), '/friends#received-requests')
  assert.equal(getNotificationTarget({ ...base, type: 'ACTIVITY' }), '/activities')
  assert.equal(getNotificationTarget({ ...base, type: 'MESSAGE' }), null)
  assert.equal(getNotificationTarget({ ...base, source: 'system', type: 'SYSTEM' }), '/notifications#notification-n1')
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

test('小臣书发现流用 cursor 同步搜索、追加帖子并恢复滚动位置', () => {
  const forumHome = readFileSync('components/ForumDiscoveryHome.tsx', 'utf8')
  assert.match(forumHome, /cursor: requestCursor/)
  assert.match(forumHome, /loadPage\(false\)/)
  assert.match(forumHome, /<div ref=\{sentinelRef\} className="forum-discovery-sentinel"/)
  assert.match(forumHome, /IntersectionObserver/)
  assert.match(forumHome, /persistSession\(/)
  assert.match(forumHome, /scrollY: window\.scrollY/)
  assert.match(forumHome, /appendUniqueDiscoveryPosts\(currentPosts, incoming, reset\)/)
  assert.doesNotMatch(forumHome, /ForumPlazaHome|forum-plaza-mode-button|<Pagination/)
})

test('好友挂号留言只查询当前用户好友且空好友缓存不与公开缓存碰撞', () => {
  const messages = readFileSync('lib/checkin-messages.ts', 'utf8')
  const route = readFileSync('app/api/checkin/messages/route.ts', 'utf8')
  const friends = readFileSync('lib/friends.ts', 'utf8')
  assert.match(messages, /friends:\$\{\[\.\.\.userIds\]\.sort\(\)\.join\(','\) \|\| 'none'\}/)
  assert.match(route, /scope === 'friends'/)
  assert.match(route, /getFriendIds\(user\.id\)/)
  assert.match(friends, /prisma\.friendship\.findMany/)
  assert.match(friends, /User_Friendship_userAIdToUser: activeUserWhere/)
  assert.match(friends, /User_Friendship_userBIdToUser: activeUserWhere/)
})

test('好友入口、申请锚点和个人资料卡结构保持统一', () => {
  const menu = readFileSync('components/UserNotificationMenu.tsx', 'utf8')
  const friendsPage = readFileSync('app/friends/page.tsx', 'utf8')
  const profile = readFileSync('components/ProfileSummary.tsx', 'utf8')
  assert.match(menu, />我的好友<Badge/)
  assert.match(friendsPage, /id="received-requests"/)
  assert.match(profile, /admissionInfo\.date/)
  assert.match(profile, /已入院 \{admissionInfo\.days\} 天/)
  assert.match(profile, /w-40 max-w-full sm:w-56/)
})
