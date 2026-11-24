import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  ANONYMOUS_LETTER_MAX_LENGTH, ANONYMOUS_LETTER_NOTIFICATION, anonymousLetterLength,
  anonymousLetterNotificationLink, readAnonymousMessageField,
} from '../lib/shun-anonymous-letter'

const read = (path: string) => readFileSync(path, 'utf8')
const service = read('lib/shun-master.ts')
const letterLib = read('lib/shun-anonymous-letter.ts')
const attemptRoute = read('app/api/shun-master/[action]/route.ts')
const letterRoute = read('app/api/shun-master/letter/[id]/route.ts')
const page = read('app/shun-master/page.tsx')
const client = read('app/shun-master/ShunMasterClient.tsx')
const overlay = read('components/shun-master/AnonymousLetter.tsx')
const overlayCss = read('components/shun-master/anonymous-letter.module.css')

// ---------------------------------------------------------------- content rules

test('a missing message keeps the untouched Shun path', () => {
  for (const value of [undefined, null]) {
    assert.deepEqual(readAnonymousMessageField(value), { provided: false })
  }
})

test('blank and whitespace-only messages are rejected', () => {
  for (const value of ['', '   ', '\n\n', '\t \r\n ']) {
    const field = readAnonymousMessageField(value)
    assert.equal(field.provided, true)
    assert.ok(field.error, '空白内容必须被拒绝')
  }
})

test('messages are trimmed, line feeds preserved and control characters dropped', () => {
  const field = readAnonymousMessageField('  第一行\r\n第二行\u0000\u0007  ')
  assert.equal(field.provided, true)
  assert.equal(field.error, null)
  assert.equal(field.content, '第一行\n第二行')
})

test('the 60 character ceiling counts user-perceived characters', () => {
  const ascii = 'a'.repeat(ANONYMOUS_LETTER_MAX_LENGTH)
  const chinese = '范'.repeat(ANONYMOUS_LETTER_MAX_LENGTH)
  const emoji = '✉'.repeat(ANONYMOUS_LETTER_MAX_LENGTH)
  for (const value of [ascii, chinese, emoji]) {
    const field = readAnonymousMessageField(value)
    assert.equal(field.error, null, '恰好 60 个字符必须通过')
    assert.equal(anonymousLetterLength(field.content ?? ''), 60)
  }
  const tooLong = readAnonymousMessageField('范'.repeat(ANONYMOUS_LETTER_MAX_LENGTH + 1))
  assert.equal(tooLong.provided, true)
  assert.match(tooLong.error ?? '', /60/)
})

test('non-string payloads never reach the transfer', () => {
  for (const value of [42, {}, [], true]) {
    const field = readAnonymousMessageField(value)
    assert.equal(field.provided, true)
    assert.ok(field.error)
  }
})

test('mixed Chinese, Latin and digits survive verbatim', () => {
  const field = readAnonymousMessageField('范范Vanessa UID:11153')
  assert.equal(field.content, '范范Vanessa UID:11153')
})

// -------------------------------------------------------------- storage contract

