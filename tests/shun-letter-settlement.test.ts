import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

/**
 * Second-round fix: a settled anonymous letter must reveal who really took the
 * fee and show the settlement inside the paper.
 *
 * These are source-level contracts: the behaviour they describe is exercised for
 * real by `tests/shun-letter-settlement-browser.test.ts` (isolated MySQL + real
 * Chrome) and by `tests/shun-master-mysql.test.ts` (service + projection).
 */

const read = (path: string) => readFileSync(path, 'utf8')
const letterLib = read('lib/shun-anonymous-letter.ts')
const personLib = read('lib/shun-person.ts')
const service = read('lib/shun-master.ts')
const overlay = read('components/shun-master/AnonymousLetter.tsx')
const overlayCss = read('components/shun-master/anonymous-letter.module.css')
const client = read('app/shun-master/ShunMasterClient.tsx')
const route = read('app/api/shun-master/letter/[id]/route.ts')

/** The JSX block that renders the settlement, sliced for targeted assertions. */
const verdict = (() => {
  const start = overlay.indexOf('{result && <section')
  assert.ok(start > 0, '必须存在已结算结果区块')
  return overlay.slice(start, overlay.indexOf('{error &&', start))
})()

// ------------------------------------------------------------ identity unlock

test('1 — an unresolved letter keeps the anonymous heading and signature', () => {
  assert.equal(overlay.includes("const ANONYMOUS_TITLE = '一封来自神秘 EF 的信'"), true)
  assert.equal(overlay.includes("const ANONYMOUS_SIGNATURE = '—— 一位神秘的 EF'"), true)
  assert.match(overlay, /const title = sender \? `来自「\$\{sender\.nickname\}」的信` : ANONYMOUS_TITLE/)
  assert.match(overlay, /const signature = sender \? `—— \$\{sender\.nickname\}` : ANONYMOUS_SIGNATURE/)
  // `sender` can only come from a settled payload, never from the letter body.
  assert.match(overlay, /const sender = result\?\.person \?\? null/)
})

test('2 — identity is resolved only after the round is settled', () => {
  assert.match(letterLib, /const outcome: AnonymousLetterOutcome \| null = round\.result === 'SUCCESS' \|\| round\.result === 'FAILED' \? round\.result : null/)
  assert.match(letterLib, /captured: outcome !== null/, 'captured 必须由结算状态推导')
  assert.match(letterLib, /capturable: outcome === null && \(round\.candidates as string\[\]\)\.length === 3/)
  // shunPerson is called only inside the settled branch of the payload.
  const projection = letterLib.slice(letterLib.indexOf('export async function readAnonymousLetter'))
  assert.match(projection, /result: outcome && \{[\s\S]{0,160}shunPerson\(prisma, round\.actorId\) \}/,
    '未结算时不得解析真实顺取者')
})

