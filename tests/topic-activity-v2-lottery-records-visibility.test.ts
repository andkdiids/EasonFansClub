import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')

const service = () => read('lib/topic-activity-v2-lottery.ts')
const fulfillment = () => read('lib/topic-activity-v2-lottery-fulfillment.ts')
const publicRoute = () => read('app/api/activities/[activityId]/v2/lottery/route.ts')
const adminRoute = () => read('app/api/admin/activities/[activityId]/v2/lottery/route.ts')
const publicComponent = () => read('components/activities/TopicActivityV2LotteryPublic.tsx')
const recordsPage = () => read('app/admin/activities/lottery-records/page.tsx')

test('抽奖结果持久化：开奖批次、中奖记录、收货记录与通知 outbox 在同一事务创建', () => {
  const source = service()
  assert.match(source, /tx\.topicActivityLotteryDraw\.create\(/)
  assert.match(source, /tx\.lotteryEntry\.create\(/)
  assert.match(source, /tx\.topicActivityLotteryShipping\.create\(/)
  assert.match(source, /tx\.topicActivityLotteryNotice\.create\(/)
  assert.match(source, /state:\s*'DRAWN'/)
  assert.match(source, /drawnAt:\s*now/)
  assert.match(source, /algorithmVersion:\s*'TOPIC_FROZEN_SECURE_SHUFFLE_V1'/)
})

test('用户端开奖记录查询：白名单包含 draw，且只投影脱敏字段', () => {
  const route = publicRoute()
  assert.match(route, /publicViewFields[^\n]*'draw'/)
  assert.match(route, /publicDrawFields\s*=\s*\['id',\s*'state',\s*'frozenAt',\s*'drawnAt',\s*'candidateCount',\s*'winnerCount',\s*'errorCode'\]/)
  assert.match(route, /draw:\s*pickRecord\(input\.draw,\s*publicDrawFields\)/)
  // Internal frozen/allocation data must never reach the browser.
  assert.doesNotMatch(route, /candidateSnapshot|allocationHash|candidateHash|prizeSnapshot/)
})

test('未开奖活动不得提前泄露中奖结果：draw 仅在 DRAWN 状态返回', () => {
  const source = service()
  assert.match(source, /value\.batch && value\.state === 'DRAWN'/)
  assert.match(source, /draw:\s*null/)
  assert.match(source, /draw:\s*drawRecord/)
  assert.match(source, /publishWinners && value\.state === 'DRAWN'/)
  const component = publicComponent()
  assert.match(component, /payload\.draw \?/)
  assert.match(component, /开奖记录/)
  // The draw record section is not gated by the optional winners list.
  assert.match(component, /const showWinners = config\.publishWinners && payload\.winners\.length > 0/)
  assert.doesNotMatch(component, /showWinners \?.*开奖记录/)
})

test('后台开奖记录查询：draw 投影补齐状态、开奖时间与错误码', () => {
  const source = service()
  assert.match(source, /state:\s*value\.batch\.state/)
  assert.match(source, /drawnAt:\s*value\.batch\.drawnAt/)
  assert.match(source, /startedAt:\s*value\.batch\.startedAt/)
  assert.match(source, /errorCode:\s*value\.batch\.errorCode/)
  const route = adminRoute()
  assert.match(route, /adminDrawFields[^\n]*'state'[^\n]*'drawnAt'[^\n]*'errorCode'/)
})

test('后台入口存在且沿用现有权限控制（activity_manage）', () => {
  const page = recordsPage()
  assert.match(page, /requireAdminPage\('\/admin\/activities\/lottery-records',\s*'activity_manage'\)/)
  assert.match(page, /topicActivityLotteryDraw\.findMany/)
  assert.match(page, /收货信息\{winner\.TopicShipping\?\.addressCiphertext/)
  assert.match(page, /topicActivityLotteryAudit\.findMany/)
  const nav = read('lib/admin-navigation.ts')
  assert.match(nav, /href:\s*'\/admin\/activities\/lottery-records'/)
  const activities = read('app/admin/activities/page.tsx')
  assert.match(activities, /查看话题活动开奖记录/)
  const adminApi = adminRoute()
  assert.match(adminApi, /requireRequestAdmin\(request,\s*'activity_manage'\)/)
  const addressApi = read('app/api/admin/activities/[activityId]/v2/lottery/winners/[winnerId]/address/route.ts')
  assert.match(addressApi, /activity_lottery_shipping/)
})

test('地址提交成功后通知管理员：复用现有 ADMIN 通知机制并关联活动', () => {
  const source = fulfillment()
  const saveBlock = source.slice(source.indexOf('export async function saveTopicLotteryAddress'), source.indexOf('export async function getAdminTopicLotteryAddress'))
  assert.match(saveBlock, /notifyAdminsOfAddressSubmission\(tx, context, input\.winnerId, now\)/)
  assert.match(source, /const key = `topic-v2-lottery-address:\$\{winnerId\}`/)
  assert.match(source, /type:\s*'ADMIN'/)
  assert.match(source, /activityId:\s*context\.activity\.id/)
  assert.match(source, /upsertNotificationWithDb\(/)
  assert.match(source, /permissionKey:\s*\{\s*in:\s*\['activity_manage',\s*'activity_lottery_shipping'\]/)
  assert.match(source, /link = `\/admin\/activities\/lottery-records\?activityId=/)
  const schema = read('prisma/schema.prisma')
  assert.match(schema, /@@unique\(\[recipientId, key\]\)/)
})

test('地址重复提交及更新：幂等 key + 重置未读，不产生重复通知', () => {
  const source = fulfillment()
  assert.match(source, /where:\s*\{\s*recipientId_key:\s*\{\s*recipientId:\s*admin\.id,\s*key\s*\}\s*\}/)
  assert.match(source, /update:\s*\{[^}]*isRead:\s*false,\s*readAt:\s*null/)
  assert.match(source, /ADDRESS_SAVE/)
  assert.equal((source.match(/topic-v2-lottery-address:/g) || []).length, 1, '通知 key 只定义一次')
})

test('通知失败及重试：必须有明确日志并向上抛出，不能静默丢失', () => {
  const source = fulfillment()
  assert.match(source, /\[topic-v2-lottery\.admin-notification\.failed\]/)
  assert.match(source, /ADDRESS_ADMIN_NOTIFICATION_FAILED/)
  assert.match(source, /throw error/)
  assert.match(source, /\[topic-v2-lottery\.winner-notification\.failed\]/)
  const lottery = service()
  assert.match(lottery, /\[topic-v2-lottery\.draw\.finalization-failed\]/)
  assert.match(lottery, /\[topic-v2-lottery\.draw\.auto-failed\]/)
  assert.match(lottery, /DRAW_FAILED_RECOVERABLE/)
})

test('敏感信息访问控制：通知与后台记录页均不含完整地址/电话/收件人', () => {
  const source = fulfillment()
  const helper = source.slice(source.indexOf('async function notifyAdminsOfAddressSubmission'), source.indexOf('export async function saveTopicLotteryAddress'))
  assert.doesNotMatch(helper, /address\.recipient|address\.phone|address\.address|addressCiphertext|normalizeAddress/)
  assert.match(helper, /本通知不包含任何敏感信息/)
  const page = recordsPage()
  assert.doesNotMatch(page, /\.phone|\.recipient|addressPayload|decryptTopicLotteryPii/)
  assert.match(page, /收货地址与联系电话不在此展示/)
  const api = read('app/api/admin/activities/[activityId]/v2/lottery/winners/[winnerId]/address/route.ts')
  assert.match(api, /activity_lottery_shipping/)
})

test('用户端公开字段白名单不含 userId / 手机号 / 真实姓名', () => {
  const route = publicRoute()
  assert.match(route, /publicWinnerFields\s*=\s*\['nickname',\s*'uid',\s*'prizeName'\]/)
  assert.doesNotMatch(route, /'phone'|'realName'|'userId'/)
})

test('地址提交通知不得与开奖时发给中奖用户的通知混淆', () => {
  const source = fulfillment()
  assert.match(source, /notificationKey = `topic-v2-lottery-win:\$\{candidate\.winnerId\}`/)
  assert.match(source, /recipientId:\s*context\.winner\.userId/)
  assert.match(source, /type:\s*'ACTIVITY'/)
  assert.notEqual(source.indexOf('topic-v2-lottery-win:'), source.indexOf('topic-v2-lottery-address:'))
})