test('the letter is written inside the same transaction as the transfer', () => {
  const attemptStart = service.indexOf('export async function shunAttempt')
  const attemptEnd = service.indexOf('export async function shunRecords')
  const body = service.slice(attemptStart, attemptEnd)
  assert.match(body, /await tx\.shunMasterAnonymousLetter\.create\(/, '留言必须通过事务客户端写入')
  assert.doesNotMatch(body, /prisma\.shunMasterAnonymousLetter\.create\(/, '留言不得绕过事务写入')
  const previousAt = body.indexOf('actorId_requestId')
  const createAt = body.indexOf('shunMasterAnonymousLetter.create')
  assert.ok(previousAt > 0 && previousAt < createAt, '幂等重放检查必须先于留言写入')
})

test('a replayed request cannot rewrite the stored letter', () => {
  const attemptStart = service.indexOf('export async function shunAttempt')
  const body = service.slice(attemptStart, service.indexOf('export async function shunRecords'))
  const replay = body.slice(0, body.indexOf('shunMasterAnonymousLetter.create'))
  assert.match(replay, /if \(previous\) return present\(tx, previous, 'out'\)/, '重放必须直接返回既有记录')
  assert.doesNotMatch(replay, /anonymousLetter\.(update|upsert)/, '重放不得修改已创建的信件')
})

test('letter failures roll the whole transfer back', () => {
  // The letter create lives before the function returns, inside shunTransaction,
  // so any thrown error aborts the round, the ledger entries and the notification.
  assert.match(service, /const result = await shunTransaction\(async \(tx\) => \{[\s\S]*shunMasterAnonymousLetter\.create[\s\S]*\}\)/)
  assert.match(service, /if \(!result\) throw new ShunError\('NO_TARGET'/, '无目标的空事务必须仍然报错且不扣次数')
})

test('the anonymous projection never returns the sender', () => {
  const typeStart = letterLib.indexOf('export type AnonymousLetterView')
  const projection = letterLib.slice(typeStart, letterLib.indexOf('/**', typeStart))
  assert.doesNotMatch(projection, /sender/i, '收件人可见结构不得包含发送者字段')
  assert.match(letterLib, /select: \{ id: true, roundId: true, content: true, createdAt: true, readAt: true \}/,
    '查询必须显式挑选收件人可见列')
  assert.doesNotMatch(letterLib, /select: \{[\s\S]{0,200}senderId/, '查询不得挑选 senderId')
})

test('ownership, validity and hiding are all enforced server side', () => {
  assert.match(letterLib, /where: \{ recipientId: userId, hiddenAt: null, OR: \[\{ id \}, \{ roundId: id \}\] \}/)
  assert.match(letterLib, /round\.victimId !== userId\) return null/)
  assert.match(letterLib, /if \(!letter\) return null/)
})

test('a foreign or missing letter is indistinguishable from a missing one', () => {
  assert.match(letterRoute, /if \(!letter\) \{[\s\S]*?status: 404/)
  assert.match(letterRoute, /未找到这封信/)
  assert.doesNotMatch(letterRoute, /senderId|actorId|nickname|avatarUrl|email|phone/, '接口不得回传发送者身份')
  assert.match(letterRoute, /requireRequestUser/, '接口必须要求登录')
})

// ----------------------------------------------------------------- notification

test('a letter produces the mystery-letter notification linked to the round', () => {
  assert.equal(ANONYMOUS_LETTER_NOTIFICATION.title, '你收到一封神秘来信 ✉️')
  assert.equal(ANONYMOUS_LETTER_NOTIFICATION.content, '有位神秘的 EF，在顺走挂号费后给你留下了一封信。')
  const link = anonymousLetterNotificationLink('abc123')
  assert.match(link, /^\/shun-master\?/)
  assert.match(link, /record=abc123/)
  assert.match(link, /side=in/)
  assert.match(link, /letter=1/)
})

test('a transfer without a letter keeps the original notification', () => {
  const branch = service.slice(service.indexOf('if (letterContent)'), service.indexOf('const view = await present'))
  assert.match(branch, /\} else \{[\s\S]*挂号费被顺走啦！/, '无留言必须保留原有通知标题')
  assert.match(branch, /'taken'\)/, '无留言通知的 key 必须保持原样')
  assert.match(branch, /'taken-letter'/, '有留言通知使用独立 key，避免与普通通知冲突')
})

test('the notification key stays unique per round', () => {
  assert.match(service, /key: `shun:\$\{id\}:\$\{kind\}`/, '同一条顺取记录不会产生重复通知')
})

// ------------------------------------------------------------------- entry flow

test('the transfer route forwards the optional message and screens its content', () => {
  assert.match(attemptRoute, /readAnonymousMessageField\(body\.anonymousMessage\)/, '接口必须读取可选留言字段')
  assert.match(attemptRoute, /LETTER_INVALID/, '非法留言必须在顺取前被拒绝')
  assert.match(attemptRoute, /findMatchedBannedWords\(message\.content, await getEnabledBannedWords\(\)\)/,
    '留言必须走现有违禁词校验')
  assert.match(attemptRoute, /shunAttempt\(guard\.user\.id, body\.requestId, message\.provided \? message\.content : undefined\)/,
    '未提供留言时必须保持原有调用签名')
})

test('the Shun button opens the choice sheet instead of transferring', () => {
  assert.match(client, /className=\{styles\.primary\} disabled=\{!!busy \|\| !status\.remaining\} onClick=\{\(\) => setCompose\('choose'\)\}/,
    '顺一手按钮必须先打开三选一窗口')
  assert.doesNotMatch(client, /onClick=\{\(\) => void attempt\(\)\}>\{status\?\.remaining/, '顺一手按钮不得直接发起顺取')
  const directLines = client.split('\n').filter((line) => line.includes('void attempt()'))
  assert.equal(directLines.length, 1, '只有「直接顺一手」可以无留言发起顺取')
  assert.match(directLines[0], /直接顺一手/)
})

test('the choice sheet exposes the three documented actions', () => {
  assert.match(client, /要不要留一句匿名的话？/)
  assert.match(client, /你可以给幸运的 EF 留下一句话，也可以直接顺一手。/)
  assert.match(client, /匿名留言/)
  assert.match(client, /直接顺一手/)
  assert.match(client, /给幸运的 EF 留一句话/)
  assert.match(client, /写下一句只有 TA 才能看到的话……/)
})

test('replaying from the result modal returns to the same choice sheet', () => {
  assert.match(client, /setResult\(undefined\); setCompose\('choose'\)/, '再顺一手必须复用同一选择窗口')
})

test('the composer enforces the documented input rules', () => {
  assert.match(client, /const MESSAGE_MAX = 60/)
  assert.match(client, /\{messageLength\}\/\{MESSAGE_MAX\}/, '必须显示实时字数')
  assert.match(client, /slice\(0, MESSAGE_MAX\)/, '必须限制到 60 个字符')
  assert.match(client, /const canSend = messageLength > 0/, '空白内容不可提交')
  assert.match(client, /<textarea/, '必须支持多行输入')
  assert.match(client, /attempt\(message\.trim\(\)\)/, '提交前必须去除首尾空白')
})

test('返回 and 关闭 never start a transfer', () => {
  assert.match(client, /onClick=\{\(\) => setCompose\('choose'\)\}>返回</)
  assert.match(client, /onClick=\{\(\) => setCompose\(null\)\}>关闭</)
})

// --------------------------------------------------------------- auto open gate

test('a letter flag without a target never opens anything', () => {
  assert.match(page, /const autoLetterId = focus && letter === '1' \? focus/)
  assert.match(page, /letter !== '1' && \/\^\[a-z0-9\]\{1,40\}\$\/\.test\(letter\)/, '只接受合法 id')
})

test('the open animation runs at most once per navigation', () => {
  assert.match(client, /const letterRequested = useRef\(false\)/)
  assert.match(client, /if \(!autoLetterId \|\| !signedIn \|\| letterRequested\.current\) return/)
  assert.match(client, /letterRequested\.current = true/)
})

test('the flag is stripped from the address bar so refresh cannot replay it', () => {
  assert.match(client, /url\.searchParams\.delete\('letter'\)/)
  assert.match(client, /window\.history\.replaceState\(null, '', url\.pathname \+ url\.search \+ url\.hash\)/)
})

test('an unauthorised or missing letter degrades silently', () => {
  const openStart = client.indexOf('const openLetter = useCallback')
  const openBody = client.slice(openStart, client.indexOf('useEffect', openStart))
  assert.match(openBody, /catch \{[\s\S]*setLetter\(undefined\)/, '读取失败必须静默关闭而不是弹出空信封')
  assert.doesNotMatch(openBody, /setError\(/, '无效信件不得触发页面级报错')
})

test('only a letter payload can render the envelope', () => {
  assert.match(client, /\{letter && <AnonymousLetter letter=\{letter\}/, '没有信件数据绝不渲染弹层')
  assert.doesNotMatch(overlay, /dangerouslySetInnerHTML/, '留言必须以文本节点渲染，禁止注入 HTML')
})

// ------------------------------------------------------------ investigate flow

test('前往调查 reuses the existing capture preparation call', () => {
  const start = client.indexOf('async function investigate')
  const body = client.slice(start, client.indexOf('function confirmCapture'))
  assert.match(body, /await openCapture\(letter\.roundId\)/, '必须用该记录 id 调现有抓捕准备接口')
  assert.match(body, /if \(!letter \|\| letterBusy\) return/, '快速重复点击只能执行一次')
  assert.doesNotMatch(body, /\/guess/, '前往调查绝不能提交抓捕答案')
  assert.doesNotMatch(body, /setCapture\(\{/, '抓捕界面必须由 openCapture 统一打开')
})

test('the letter footer exposes the primary action and a secondary close', () => {
  assert.match(overlay, /'立即调查'/, '主按钮文案为「立即调查」')
  assert.match(overlay, /前往调查中…/, '提交中必须有进行态文案')
  assert.match(overlay, /查看调查结果/, '已抓捕记录改为查看结果')
  assert.match(overlay, /收下这封信/, '关闭信件不得自动进入抓捕')
})

test('a record that can no longer be investigated explains itself', () => {
  assert.match(client, /error\.code === 'UNAVAILABLE' \|\| error\.code === 'NOT_FOUND'/)
  assert.match(client, /capturable: false/)
  assert.match(overlay, /本次记录已不可抓捕/)
})

test('the original capture button survives a closed letter', () => {
  assert.match(overlay, /onClick=\{onClose\}>收下这封信/)
  assert.match(client, /function closeLetter\(\) \{[\s\S]*setLetter\(undefined\)/, '关闭后记录列表仍可用')
  assert.match(client, /onClick=\{\(\) => void perform\('start', \(\) => openCapture\(row\.id\)\)\}>抓捕追回</,
    '原有抓捕追回按钮必须保留')
})

// ---------------------------------------------------------------- letter visuals

test('the envelope animation is staged, skippable and reduced-motion aware', () => {
  assert.match(overlay, /type Stage = 'flying' \| 'hovering' \| 'opening' \| 'open'/)
  assert.match(overlay, /prefers-reduced-motion: reduce/, '必须兼容减少动画偏好')
  assert.match(overlay, /跳过动画/, '必须支持跳过')
  assert.match(overlay, /一封来自神秘 EF 的信/)
  assert.match(overlay, /—— 一位神秘的 EF/)
  assert.match(overlay, /event\.key === 'Escape'/, '必须支持键盘关闭')
  assert.match(overlay, /aria-modal="true"/)
})

test('the sequence stays inside the 1.5-2.5s budget', () => {
  const timing = overlay.match(/const TIMING = \{ flying: (\d+), hovering: (\d+), opening: (\d+) \}/)
  assert.ok(timing, '动画分段必须显式定义')
  const total = Number(timing[1]) + Number(timing[2]) + Number(timing[3])
  assert.ok(total >= 1500 && total <= 2500, `动画总时长 ${total}ms 必须落在 1.5-2.5 秒内`)
})

test('the animation only moves compositor-friendly properties', () => {
  const keyframes = overlayCss.slice(overlayCss.indexOf('@keyframes flyIn'))
  assert.doesNotMatch(keyframes, /\b(top|left|right|bottom|width|height|margin):/, '关键帧不得触发布局')
  assert.match(keyframes, /transform:/)
  assert.match(keyframes, /opacity:/)
  assert.match(overlayCss, /@media \(prefers-reduced-motion: reduce\)/)
})

test('long messages wrap and small screens keep the action reachable', () => {
  assert.match(overlayCss, /white-space: pre-wrap/, '留言换行必须保留')
  assert.match(overlayCss, /overflow-wrap: anywhere/)
  assert.match(overlayCss, /max-height: calc\(100dvh - 32px/, '小屏必须内部滚动而不是遮挡按钮')
  assert.match(overlayCss, /@media \(max-width: 420px\)[\s\S]*grid-template-columns: 1fr/, '窄屏按钮改为单列')
})