test('3 — the letter reuses the shared public-user projection', () => {
  assert.match(letterLib, /import \{ shunPerson, type ShunPerson \} from '\.\/shun-person'/)
  assert.match(personLib, /export async function shunPerson\(/)
  assert.match(personLib, /getPublicUserDisplayName\(user\)/, '昵称必须沿用公开资料规则')
  assert.match(personLib, /isDeleted: false, status: 'ACTIVE'/, '注销或封禁账号不展示')
  // One definition only: the letter must not re-implement the display rules.
  assert.doesNotMatch(letterLib, /getPublicUserDisplayName|nicknameModerationStatus|nicknameViolationDisplay/,
    '信件不得产生第二套身份显示逻辑')
  assert.match(service, /export \{ shunPerson \} from '\.\/shun-person'/, '服务沿用同一投影')
})

test('4 — the payload never carries private identifiers', () => {
  assert.doesNotMatch(letterLib, /select: \{[\s\S]{0,400}(email|phone|passwordHash|senderId)/,
    '查询不得挑选邮箱、手机号、密码或发件人内部 id')
  assert.doesNotMatch(route, /senderId|actorId|email|phone/, '接口不得回传内部身份字段')
  assert.match(route, /Cache-Control': 'private, no-store'/, '结果不得被缓存')
})

// --------------------------------------------------------- settlement payload

test('5 — a settled round returns outcome, recovered and amount', () => {
  assert.match(letterLib, /export type AnonymousLetterResult = \{[\s\S]*?outcome: AnonymousLetterOutcome[\s\S]*?recovered: number[\s\S]*?amount: number[\s\S]*?person: ShunPerson \| null/)
  assert.match(letterLib, /result: outcome && \{ outcome, recovered: round\.recovered, amount: round\.amount, person: await shunPerson\(prisma, round\.actorId\) \}/)
})

test('6 — a failed capture reveals the sender just like a success', () => {
  // The person is not gated by the outcome anywhere in the projection.
  const projection = letterLib.slice(letterLib.indexOf('export async function readAnonymousLetter'))
  assert.doesNotMatch(projection, /outcome === 'SUCCESS'/, '失败不得继续隐藏真实顺取者')
  assert.doesNotMatch(overlay, /outcome === 'SUCCESS' \|\|/, '前端不得按结果决定是否揭晓身份')
  assert.match(verdict, /\{sender[\s\S]*?\? <Link/, '两种结果都必须渲染真实顺取者')
})

test('7 — reading a letter never settles, charges or notifies again', () => {
  assert.doesNotMatch(letterLib, /shunMasterRound\.(update|updateMany|updateManyAndReturn)/, '读取不得改写记录')
  assert.doesNotMatch(letterLib, /createNotification|notify\(/, '读取不得再发通知')
  assert.doesNotMatch(letterLib, /awardRegistrationFee|consumeRegistrationFee|ledger\(/, '读取不得动账')
  // The only write is the idempotent read receipt.
  assert.match(letterLib, /where: \{ id: letter\.id, readAt: null \}, data: \{ readAt: new Date\(\) \}/)
})

test('8 — the original anonymous note is returned verbatim', () => {
  assert.match(letterLib, /content: letter\.content,/, '正文必须原样返回')
  assert.doesNotMatch(letterLib, /letter\.content\.(replace|slice|trim|toUpperCase)/, '正文不得被改写或裁剪')
  assert.doesNotMatch(overlay, /letter\.content\.(replace|slice|trim)/, '前端不得改动原始留言')
})

// ------------------------------------------------------------------- the paper

test('9 — both settled states render the verdict inside the paper', () => {
  assert.match(verdict, /result\.outcome === 'SUCCESS' \? '抓到你啦！' : '让 TA 溜了！'/)
  assert.match(verdict, /result\.outcome === 'SUCCESS' \? `成功追回 \$\{result\.recovered\} 挂号费` : `本次未追回 \$\{result\.amount\} 挂号费`/)
  // Rendering must not depend on the investigate callback.
  assert.doesNotMatch(verdict, /onInvestigate/)
})

test('10 — the revealed sender shows avatar and links to the profile', () => {
  assert.match(overlay, /const avatar = publicImageUrl\(sender\?\.avatarUrl\)/)
  assert.match(verdict, /href=\{`\/user\/\$\{formatUid\(sender\.uid\)\}`\}/)
  assert.match(verdict, /<img src=\{avatar\} alt="" width=\{34\} height=\{34\} \/>/)
  assert.match(verdict, /<span>\{sender\.nickname\}<\/span>/)
})

test('11 — the dead "查看调查结果" action is gone and close is always available', () => {
  assert.doesNotMatch(overlay, /查看调查结果/, '已结算状态不得再出现无反馈按钮')
  // 立即调查 only exists while there is no settlement.
  assert.match(overlay, /const primary = result \? null : letter\.capturable/)
  assert.match(overlay, /onClick=\{onClose\}>收下这封信/, '关闭按钮不依赖结算状态')
  assert.match(overlay, /{result && onShowRecord && <button type="button" disabled=\{stage !== 'open'\}/)
  assert.match(overlay, /onClick=\{onShowRecord\}>查看顺取记录/)
})

test('12 — "查看顺取记录" closes the paper and lands on the row', () => {
  assert.match(client, /function showRecord\(roundId: string\) \{[\s\S]*?closeLetter\(\)[\s\S]*?setSide\('in'\)[\s\S]*?setPendingFocus\(\[side === 'in' \? `shun-record-\$\{roundId\}` : 'shun-records', 'shun-records'\]\)/)
  assert.match(client, /<article className=\{styles\.record\} key=\{row\.id\} id=\{`shun-record-\$\{row\.id\}`\} tabIndex=\{-1\}>/)
  assert.match(client, /aria-label="历史记录" id="shun-records" tabIndex=\{-1\}/)
  // The landing is visible, not a silent state change.
  assert.match(client, /node\.scrollIntoView\?\.\(\{ block: 'center', behavior: reduce \? 'auto' : 'smooth' \}\)/)
  assert.match(client, /node\.focus\(\{ preventScroll: true \}\)/)
})

// ------------------------------------------------------------- state synchronisation

test('13 — investigating still opens the untouched capture picker', () => {
  const body = client.slice(client.indexOf('async function investigate'), client.indexOf('function showRecord'))
  assert.match(body, /await openCapture\(letter\.roundId\)/)
  assert.doesNotMatch(body, /\/guess/, '前往调查不得提交答案')
  assert.match(body, /setPendingFocus\(\['shun-capture', 'shun-caught'\]\)/, '关闭信件后必须让抓捕界面可见')
  assert.match(client, /aria-label="抓捕追回" id="shun-capture" tabIndex=\{-1\}/)
})

test('14 — finishing a capture refreshes an open letter instead of caching anonymity', () => {
  const body = client.slice(client.indexOf('function confirmCapture'), client.indexOf('const rows = list'))
  assert.match(body, /if \(letter\) await openLetter\(letter\.id, true\)/, '结算后必须重新读取信件状态')
  assert.match(body, /setPendingFocus\(\['shun-caught'\]\)/, '结算结果必须滚动可见')
  assert.match(client, /role="status" id="shun-caught" tabIndex=\{-1\}/)
})

test('15 — every read goes to the server, so old letters show the latest state', () => {
  assert.match(client, /setLetter\(await api<AnonymousLetterData>\('letter\/' \+ encodeURIComponent\(id\)\)\)/)
  assert.match(client, /onClick=\{\(\) => void perform\('letter', \(\) => openLetter\(row\.id, true\)\)\}>查看神秘来信/)
  // Historical letters resolve through the round itself, not through the notice.
  assert.match(letterLib, /OR: \[\{ id \}, \{ roundId: id \}\]/, '既支持信件 id 也支持记录 id')
  assert.match(letterLib, /where: \{ id: letter\.roundId, victimId: userId \}/, '身份由记录实时推导')
})

test('16 — a non-recipient can never read the letter or its identity', () => {
  assert.match(letterLib, /where: \{ recipientId: userId, hiddenAt: null, OR: \[\{ id \}, \{ roundId: id \}\] \}/)
  assert.match(letterLib, /if \(!round \|\| round\.victimId !== userId\) return null/)
  assert.match(route, /if \(!letter\) \{[\s\S]*?status: 404/)
  assert.match(route, /未找到这封信。/)
})

// ------------------------------------------------------------------- visuals

test('17 — the reveal transition is short and reduced-motion aware', () => {
  const timing = overlayCss.match(/animation: verdictIn (\.\d+)s ease both/)
  assert.ok(timing, '结果区块必须有揭晓过渡')
  assert.ok(Number(timing[1]) <= 0.5, '揭晓过渡必须很短')
  assert.match(overlayCss, /animation: stampIn (\.\d+)s ease both/, '火漆印章淡入')
  assert.match(overlayCss, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.verdict, \.stamp, \.paper h2 \{ animation: none !important/)
})

test('18 — the settled paper stays readable and closable on a phone', () => {
  assert.match(overlayCss, /\.verdictPerson span \{ min-width: 0; overflow-wrap: anywhere; \}/, '长昵称必须安全换行')
  assert.match(overlayCss, /\.paper h2 \{[\s\S]*?overflow-wrap: anywhere/, '标题不得裁切')
  assert.match(overlayCss, /max-height: calc\(100dvh - 32px/, '信纸内部滚动')
  assert.match(overlayCss, /\.actions\[data-single='true'\] \{ grid-template-columns: 1fr; \}/, '单个操作占满整行')
  assert.match(overlayCss, /@media \(max-width: 420px\)[\s\S]*grid-template-columns: 1fr/, '窄屏按钮单列')
  assert.match(overlayCss, /\.actions button \{[\s\S]*?min-height: 44px/, '可点击区域不低于 44px')
})
