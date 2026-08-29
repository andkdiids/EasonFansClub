import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  CHECK_IN_REPLY_PREVIEW_LIMIT,
  getCheckInReplyToggleLabel,
  getVisibleCheckInReplyCount,
} from '../lib/checkin-reply-display'

const read = (path: string) => readFileSync(path, 'utf8')

test('挂号好友动态回复按每条留言独立折叠到前三条', () => {
  assert.equal(CHECK_IN_REPLY_PREVIEW_LIMIT, 3)
  assert.equal(getVisibleCheckInReplyCount(0, false), 0)
  assert.equal(getVisibleCheckInReplyCount(1, false), 1)
  assert.equal(getVisibleCheckInReplyCount(3, false), 3)
  assert.equal(getVisibleCheckInReplyCount(4, false), 3)
  assert.equal(getVisibleCheckInReplyCount(10, false), 3)
  assert.equal(getVisibleCheckInReplyCount(10, true), 10)
  assert.equal(getCheckInReplyToggleLabel(3, false), null)
  assert.equal(getCheckInReplyToggleLabel(4, false), '展开剩余 1 条回复')
  assert.equal(getCheckInReplyToggleLabel(10, false), '展开剩余 7 条回复')
  assert.equal(getCheckInReplyToggleLabel(10, true), '收起回复')

  const panel = read('components/CheckInMessagesPanel.tsx')
  assert.match(panel, /expandedReplies\[item\.id\]/)
  assert.match(panel, /threadComments\.slice\(0, getVisibleCheckInReplyCount\(/)
  assert.match(panel, /getCheckInReplyToggleLabel\(/)
})

test('主页留言回复使用可见的幂等 REPLY 通知并定位到真实留言', () => {
  const route = read('app/api/profile-wall/route.ts')
  assert.match(route, /recipientId = parentMessage\?\.senderId \|\| receiver\.id/)
  assert.match(route, /if \(recipientId !== viewer\.id\)/)
  assert.match(route, /upsertNotification\(/)
  assert.match(route, /type: 'REPLY'/)
  assert.match(route, /key: notificationKey/)
  assert.match(route, /rawContent\.slice\(0, 120\)/)
  assert.match(route, /wall\?focus=\$\{created\.id\}/)
})

test('默认头像图库复用 SiteSetting 头像池并只保存当前用户的 avatarUrl', () => {
  const service = read('lib/default-avatars.ts')
  const page = read('app/profile/page.tsx')
  const form = read('app/profile/ProfileSettingsForm.tsx')
  const api = read('app/api/users/me/route.ts')
  assert.match(service, /getDefaultAvatarOptions/)
  assert.match(service, /users\.defaultAvatarPool/)
  assert.match(service, /publicImageUrl\(item\.url\)/)
  assert.match(page, /getDefaultAvatarOptions\(\)/)
  assert.match(form, /defaultAvatarOptions/)
  assert.match(form, /使用此头像/)
  assert.match(form, /profile-avatar-updated/)
  assert.match(api, /const guard = await requireUser\(\)/)
  assert.match(api, /data\.avatarUrl = publicImageUrl\(avatarUrl\)/)
})

test('每日处方历史读取用户自己的快照和真实 PointLog，分页且不会触发抽奖', () => {
  const schema = read('prisma/schema.prisma')
  const service = read('lib/entertainment.ts')
  const page = read('app/prescription/history/page.tsx')
  const dailyDetail = read('components/games/DailyPrescriptionDetail.tsx')
  assert.match(schema, /@@unique\(\[userId, dateKey\]\)/)
  assert.match(schema, /lyricText\s+String\?/)
  assert.match(schema, /dailyDrawId\s+String\?\s+@unique/)
  assert.match(service, /PRESCRIPTION_HISTORY_PAGE_SIZE = 12/)
  assert.match(service, /where: \{ userId \}/)
  assert.match(service, /PointLog:/)
  assert.match(service, /orderBy: \[\{ dateKey: 'desc' \}/)
  assert.match(page, /const user = await getCurrentUser\(\)/)
  assert.match(page, /getEntertainmentDailyDrawHistory\(user\.id/)
  assert.match(page, /SavePrescriptionButton data=\{record\}/)
  assert.match(dailyDetail, /href="\/prescription\/history"/)
  assert.doesNotMatch(page, /issueEntertainmentDailyDraw/)
})
