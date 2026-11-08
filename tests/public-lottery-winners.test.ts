import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { defaultTopicLotteryConfig, normalizeTopicLotteryConfig } from '@/lib/topic-activity-v2-lottery-config'
import { PUBLIC_WINNER_DEFAULT_PAGE_SIZE, PUBLIC_WINNER_MAX_PAGE_SIZE, normalizePublicWinnerPagination, resolvePublicWinnerWindow } from '@/lib/public-winner-pagination'

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

test('V2 公开视图：已开奖即公布名单，不受 publishWinners 与总数上限控制', () => {
  const source = topicService()
  const view = source.slice(source.indexOf('export async function getTopicLotteryView'), source.indexOf('export async function getAdminTopicLotteryView'))
  assert.match(view, /const winnerPage = value\.state === 'DRAWN' \? await publicWinnerPage\(value\.lottery\.lotteryId, pagination\)/)
  assert.doesNotMatch(source, /publishWinners && value\.state === 'DRAWN'/)
  // The old fixed 1000-row take is gone: it silently dropped winners past the cap.
  assert.doesNotMatch(source, /PUBLIC_WINNER_LIMIT/)
  assert.doesNotMatch(view, /take: 1000/)
  // Pagination is real database pagination.
  assert.match(source, /prisma\.lotteryEntry\.count\(\{ where: \{ lotteryId \} \}\)/)
  assert.match(source, /orderBy: \[\{ wonAt: 'asc' \}, \{ id: 'asc' \}\], skip: pageWindow\.skip, take: pageWindow\.take/)
})

