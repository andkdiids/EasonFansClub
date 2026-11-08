import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { defaultTopicLotteryConfig, normalizeTopicLotteryConfig } from '@/lib/topic-activity-v2-lottery-config'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')

const topicService = () => read('lib/topic-activity-v2-lottery.ts')
const topicPublicRoute = () => read('app/api/activities/[activityId]/v2/lottery/route.ts')
const topicPublicComponent = () => read('components/activities/TopicActivityV2LotteryPublic.tsx')
const topicAdminComponent = () => read('components/activities/TopicActivityV2LotteryAdmin.tsx')
const activityLottery = () => read('lib/activity-lottery.ts')
const activityPanel = () => read('components/activities/ActivityLotteryPanel.tsx')

test('公示规则：中奖名单始终公开，历史配置中的 false 一律被规范化', () => {
  // Platform-wide policy: no lottery may opt out of publishing its winner list.
  assert.equal(defaultTopicLotteryConfig().publishWinners, true)
  assert.equal(normalizeTopicLotteryConfig({ publishWinners: false }).publishWinners, true)
  assert.equal(normalizeTopicLotteryConfig({ publishWinners: true }).publishWinners, true)
  assert.equal(normalizeTopicLotteryConfig({}).publishWinners, true)
  // Legacy rows created before the policy keep loading without throwing.
  const legacy = normalizeTopicLotteryConfig({ version: 1, enabled: false, publishWinners: false, title: '旧抽奖' })
  assert.equal(legacy.publishWinners, true)
  assert.equal(legacy.title, '旧抽奖')
})

test('V2 公开视图：已开奖即公布名单，不再受 publishWinners 控制', () => {
  const source = topicService()
  assert.match(source, /const publicWinners = value\.state === 'DRAWN' \? await prisma\.lotteryEntry\.findMany\(/)
  assert.doesNotMatch(source, /publishWinners && value\.state === 'DRAWN'/)
  assert.match(source, /const PUBLIC_WINNER_LIMIT = 1000/)
  assert.match(source, /take: PUBLIC_WINNER_LIMIT/)
})

test('V2 公开视图：仅投影昵称、头像、E院ID、奖品与开奖时间', () => {
  const source = topicService()
  const query = source.slice(source.indexOf('const publicWinners = value.state'), source.indexOf('return { enabled: true, config: value.config'))
  const projection = source.slice(source.indexOf('winners: publicWinners.map'), source.indexOf('draw: drawRecord'))
  // Query selects only public display columns.
  assert.match(query, /nickname: true, uid: true, avatarUrl: true/)
  assert.match(projection, /nickname: getPublicUserDisplayName\(winner\.User\)/)
  assert.match(projection, /uid: String\(winner\.User\.uid\)/)
  assert.match(projection, /avatarUrl: publicImageVariantUrl\(/)
  assert.match(projection, /prizeName: winner\.LotteryPrize\?\.name \|\| '活动奖品'/)
  assert.match(projection, /wonAt: winner\.wonAt/)
  // Private fields must never be selected or projected for the public list.
  assert.doesNotMatch(query + projection, /recipient|phone|addressCiphertext|realName|idCard|email|redemptionToken/)
})

test('未开奖不提前泄露：公开视图只读，且不返回中奖记录', () => {
  const source = topicService()
  const view = source.slice(source.indexOf('export async function getTopicLotteryView'), source.indexOf('export async function getAdminTopicLotteryView'))
  // No write path may exist on the public read model.
  assert.doesNotMatch(view, /\.(update|updateMany|create|createMany|delete|deleteMany)\(/)
  assert.match(view, /: \[\]/)
  assert.match(view, /const publicWinners = value\.state === 'DRAWN'/)
})

test('V2 公开 API：显式白名单，且不要求登录（游客可查看）', () => {
  const route = topicPublicRoute()
  assert.match(route, /publicWinnerFields = \['nickname', 'uid', 'avatarUrl', 'prizeName', 'wonAt'\] as const/)
  assert.match(route, /winners: input\.winners\.map\(\(winner\) => pickRecord\(winner, publicWinnerFields\)\)/)
  assert.doesNotMatch(route, /'phone'|'realName'|'idCard'|'email'|'userId'|'recipient'/)
  // Guests must be able to read the public list: auth failure is not a hard stop.
  assert.match(route, /getTopicLotteryView\(activityId, auth\.user\?\.id\)/)
  assert.doesNotMatch(route, /status: 401/)
})

test('V2 前台：展示"名单公开：已公开"、头像、昵称主页入口与分页', () => {
  const component = topicPublicComponent()
  assert.match(component, /名单公开<\/dt><dd>已公开<\/dd>/)
  assert.doesNotMatch(component, /仅本人可见/)
  assert.doesNotMatch(component, /config\.publishWinners/)
  assert.match(component, /const showWinners = payload\.state === 'DRAWN' && payload\.winners\.length > 0/)
  assert.match(component, /item\.avatarUrl \? <img src=\{item\.avatarUrl\}/)
  assert.match(component, /'\/user\/' \+ encodeURIComponent\(item\.uid\)/)
  assert.match(component, /WINNERS_PER_PAGE/)
  assert.match(component, /中奖名单分页/)
  assert.match(component, /奖品：\{item\.prizeName\}/)
})

test('V2 后台：不公开配置已移除，改为固定公示说明', () => {
  const admin = topicAdminComponent()
  assert.doesNotMatch(admin, /patchConfig\(\{ publishWinners/)
  assert.doesNotMatch(admin, /checked=\{config\.publishWinners\}/)
  assert.match(admin, /名单公开：<span className="font-bold">已公开<\/span>/)
  assert.match(admin, /不可关闭/)
})

test('普通活动抽奖：公开名单含 E院ID 与头像，可进入个人主页', () => {
  const source = activityLottery()
  assert.match(source, /uid: true/)
  assert.match(source, /uid: entry\.User\.uid \|\| null/)
  assert.match(source, /avatarUrl: publicImageVariantUrl\(profileImageUrl\(entry\.User\.Profile\?\.avatarUrl \|\| entry\.User\.avatarUrl\), 'avatar-sm'\)/)
  const records = read('lib/activity-lottery-records.ts')
  assert.match(records, /uid: number \| null/)
  assert.match(records, /uid: winner\.uid/)
  const panel = activityPanel()
  assert.match(panel, /`\/user\/\$\{encodeURIComponent\(String\(winner\.uid\)\)\}`/)
  assert.match(panel, /aria-label=\{`查看 \$\{winner\.nickname\} 的个人主页`\}/)
})
