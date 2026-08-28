import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getMoodDisplay, NO_MOOD_LABEL } from '../lib/checkin-mood'

const read = (path: string) => readFileSync(path, 'utf8')
const route = read('app/api/checkin/route.ts')
const button = read('components/CheckInButton.tsx')
const history = read('components/CheckInHistoryDialog.tsx')
const messages = read('components/CheckInMessagesPanel.tsx')
const friendActivity = read('components/FriendActivityPanel.tsx')
const schema = read('prisma/schema.prisma')

test('数据库已经把每日挂号心情定义为可空字段', () => {
  const checkIn = schema.match(/model CheckIn \{[\s\S]*?\n\}/)?.[0]
  assert.ok(checkIn)
  assert.match(checkIn, /mood\s+String\?/)
  assert.match(checkIn, /moodType\s+String\?/)
  assert.match(checkIn, /moodEmoji\s+String\?/)
  assert.match(checkIn, /moodText\s+String\?/)
})

test('没有心情的签到统一展示为无心情，不暴露 null 或 undefined', () => {
  assert.equal(NO_MOOD_LABEL, '无心情')
  assert.deepEqual(getMoodDisplay(null), { icon: '', label: '无心情', formatted: '无心情', isCustom: false })
  assert.deepEqual(getMoodDisplay({ mood: null, moodType: null, moodEmoji: null, moodText: null }), { icon: '', label: '无心情', formatted: '无心情', isCustom: false })
})

test('每日挂号页面初始不自动选择任何心情', () => {
  assert.match(button, /const \[mood, setMood\] = useState\(''\)/)
})

test('不选择心情且不填写留言时，前端不再阻止提交', () => {
  assert.doesNotMatch(button, /if \(checkinMoodEnabled && !mood\)/)
  assert.doesNotMatch(button, /请选择今日心情/)
  assert.match(button, /disabled=\{previewMode \|\| isSubmitting\}/)
})

test('不选择心情且填写留言时，留言仍按可选字段提交', () => {
  assert.match(button, /message: note/)
  assert.match(route, /message: message \|\| null/)
  assert.match(route, /if \(message\) \{/)
})

test('选择心情且不填写留言时，预设心情仍然保留', () => {
  assert.match(button, /mood: checkinMoodEnabled && mood && mood !== 'CUSTOM' \? mood : null/)
  assert.match(button, /moodType: checkinMoodEnabled && mood \? \(mood === 'CUSTOM' \? 'CUSTOM' : 'PRESET'\) : null/)
  assert.match(route, /mood: mood\?\.key \?\? null/)
})

test('选择心情且填写留言时，两个字段都进入同一条签到流程', () => {
  assert.match(button, /moodKey: checkinMoodEnabled && mood && mood !== 'CUSTOM' \? mood : null/)
  assert.match(button, /message: note/)
  assert.match(route, /const createdCheckIn = await tx\.checkIn\.create/)
  assert.match(route, /dailyMessageId/)
})

test('前端无心情请求明确发送 null，而不是空字符串或伪造心情', () => {
  assert.match(button, /mood: checkinMoodEnabled && mood && mood !== 'CUSTOM' \? mood : null/)
  assert.match(button, /moodType: checkinMoodEnabled && mood \? \(mood === 'CUSTOM' \? 'CUSTOM' : 'PRESET'\) : null/)
  assert.doesNotMatch(button, /mood: .*\? mood : '开心'/)
})

test('服务端接受缺少 mood、mood 为 null 或空白的请求', () => {
  assert.match(route, /body\?\.moodKey \?\? body\?\.mood/)
  assert.match(route, /const moodKey = sanitizeText\(/)
  assert.doesNotMatch(route, /if \(preference\.checkinMoodEnabled && !mood && !customMood\)/)
  assert.match(route, /mood: mood\?\.key \?\? null/)
})

test('非空但不在现有预设中的 mood 仍被拒绝，不会把脏值写入数据库', () => {
  assert.match(route, /if \(preference\.checkinMoodEnabled && moodKey && requestedMoodType === PRESET_MOOD_TYPE && !requestedMood\)/)
  assert.match(route, /心情格式不正确/)
})

test('没有心情也不会跳过签到事务、普通奖励、经验和连续签到', () => {
  const transaction = route.slice(route.indexOf('const createdCheckIn = await tx.checkIn.create'), route.indexOf('return {', route.indexOf('const createdCheckIn = await tx.checkIn.create')))
  assert.match(transaction, /mood: mood\?\.key \?\? null/)
  assert.match(transaction, /awardRegistrationFee\(tx/)
  assert.match(transaction, /awardExperience\(tx/)
  assert.match(transaction, /nextStreak/)
  assert.match(transaction, /tx\.user\.update/)
})

test('每日挂号仍然保持当天唯一约束和并发幂等处理', () => {
  const checkIn = schema.match(/model CheckIn \{[\s\S]*?\n\}/)?.[0]
  assert.ok(checkIn)
  assert.match(checkIn, /@@unique\(\[userId, checkinDateKey\]\)/)
  assert.match(route, /error instanceof Prisma\.PrismaClientKnownRequestError && error\.code === 'P2002'/)
})

test('重复点击已选预设心情可以恢复为无心情', () => {
  assert.match(button, /setMood\(\(current\) => current === key \? '' : key\)/)
})

test('重复点击已选自定义心情可以恢复为无心情', () => {
  assert.match(button, /if \(mood === 'CUSTOM'\) \{[\s\S]*?setMood\(''\)/)
  assert.match(button, /setCustomMoodOpen\(false\)/)
})

test('签到完成后的卡片和历史详情使用无心情文案', () => {
  assert.match(button, /NO_MOOD_LABEL/)
  assert.match(history, /NO_MOOD_LABEL/)
  assert.match(history, /getMoodDisplay\(detail\)\.formatted \|\| NO_MOOD_LABEL/)
})

test('病友留言中的无心情记录仍保留整条留言并显示无心情', () => {
  assert.match(messages, /getMoodDisplay\(item\)/)
  assert.match(messages, /mood\.formatted \|\| NO_MOOD_LABEL/)
  assert.match(friendActivity, /getMoodDisplay\(item\)/)
  assert.doesNotMatch(friendActivity, /if \(!item\.mood\) \{?\s*return null/)
})

test('首页、个人主页和公开主页继续通过共享 formatter 兼容 null mood', () => {
  for (const path of ['components/HomeModules.tsx', 'components/ProfileDeferredModules.tsx', 'components/PublicUserModules.tsx']) {
    assert.match(read(path), /getMoodDisplay/)
  }
  assert.match(read('components/ProfileDeferredModules.tsx'), /const mood = record \? getMoodDisplay\(record\) : null/)
})

test('无心情不进入预设心情统计，但不影响签到总数统计', () => {
  assert.match(read('lib/checkin-stats.ts'), /mood:\s*\{\s*not:\s*null\s*\}/)
  assert.match(route, /calculateCheckinStreaks\(/)
  assert.match(route, /getTodayCheckInCount\(/)
})

test('心情设置文案不再把“可直接签到”限定为关闭偏好后', () => {
  const settings = read('components/UserPersonalizationSettings.tsx')
  assert.match(settings, /心情本身始终可留空/)
})
