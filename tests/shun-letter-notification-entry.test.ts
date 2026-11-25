import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { safeInternalPathOrNull } from '../lib/url-safety'
import {
  ANONYMOUS_LETTER_ENTRY_LABEL,
  anonymousLetterNotificationLink,
  isShunLetterNotification,
  shunLetterHref,
  shunLetterRoundIdFromKey,
  shunLetterRoundIdFromLink,
} from '../lib/shun-letter-notification'

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

const ROUND = 'cmwumwygr09davbqc8liceuwx'
const LETTER_LINK = `/shun-master?record=${ROUND}&side=in&letter=1`

// --------------------------------------------------------------- detection

test('匿名信通知按可信 key 识别，认得出真实生产 key 结构', () => {
  assert.equal(shunLetterRoundIdFromKey(`shun:${ROUND}:taken-letter`), ROUND)
  assert.equal(isShunLetterNotification({ key: `shun:${ROUND}:taken-letter` }), true)
})

test('匿名信通知按结构化 link 识别，且不依赖标题文案', () => {
  assert.equal(shunLetterRoundIdFromLink(LETTER_LINK), ROUND)
  assert.equal(isShunLetterNotification({ link: LETTER_LINK }), true)
  // 只有中文标题、没有任何可信标识 → 绝不识别（禁止标题猜测）
  assert.equal(isShunLetterNotification({ title: '你收到一封神秘来信 ✉️' } as never), false)
  assert.equal(isShunLetterNotification({ title: '你收到一封神秘来信 ✉️', link: '/notifications' } as never), false)
})

test('普通顺大师通知不会被误判成匿名信', () => {
  for (const key of [`shun:${ROUND}:taken`, `shun:${ROUND}:captured`, `shun:${ROUND}:recover-actor`]) {
    assert.equal(isShunLetterNotification({ key }), false, `不应识别 ${key}`)
  }
  // 普通被顺记录链接没有 letter 标记
  assert.equal(isShunLetterNotification({ link: `/shun-master?record=${ROUND}&side=in` }), false)
  assert.equal(isShunLetterNotification({ link: `/shun-master?record=${ROUND}` }), false)
})

test('非顺大师路径、绝对外链与非法 roundId 一律不识别', () => {
  assert.equal(shunLetterRoundIdFromLink(`/notes?record=${ROUND}&letter=1`), null)
  assert.equal(shunLetterRoundIdFromLink(`https://evil.invalid/shun-master?record=${ROUND}&letter=1`), null)
  assert.equal(shunLetterRoundIdFromLink('/shun-master?record=BAD_ID&letter=1'), null)
  assert.equal(shunLetterRoundIdFromLink('/shun-master?letter=1'), null)
  assert.equal(shunLetterRoundIdFromLink('/shun-master?record=' + ROUND + '&letter='), null)
})

test('历史通知 link 缺失时用可信 key 安全恢复，不猜测 roundId', () => {
  // PR #159 之后写入的通知同时带 key 与 link；link 丢失时仅 key 也能恢复
  const href = shunLetterHref({ key: `shun:${ROUND}:taken-letter`, link: null })
  assert.equal(href, anonymousLetterNotificationLink(ROUND))
  assert.equal(href, LETTER_LINK)
  // 两者都缺失 → null（不产生任何猜测目标）
  assert.equal(shunLetterHref({ key: null, link: null }), null)
  // key 非法 → null
  assert.equal(shunLetterHref({ key: 'shun:NOT-A-ROUND:taken-letter' }), null)
})

test('通知列表接口完整传递 link / targetUrl，通配「前往查看」不被截断', () => {
  const notifications = read('lib/notifications.ts')
  // 个人通知统一投影：link 与 targetUrl 同源，查询参数不得被丢弃
  assert.match(notifications, /const link = normalizeStoredInternalPath\(item\.link\)/)
  assert.match(notifications, /targetUrl: link,/)
  // 真实链接必须原样保留（含 record / side / letter 三个参数）
  assert.equal(safeInternalPathOrNull(LETTER_LINK), LETTER_LINK)
  // 普通顺大师通知的跳转保持不变
  const plain = `/shun-master?record=${ROUND}&side=in`
  assert.equal(safeInternalPathOrNull(plain), plain)
})

// ------------------------------------------------- notification center wiring