test('V2 公开视图：仅投影昵称、头像、E院ID、奖品与开奖时间', () => {
  const source = topicService()
  const pageFn = source.slice(source.indexOf('async function publicWinnerPage'), source.indexOf('export async function getAdminTopicLotteryView'))
  const projection = pageFn.slice(pageFn.indexOf('items: rows.map'))
  // Query selects only public display columns.
  assert.match(pageFn, /nickname: true, uid: true, avatarUrl: true/)
  assert.match(projection, /nickname: getPublicUserDisplayName\(winner\.User\)/)
  assert.match(projection, /uid: String\(winner\.User\.uid\)/)
  assert.match(projection, /avatarUrl: publicImageVariantUrl\(/)
  assert.match(projection, /prizeName: winner\.LotteryPrize\?\.name \|\| '活动奖品'/)
  assert.match(projection, /wonAt: winner\.wonAt/)
  // Private fields must never be selected or projected for the public list.
  assert.doesNotMatch(pageFn, /recipient|phone|addressCiphertext|realName|idCard|email|redemptionToken/)
})

test('未开奖不提前泄露：公开视图只读，且不返回中奖记录', () => {
  const source = topicService()
  const view = source.slice(source.indexOf('export async function getTopicLotteryView'), source.indexOf('async function publicWinnerPage'))
  // No write path may exist on the public read model.
  assert.doesNotMatch(view, /\.(update|updateMany|create|createMany|delete|deleteMany)\(/)
  // Outside DRAWN the page is an empty window, so counts and rows never leak.
  assert.match(view, /: emptyPublicWinnerPage\(pagination\)/)
  assert.match(view, /const winnerPage = value\.state === 'DRAWN'/)
  assert.match(view, /winnerPage: \{ page: winnerPage\.page, pageSize: winnerPage\.pageSize, total: winnerPage\.total, totalPages: winnerPage\.totalPages \}/)
})

test('V2 公开 API：显式白名单、服务端分页参数，且不要求登录（游客可查看）', () => {
  const route = topicPublicRoute()
  assert.match(route, /publicWinnerFields = \['nickname', 'uid', 'avatarUrl', 'prizeName', 'wonAt'\] as const/)
  assert.match(route, /winners: input\.winners\.map\(\(winner\) => pickRecord\(winner, publicWinnerFields\)\)/)
  assert.match(route, /publicWinnerPageFields = \['page', 'pageSize', 'total', 'totalPages'\] as const/)
  assert.doesNotMatch(route, /'phone'|'realName'|'idCard'|'email'|'userId'|'recipient'|'address'/)
  // Page window comes from the query string and is clamped inside the service.
  assert.match(route, /params\.get\('page'\)/)
  assert.match(route, /params\.get\('pageSize'\)/)
  assert.match(route, /getTopicLotteryView\(activityId, auth\.user\?\.id, undefined, \{/)
  // Guests must be able to read the public list: auth failure is not a hard stop.
  assert.doesNotMatch(route, /status: 401/)
})

test('V2 前台：展示"名单公开：已公开"、头像、昵称主页入口与服务端分页', () => {
  const component = topicPublicComponent()
  assert.match(component, /名单公开<\/dt><dd>已公开<\/dd>/)
  assert.doesNotMatch(component, /仅本人可见/)
  assert.doesNotMatch(component, /config\.publishWinners/)
  assert.match(component, /const showWinners = payload\.state === 'DRAWN' && winnerTotal > 0/)
  assert.match(component, /item\.avatarUrl \? <img src=\{item\.avatarUrl\}/)
  assert.match(component, /'\/user\/' \+ encodeURIComponent\(item\.uid\)/)
  assert.match(component, /中奖名单分页/)
  assert.match(component, /奖品：\{item\.prizeName\}/)
  // Pagination is requested from the server, not sliced from a capped payload.
  assert.match(component, /new URLSearchParams\(\{ page: String\(page \?\? winnerPageRef\.current\), pageSize: String\(WINNERS_PAGE_SIZE\) \}\)/)
  assert.match(component, /\/v2\/lottery\?' \+ query\.toString\(\)/)
  assert.doesNotMatch(component, /payload\.winners\.slice\(/)
  assert.doesNotMatch(component, /Math\.ceil\(payload\.winners\.length/)
  // Guests see the same list: the section is not inside an auth-only branch.
  assert.doesNotMatch(component, /isAuthenticated && showWinners/)
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

test('普通活动抽奖：公开名单查询无截断上限（不会遗漏中奖者）', () => {
  const source = activityLottery()
  const fn = source.slice(source.indexOf('export async function getPublicActivityLotteries'), source.indexOf('const badgeIds'))
  assert.match(fn, /prisma\.lotteryEntry\.findMany/)
  // No `take`/`limit` on the public winner query: the whole list is rendered.
  assert.doesNotMatch(fn, /take:/)
  assert.doesNotMatch(fn, /limit:/)
})

test('分页边界：非法与越界参数被钳制，不抛错也不截断总数', () => {
  assert.deepEqual(normalizePublicWinnerPagination(), { page: 1, pageSize: PUBLIC_WINNER_DEFAULT_PAGE_SIZE })
  assert.deepEqual(normalizePublicWinnerPagination(null), { page: 1, pageSize: PUBLIC_WINNER_DEFAULT_PAGE_SIZE })
  assert.deepEqual(normalizePublicWinnerPagination({ page: '0', pageSize: '0' }), { page: 1, pageSize: 1 })
  assert.deepEqual(normalizePublicWinnerPagination({ page: '-9', pageSize: '-3' }), { page: 1, pageSize: 1 })
  assert.deepEqual(normalizePublicWinnerPagination({ page: 'abc', pageSize: 'abc' }), { page: 1, pageSize: 20 })
  assert.deepEqual(normalizePublicWinnerPagination({ page: '3', pageSize: '1000' }), { page: 3, pageSize: PUBLIC_WINNER_MAX_PAGE_SIZE })
  assert.deepEqual(normalizePublicWinnerPagination({ page: 2.9, pageSize: 20.7 }), { page: 2, pageSize: 20 })
  assert.deepEqual(
    resolvePublicWinnerWindow({ page: 23, pageSize: 20, total: 456 }),
    { page: 23, pageSize: 20, total: 456, totalPages: 23, skip: 440, take: 20 },
  )
  // A page past the end clamps to the last page: a stale link can never make a
  // published winner list look truncated or empty.
  const beyond = resolvePublicWinnerWindow({ page: 99, pageSize: 20, total: 456 })
  assert.equal(beyond.page, 23)
  assert.equal(beyond.skip, 440)
  assert.equal(beyond.take, 20)
  assert.equal(beyond.total, 456)
  assert.equal(beyond.totalPages, 23)
  assert.deepEqual(resolvePublicWinnerWindow({ page: 1, pageSize: 20, total: 0 }), { page: 1, pageSize: 20, total: 0, totalPages: 0, skip: 0, take: 20 })
})

test('分页完整性：超过 1000 名中奖者时每一页仍可取，无人被丢弃', () => {
  for (const total of [0, 1, 19, 20, 21, 456, 999, 1000, 1001, 2500]) {
    const totalPages = resolvePublicWinnerWindow({ page: 1, pageSize: PUBLIC_WINNER_DEFAULT_PAGE_SIZE, total }).totalPages
    const seen = new Set<number>()
    for (let page = 1; page <= Math.max(1, totalPages); page += 1) {
      const window = resolvePublicWinnerWindow({ page, pageSize: PUBLIC_WINNER_DEFAULT_PAGE_SIZE, total })
      for (let index = window.skip; index < Math.min(window.skip + window.take, window.total); index += 1) seen.add(index)
    }
    assert.equal(seen.size, total, `total=${total} 必须逐页完整覆盖`)
  }
})

test('历史已开奖：库里 publishWinners=false 也照常公开，且不改写历史数据', () => {
  const stored = {
    version: 1, enabled: true, publishWinners: false, title: 'CHIN UP 三周年', description: '', mode: 'AUTO',
    drawAt: '2026-11-02T16:00:00.000Z', eligibilityDeadline: '2026-11-02T15:59:00.000Z', addressDeadline: '2026-11-15T15:59:00.000Z',
    retentionDays: 90, sourceEntryIds: ['entry-one'],
    prizes: [{ id: 'prize-one', name: '《CHIN UP !》专辑', description: '', imageUrl: null, quantity: 1, sortOrder: 0 }],
  }
  assert.equal(normalizeTopicLotteryConfig(stored).publishWinners, true)
  const source = topicService()
  const view = source.slice(source.indexOf('export async function getTopicLotteryView'), source.indexOf('async function publicWinnerPage'))
  // Disclosure must not be conditional on the stored flag at all.
  assert.doesNotMatch(view, /publishWinners/)
})

test('游客访问：公开名单接口不要求登录，观众身份只影响"我的状态"', () => {
  const route = topicPublicRoute()
  assert.match(route, /resolveRequestAuth/)
  assert.doesNotMatch(route, /requireRequestUser|requireRequestAdmin/)
  const source = topicService()
  const view = source.slice(source.indexOf('export async function getTopicLotteryView'), source.indexOf('async function publicWinnerPage'))
  assert.match(view, /const winnerPage = value\.state === 'DRAWN' \? await publicWinnerPage\(value\.lottery\.lotteryId, pagination\)/)
  // viewerId only personalises myStatus / myWinner; it never gates the list.
  assert.doesNotMatch(view, /viewerId && value\.state === 'DRAWN'/)
})

test('抽卡类（天使礼物/药房）没有批次开奖，记录接口必须登录且只返回本人', () => {
  const route = read('app/api/angel-gift/history/route.ts')
  assert.match(route, /requireRequestUser/)
  assert.match(route, /getPharmacyHistoryPage\(guard\.user\.id/)
  assert.doesNotMatch(route, /guest|匿名访问/)
})