test('通知中心：匿名信优先于普通 SYSTEM 弹窗', () => {
  const client = read('app/notifications/NotificationsClient.tsx')
  const isSystem = client.slice(client.indexOf('function isSystemNotification('), client.indexOf('function isBirthdayNotification('))
  assert.ok(isSystem.includes('isShunLetterNotification(item)'),
    'isSystemNotification 必须先排除匿名信，否则会被通用弹窗接管')
  assert.match(isSystem, /if \(isShunLetterNotification\(item\)\) return false/,
    '匿名信不得进入 isSystemNotification 分支')
  // 普通 SYSTEM 通知判定保持原样
  assert.ok(isSystem.includes("item.source === 'system' || item.type === 'SYSTEM'"),
    '普通系统通知的判定规则不得改变')
})

test('通知中心：卡片目标以匿名信链接为准，且提供专用智能入口', () => {
  const client = read('app/notifications/NotificationsClient.tsx')
  assert.match(client, /const letterHref = shunLetterHref\(item\)/,
    'renderNotification 必须解析匿名信入口')
  assert.match(client, /const target = systemNotification \? null : \(letterHref \|\| getNotificationTarget\(item\)\)/,
    '匿名信链接必须优先于通用目标解析')
  assert.match(client, /if \(letterHref\) return \{ label: ANONYMOUS_LETTER_ENTRY_LABEL, href: letterHref \}/,
    '智能入口必须给出「打开神秘来信」而不是通用详情')
  assert.ok(ANONYMOUS_LETTER_ENTRY_LABEL.length > 0)
  // 点击卡片与点击智能入口都必须把匿名信目标传下去
  assert.match(client, /void navigateToNotification\(item, letterHref \|\| target\)/)
  assert.match(client, /await navigateToNotification\(item, shunLetterHref\(item\)\)/)
})

test('通知中心：先写已读再导航，已读状态不被信件流程改变', () => {
  const client = read('app/notifications/NotificationsClient.tsx')
  const navigate = client.slice(client.indexOf('async function navigateToNotification('), client.indexOf('async function openNotification('))
  assert.match(navigate, /await markRead\(item\)/, '导航前必须先落已读')
  assert.match(navigate, /router\.push\(target\)/, '必须真实跳转到匿名信入口')
  // 「收下这封信」不写任何已读/删除逻辑
  const letter = read('components/shun-master/AnonymousLetter.tsx')
  assert.ok(!/markRead|unread|DELETE|fetch\(/.test(letter), '信件组件不得改动通知已读状态或删除留言')
})

test('站内通知弹出层：匿名信入口同样可用（不落到通用通知页）', () => {
  const toast = read('components/NotificationToast.tsx')
  assert.match(toast, /const letterHref = shunLetterHref\(\{ key: toast\.key, link: toast\.link, targetUrl: toast\.targetUrl \}\)/)
  // 普通被顺通知同样必须直连「谁顺了我」的记录，不能再落到通用通知页。
  assert.match(toast, /const shunRound = shunRoundNotification\(\{ key: toast\.key, link: toast\.link, targetUrl: toast\.targetUrl \}\)/)
  // V5：入口统一走 side-aware 的 shunInvestigationHref，抓捕通知因此落到「我顺了谁」，
  // 被顺通知仍落到「谁顺了我」；抓捕者留了话时优先直达留言。
  assert.match(toast, /shunInvestigationHref\(\{ key: toast\.key, link: toast\.link, targetUrl: toast\.targetUrl \}\)/)
  assert.match(toast, /const captureHref = captureLetterHref\(/)
  assert.match(toast, /captureHref \|\| letterHref/)
  assert.match(toast, /\{actionLabel\}/, 'CTA 文案必须按通知类型给出「打开神秘来信」/「查看留言」/「前往调查」/「查看调查结果」')
})

test('信件内容来自真实接口，不在前端硬编码正文', () => {
  const shun = read('app/shun-master/ShunMasterClient.tsx')
  assert.match(shun, /api<AnonymousLetterData>\('letter\/' \+ encodeURIComponent\(id\)\)/, '必须调用真实匿名信接口')
  const letter = read('components/shun-master/AnonymousLetter.tsx')
  assert.match(letter, /<p className=\{styles\.body\}>\{letter\.content\}<\/p>/, '正文必须来自接口数据')
  assert.ok(!/dangerouslySetInnerHTML/.test(letter), '不得把留言当 HTML 渲染')
  const route = read('app/api/shun-master/letter/[id]/route.ts')
  assert.match(route, /readAnonymousLetter\(/, '接口必须走收件人作用域读取')
  assert.match(route, /requireRequestUser\(request\)/, '接口必须要求登录')
})

test('非收件人不可读取：统一 404，不泄露发送者身份', () => {
  const service = read('lib/shun-anonymous-letter.ts')
  assert.match(service, /where: \{ recipientId: userId, hiddenAt: null, OR: \[\{ id \}, \{ roundId: id \}\] \}/,
    '读取必须限定 recipientId')
  assert.match(service, /if \(!round \|\| round\.victimId !== userId\) return null/, '记录归属必须二次校验')
  assert.match(service, /select: \{ id: true, roundId: true, content: true, createdAt: true, readAt: true \}/,
    '投影不得包含 senderId 等可反查字段')
  assert.ok(!/senderId: true/.test(service), '不得返回 senderId')
  const route = read('app/api/shun-master/letter/[id]/route.ts')
  assert.match(route, /404/, '不存在的信件统一 404')
})

test('「立即调查」复用现有抓捕准备接口，只开选择不提交答案', () => {
  const shun = read('app/shun-master/ShunMasterClient.tsx')
  const investigate = shun.slice(shun.indexOf('async function investigate('), shun.indexOf('function confirmCapture('))
  assert.match(investigate, /await openCapture\(letter\.roundId\)/, '必须复用现有抓捕准备调用')
  assert.ok(!/[Cc]onfirmCapture|guess/.test(investigate), '前往调查不得自动提交抓捕答案')
  const capture = read('app/api/shun-master/capture/[id]/[action]/route.ts')
  assert.match(capture, /shunCapture\(/, '抓捕仍走原有结算服务')
  // 看信不写黄金期：不重置、不延长
  assert.ok(!/goldenUntil/.test(investigate), '看信不得触碰黄金抓捕倒计时')
  assert.ok(!/fetch\(|method: 'POST'|method: 'PATCH'/.test(read('components/shun-master/AnonymousLetter.tsx')),
    '信件组件是纯展示层，不得写回服务端任何状态（含黄金抓捕倒计时）')
})

test('已抓捕 / 不可抓捕状态正确，绝不重复抓捕', () => {
  const letter = read('components/shun-master/AnonymousLetter.tsx')
  // 已结算信件直接在信纸内展示结果，不再保留会点空的主按钮
  assert.match(letter, /const primary = result \? null : letter\.capturable/, '已结算时不渲染抓捕主按钮')
  assert.match(letter, /抓到你啦！/, '成功必须直接展示结果')
  assert.match(letter, /让 TA 溜了！/, '失败也必须直接展示结果')
  assert.doesNotMatch(letter, /查看调查结果/, '已抓捕不得再显示无反馈按钮')
  assert.match(letter, /本次记录已不可抓捕/, '不可抓捕必须给出真实原因')
  const service = read('lib/shun-anonymous-letter.ts')
  assert.match(service, /captured: outcome !== null/, '抓捕状态必须取自真实记录')
  // 读取路径唯一允许的写入是首次已读时间；不得有删除、隐藏或改判定的写操作
  assert.match(service, /updateMany\(\{\s*where: \{ id: letter\.id, readAt: null \}, data: \{ readAt: new Date\(\) \},?\s*\}\)/,
    '唯一允许的写入是条件式 readAt')
  assert.ok(!/\.delete\(|\.deleteMany\(|hiddenAt: new Date|\.update\(\{/.test(service),
    '读取信件不得删除、隐藏或改写任何记录')
})

test('重复点击通知只开一次信：一次性标记 + 去除查询参数', () => {
  const shun = read('app/shun-master/ShunMasterClient.tsx')
  assert.match(shun, /if \(!autoLetterId \|\| !signedIn \|\| letterRequested\.current\) return/)
  assert.match(shun, /letterRequested\.current = true/)
  assert.match(shun, /url\.searchParams\.delete\('letter'\)/)
  assert.match(shun, /window\.history\.replaceState\(null, '', url\.pathname \+ url\.search \+ url\.hash\)/,
    '刷新与返回不得重放动画')
  // 关闭后再次查看走静默模式，不重播飞入动画
  assert.match(shun, /openLetter\(row\.id, true\)/, '记录里的再次查看必须跳过飞入动画')
  assert.match(shun, /instant=\{letterInstant\}/)
  const letter = read('components/shun-master/AnonymousLetter.tsx')
  assert.match(letter, /instant \|\| prefersReducedMotion\(\) \? 'open' : 'flying'/)
  assert.match(letter, /if \(instant\) return/, '静默模式不得排队播放动画')
})

test('记录页提供「再次查看信件」入口，且只有收件侧可见', () => {
  const shun = read('app/shun-master/ShunMasterClient.tsx')
  assert.match(shun, /\{side === 'in' && row\.hasLetter && \(/, '入口只在被顺（收件）侧出现')
  assert.match(shun, /查看神秘来信/)
  const service = read('lib/shun-master.ts')
  assert.match(service, /recipientId: userId, hiddenAt: null/, 'hasLetter 必须来自收件人作用域查询')
  assert.match(service, /\.\.\.\(side === 'in' \? \{ hasLetter \} : \{\}\)/, '发送方视图不得暴露信件存在性')
})

test('信封动画支持移动端、减少动画与跳过，且层级正确', () => {
  const css = read('components/shun-master/anonymous-letter.module.css')
  assert.match(css, /prefers-reduced-motion/, '必须兼容减少动画')
  assert.match(css, /@media\s*\(max-width/, '必须有移动端适配')
  assert.match(css, /position:\s*fixed/, '弹层必须固定定位，滚动时不被遮挡')
  assert.match(css, /z-index/, '弹层必须有明确层级')
  const letter = read('components/shun-master/AnonymousLetter.tsx')
  assert.match(letter, /跳过动画/, '必须支持跳过')
  assert.match(letter, /role="dialog"/)
  assert.match(letter, /aria-modal="true"/)
  assert.match(letter, /event\.key === 'Escape'/, '必须支持键盘关闭')
})

test('匿名信在独立通知事务中写入，且不影响金额/结算/补偿', () => {
  const shun = read('lib/shun-master.ts')
  // 顺取先结算，留言是之后的选择：信件与通知必须落在通知步骤自己的事务里。
  const block = shun.slice(shun.indexOf('export async function shunNotifyRound'),
    shun.indexOf('export function shunSendNotification'))
  assert.match(block, /tx\.shunMasterAnonymousLetter\.create/, '留言必须在通知事务内写入')
  assert.match(block, /anonymousLetterNotificationLink\(round\.id\)/, '通知链接必须由统一构造器生成')
  assert.match(block, /'taken-letter'/, 'key 必须带 taken-letter 后缀')
  assert.match(block, /return shunTransaction\(async \(tx\)/, '通知与信件必须同一事务，避免半成品')
  // 经济逻辑未被触碰
  assert.match(shun, /const rolled = weightedIndex\(config\.probabilities\) \+ 1/, '金额概率规则必须保持')
  assert.match(shun, /const amount = Math\.min\(rolled, victimBalance\)/, '金额上限规则必须保持')
  assert.ok(!/anonymousLetter[\s\S]{0,200}(recovered|compensation|ledger)/.test(block),
    '匿名信不得介入追回、补偿或流水')
})

test('通知详情对两类顺大师通知都提供调查入口，关闭只关展示', () => {
  const dialog = read('components/SystemNotificationDialog.tsx')
  const center = read('app/notifications/NotificationsClient.tsx')
  assert.match(dialog, /actions\?: Array<\{ label: string; onClick: \(\) => void \}>/, '弹窗必须支持多个动作按钮')
  assert.match(dialog, /closeLabel = '知道了'/, '默认关闭文案保持不变')
  assert.match(center, /function shunNotificationActions/, '顺大师通知必须有专属动作集')
  assert.match(center, /label: ANONYMOUS_LETTER_ENTRY_LABEL/, '匿名信通知提供「打开神秘来信」')
  assert.match(center, /label: SHUN_INVESTIGATE_ENTRY_LABEL/, '两类通知都必须提供「前往调查」')
  assert.match(center, /shunRound \|\| systemNotification\) openSystemNotification/,
    '卡片点击也必须进入带调查入口的详情，而不是直接吞掉')
  assert.match(center, /closeLabel=\{shunRoundNotification\(selectedSystemNotification\) \? '关闭' : undefined\}/)
  const actions = center.slice(center.indexOf('function shunNotificationActions'), center.indexOf('function openSystemNotification'))
  assert.match(actions, /router\.push\(letter\)/)
  assert.match(actions, /router\.push\(investigate\)/, '前往调查必须直达带 roundId 的记录地址')
})
