import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  BADGE_EVALUATION_EVENTS, BADGE_RULE_REGISTRY, SHUN_BADGE_RULE_DEFAULT_THRESHOLD, SHUN_BADGE_RULE_TYPES,
} from '@/lib/badge-rules'
import {
  defaultShunConfig, shunConfigError, validateShunConfig, RECOVERY_BONUS_CHANCE_DEFAULT,
  SHUN_CAPTURE_NOTIFY_STATUS, SHUN_CAPTURE_NOTIFY_WINDOW_MS,
} from '@/lib/shun-config'
import {
  CAPTURE_LETTER_ENTRY_LABEL, CAPTURE_RESULT_ENTRY_LABEL, captureInvestigationLink,
  captureLetterNotificationLink, captureLetterRoundId, captureNotifyKey, isShunCaptureKind, shunInvestigationHref,
  shunRoundNotification,
} from '@/lib/shun-letter-notification'
import { CAPTURE_LETTER_MAX_LENGTH, CAPTURE_RESULT_NOTIFICATION, readCaptureMessageField } from '@/lib/shun-capture-letter'

/**
 * V5 source contracts.
 *
 * These lock the cross-file promises the acceptance list depends on: the
 * capture counter note, its reuse of the shipped 1500ms animation, the
 * recovery-bonus safety rails and the three cumulative badge rules. Behaviour
 * that needs a database is covered by `shun-master-v5-mysql.test.ts`.
 */

const read = (path: string) => readFileSync(path, 'utf8')
const service = read('lib/shun-master.ts')
const captureLetter = read('lib/shun-capture-letter.ts')
const notifyModule = read('lib/shun-letter-notification.ts')
const worker = read('lib/shun-notify-worker.ts')
const client = read('app/shun-master/ShunMasterClient.tsx')
const page = read('app/shun-master/page.tsx')
const sender = read('components/shun-master/SendAnonymousLetter.tsx')
const senderCss = read('components/shun-master/send-anonymous-letter.module.css')
const captureView = read('components/shun-master/CaptureLetter.tsx')
const captureLetterRoute = read('app/api/shun-master/capture-letter/[id]/route.ts')
const adminApi = read('app/api/admin/shun-master/route.ts')
const adminUi = read('app/admin/shun-master/ShunMasterAdmin.tsx')
const notifications = read('app/notifications/NotificationsClient.tsx')
const toast = read('components/NotificationToast.tsx')
const schema = read('prisma/schema.prisma')
const migration = read('prisma/migrations/20261125210000_add_shun_master_v5/migration.sql')

// ------------------------------------------------------- capture note rules

test('capture note shares the 60-character content contract', () => {
  assert.equal(CAPTURE_LETTER_MAX_LENGTH, 60)
  assert.equal(readCaptureMessageField(undefined).provided, false)
  assert.equal(readCaptureMessageField('   ').error, '留言内容不能为空。')
  assert.equal(readCaptureMessageField('抓到你啦').error, null)
  assert.ok(readCaptureMessageField('字'.repeat(61)).error)
  // Trimmed, newlines preserved, control characters dropped, code points counted.
  assert.equal((readCaptureMessageField('  你好\n世界  ') as { content: string }).content, '你好\n世界')
  assert.equal(readCaptureMessageField(`a${String.fromCharCode(7)}b`).error, null)
  assert.equal((readCaptureMessageField(`a${String.fromCharCode(7)}b`) as { content: string }).content, 'ab')
})

test('the capture note is signed and only exposes public identity', () => {
  assert.match(captureView, /抓获你的这位 EF 留言了/, '必须点明是抓获者的留言')
  assert.match(captureView, /letter\.person\?\.nickname/, '必须展示抓捕者昵称')
  assert.match(captureView, /formatUid\(letter\.person\.uid\)/, '必须可进入公开主页')
  // The view type carries no internal identifier or contact field at all.
  assert.match(captureView, /person: \{ uid: number; nickname: string; avatarUrl: string \| null \} \| null/)
  assert.doesNotMatch(captureView, /senderId:|recipientId:|email:|phone:/, '视图类型不得含内部标识或联系方式')
  // The service projection also never returns the sender id.
  assert.match(captureLetter, /select: \{ id: true, roundId: true, senderId: true, content: true, createdAt: true, readAt: true \}/)
  assert.match(captureLetter, /person: await shunPerson\(prisma, letter\.senderId\)/, '只经公开投影')
})

test('one successful capture can carry at most one note', () => {
  assert.match(schema, /model ShunMasterCaptureLetter \{[\s\S]*?roundId\s+String\s+@unique/)
  assert.match(service, /await tx\.shunMasterCaptureLetter\.create\(\{ data: \{\s*roundId: round\.id/)
  // A note can never be appended once the plain arrest notice went out.
  assert.match(service, /if \(round\.captureNotifyStatus !== SHUN_CAPTURE_NOTIFY_STATUS\.pending\) \{[\s\S]{0,200}?ALREADY_NOTIFIED/)
  // And never for a capture that did not succeed.
  assert.match(service, /if \(round\.result !== 'SUCCESS'\) throw new ShunError\('NOT_CAPTURED'/)
})

// ------------------------------------------------------------ notifications

test('the caught actor is told with the required title and both bodies', () => {
  assert.equal(CAPTURE_RESULT_NOTIFICATION.title, '你已被逮捕！🚨')
  assert.equal(CAPTURE_RESULT_NOTIFICATION.plain(6), '你顺走的 6 挂号费已被成功追回！')
  assert.equal(CAPTURE_RESULT_NOTIFICATION.letter(6), '你顺走的 6 挂号费已被成功追回，对方还给你留下了一句话！')
  assert.match(service, /notifyCapture\(tx, round, withLetter\)/)
  assert.match(service, /withLetter \? 'captured-letter' : 'captured'/)
})

test('capture notices use their own keys and land on 「我顺了谁」', () => {
  const round = 'cmtestround0001'
  assert.equal(captureNotifyKey(round, false), `shun:${round}:captured`)
  assert.equal(captureNotifyKey(round, true), `shun:${round}:captured-letter`)
  assert.equal(captureInvestigationLink(round), `/shun-master?record=${round}&side=out`)
  assert.equal(captureLetterNotificationLink(round), `/shun-master?record=${round}&side=out&captureLetter=1`)

  // Both key shapes are recognised, and they are capture kinds.
  assert.deepEqual(shunRoundNotification({ key: captureNotifyKey(round, false) }), { roundId: round, kind: 'captured' })
  assert.deepEqual(shunRoundNotification({ key: captureNotifyKey(round, true) }, ), { roundId: round, kind: 'captured-letter' })
  assert.equal(isShunCaptureKind('captured'), true)
  assert.equal(isShunCaptureKind('captured-letter'), true)
  assert.equal(isShunCaptureKind('taken'), false)
  // Link-only recognition still works (historical rows) and stays side-aware.
  assert.equal(shunInvestigationHref({ link: captureInvestigationLink(round) }), captureInvestigationLink(round))
  assert.equal(captureLetterRoundId({ key: captureNotifyKey(round, true) }), round)
  assert.equal(captureLetterRoundId({ key: captureNotifyKey(round, false) }), null)
  // The anonymous-letter reader must never claim a capture notice.
  assert.ok(notifyModule.includes('LETTER_KEY_PATTERN = /^shun:([a-z0-9]{1,40}):taken-letter$/'),
    '匿名信只认 taken-letter 键，抓捕通知不得触发来信阅读')
})

test('capture decisions are deferred with the same 120-second sweep', () => {
  assert.equal(SHUN_CAPTURE_NOTIFY_WINDOW_MS, 120_000)
  assert.equal(SHUN_CAPTURE_NOTIFY_STATUS.pending, 'PENDING')
  assert.match(service, /captureNotifyStatus: SHUN_CAPTURE_NOTIFY_STATUS\.pending/)
  assert.match(service, /captureNotifyDueAt: new Date\(now\.getTime\(\) \+ SHUN_CAPTURE_NOTIFY_WINDOW_MS\)/)
  assert.match(worker, /captureNotifyStatus: SHUN_CAPTURE_NOTIFY_STATUS\.pending, captureNotifyDueAt: \{ lte: now \}/)
  assert.match(worker, /shunSendDueCaptureNotification\(id\)/)
  // Historical rows default to "already notified" so the upgrade cannot re-send.
  assert.match(migration, /`captureNotifyStatus` VARCHAR\(16\) NOT NULL DEFAULT 'SENT_PLAIN'/)
})

test('notification surfaces expose a note entry and a result entry', () => {
  assert.equal(CAPTURE_LETTER_ENTRY_LABEL, '查看留言')
  assert.equal(CAPTURE_RESULT_ENTRY_LABEL, '查看调查结果')
  assert.match(notifications, /captureLetterHref\(item\)/)
  assert.match(notifications, /CAPTURE_LETTER_ENTRY_LABEL/)
  assert.match(notifications, /captureResultHref\(item\)/)
  assert.match(notifications, /CAPTURE_RESULT_ENTRY_LABEL/)
  assert.match(toast, /captureHref \|\| letterHref/, '弹出层优先直达留言')
})

test('the note is only rendered for its owner, through a dedicated endpoint', () => {
  assert.match(captureLetterRoute, /readCaptureLetter\(guard\.user\.id, id\)/)
  assert.match(captureLetterRoute, /status: 404/, '其它情形统一 404')
  assert.match(captureLetter, /where: \{ recipientId: userId, hiddenAt: null, OR: \[\{ id \}, \{ roundId: id \}\] \}/)
  assert.match(client, /api<CaptureLetterData>\('capture-letter\/' \+ encodeURIComponent\(id\)\)/)
  assert.match(page, /captureLetter === '1' \? focus : undefined/)
})

// --------------------------------------------------------------- animation

test('the counter note reuses the exact shipped delivery animation', () => {
  // Same component, same CSS timeline, same skip button — one shared module.
  assert.match(client, /import \{ SendAnonymousLetter \} from '@\/components\/shun-master\/SendAnonymousLetter'/)
  assert.match(client, /<SendAnonymousLetter variant="capture" message=\{captureMessage\.trim\(\)\}/)
  assert.match(sender, /variant\?: 'take' \| 'capture'/)
  assert.match(sender, /export const ANIMATION_MS = 1500/)
  assert.match(sender, /export const HANDOFF_MS = ANIMATION_MS - 32/)
  assert.match(senderCss, /--clock: 1500ms/)
  assert.match(senderCss, /\.skip \{[\s\S]{0,400}?position: fixed/)
  // Only the accessible label differs between the two variants.
  assert.match(sender, /aria-label=\{variant === 'capture' \? '正在寄出留言' : '正在寄出匿名信'\}/)
  // The animation never calls the API and is mounted only after the server said OK.
  assert.doesNotMatch(sender, /fetch\(|@\/lib\/shun-master/)
  assert.match(client, /const outcome = await api<\{ status: string \}>\(`round\/\$\{round\.id\}\/capture-letter`/)
  assert.match(client, /if \(outcome\.status !== 'SENT_LETTER'\) throw new RequestError/)
  assert.match(client, /setCaptureStep\('animate'\)/)
})

test('the capture result follows the required wording and flows', () => {
  assert.match(client, /<strong>抓到你啦！<\/strong>/, '必须先显示抓捕成功')
  assert.match(client, /成功追回 \{caught\.recovered\} 挂号费/)
  assert.match(client, />给 TA 留句话</)
  assert.match(client, /不留言/)
  assert.match(client, /给被抓到的 EF 留句话/, '编辑界面标题')
  assert.match(client, /placeholder="抓到你啦！有什么想对 TA 说的？"/)
  assert.match(client, /留言已送达！✉️/)
  assert.match(client, /你的留言已经送给被抓到的 EF。/)
  assert.match(client, /再顺一手/)
  assert.match(client, /返回顺大师/)
  // 返回 only goes back to the settled result: it never re-submits a capture.
  assert.match(client, /onClick=\{\(\) => \{ setError\(''\); setCaptureStep\('result'\) \}\}>返回<\/button>/)
  // 关闭 counts as "no note" and the plain arrest notice is still delivered.
  assert.match(client, /function closeCaptureResult\(\)[\s\S]{0,700}?void sendCapturePlain\(\)/)
  // A permanent opt-out keeps the historical flow but offers no new take.
  assert.match(client, /status\?\.optedOut \? '已退出顺大师' : status\?\.remaining \? '再顺一手'/)
})

// ------------------------------------------------------------ bonus safety

test('the recovery bonus defaults to 5% and is bounded 0–100', () => {
  assert.equal(RECOVERY_BONUS_CHANCE_DEFAULT, 5)
  assert.equal(defaultShunConfig.bonusChance, 5)
  const base = { ...defaultShunConfig }
  assert.equal(shunConfigError({ ...base, bonusChance: 0 }), null)
  assert.equal(shunConfigError({ ...base, bonusChance: 100 }), null)
  assert.equal(shunConfigError({ ...base, bonusChance: 5 }), null)
  assert.ok(shunConfigError({ ...base, bonusChance: 101 }))
  assert.ok(shunConfigError({ ...base, bonusChance: -1 }))
  assert.ok(shunConfigError({ ...base, bonusChance: 5.5 }))
  // A configuration saved before V5 keeps the published default, not 0%.
  const legacy = { ...base } as Record<string, unknown>
  delete legacy.bonusChance
  assert.equal(validateShunConfig(legacy)?.bonusChance, 5)
  // Hidden from players: the status projection never carries it.
  assert.doesNotMatch(service.slice(service.indexOf('export async function shunStatus'),
    service.indexOf('export async function shunStatus') + 1200), /bonusChance/)
})

test('the bonus is decided once per successful capture, inside the settlement', () => {
  const capture = service.slice(service.indexOf('export function shunCapture'), service.indexOf('function notifyCapture'))
  // Only the successful branch rolls, and only when the chance is above 0.
  assert.match(capture, /if \(correct\) \{\s*const won = config\.bonusChance > 0 && randomInt\(100\) < config\.bonusChance/)
  // The guarded update is the idempotency gate: a replay can never re-roll.
  assert.match(capture, /await tx\.shunMasterRound\.updateMany\(\{\s*where: \{ id, bonusRolled: false \}/)
  assert.match(capture, /if \(claimed\.count === 1 && won\)/)
  // Amount is the amount actually recovered, and the ledger leg is separate.
  assert.match(capture, /await ledger\(tx, id, userId, receiver \+ debit \+ compensation, round\.amount, 'bonus'\)/)
  // The caught player is never debited again and no other wallet is touched.
  assert.doesNotMatch(capture, /ledger\(tx, id, round\.actorId, [^)]*'bonus'/)
  // An audit trail is written for every granted bonus.
  assert.match(capture, /action: 'RECOVERY_BONUS'/)
})

test('the bonus has its own ledger action, business key and display label', () => {
  assert.match(service, /const action = kind === 'take' \? 'SHUN_STEAL' : kind === 'recover' \? 'SHUN_RECOVERY'\s*\n?\s*: kind === 'bonus' \? 'SHUN_BONUS' : 'SHUN_COMPENSATION'/)
  assert.match(service, /businessKey: `shun:\$\{id\}:\$\{kind\}:\$\{userId\}`/)
  assert.match(migration, /ALTER TABLE `PointLog` MODIFY `action` ENUM\([^)]*'SHUN_BONUS'\)/)
  const registrationFee = read('lib/registration-fee.ts')
  assert.match(registrationFee, /SHUN_BONUS: '顺大师 · 额外奖励'/)
  assert.match(registrationFee, /record\.action === 'SHUN_BONUS' && kind === 'bonus' && record\.points > 0/)
  // Distinct persisted bookkeeping columns.
  assert.match(migration, /ADD COLUMN `bonusRolled` BOOLEAN NOT NULL DEFAULT false/)
  assert.match(migration, /ADD COLUMN `bonusAwarded` INTEGER NOT NULL DEFAULT 0/)
})

test('the bonus is configurable and audited in the admin surface', () => {
  assert.match(adminUi, /追回额外奖励概率（%）/)
  assert.match(adminUi, /type="number" min=\{0\} max=\{100\}/)
  assert.match(adminUi, /value=\{config\.bonusChance\}/)
  assert.match(adminUi, /成功追回次数 \{data\.bonusStats\.recoveredCount\}/)
  assert.match(adminUi, /额外奖励触发次数 \{data\.bonusStats\.bonusCount\}/)
  assert.match(adminUi, /实际奖励触发率 \{data\.bonusStats\.bonusRate\}%/)
  assert.match(adminUi, /累计额外奖励挂号费 \{data\.bonusStats\.bonusTotal\}/)
  assert.match(adminUi, /累计原额追回挂号费 \{data\.bonusStats\.recoveredTotal\}/)
  assert.match(adminApi, /where: \{ result: 'SUCCESS' \}/)
  assert.match(adminApi, /where: \{ bonusAwarded: \{ gt: 0 \} \}/)
  // The save path re-validates with the shared rule, so the range cannot be bypassed.
  assert.match(adminApi, /const config = validateShunConfig\(draft\)/)
})

// ---------------------------------------------------------------- badges

test('the three cumulative rules ship with 727 and stay independent', () => {
  assert.equal(SHUN_BADGE_RULE_DEFAULT_THRESHOLD, 727)
  assert.deepEqual([...SHUN_BADGE_RULE_TYPES], ['SHUN_STOLEN_TOTAL', 'SHUN_VICTIM_TOTAL', 'SHUN_RECOVERED_TOTAL'])
  for (const ruleType of SHUN_BADGE_RULE_TYPES) {
    const entry = BADGE_RULE_REGISTRY[ruleType]
    assert.equal(entry.defaultThreshold, 727, `${ruleType} 默认门槛必须是 727`)
    // 1–1,000,000 per the published range, not the generic billion-wide one.
    assert.deepEqual({ min: entry.threshold?.min, max: entry.threshold?.max }, { min: 1, max: 1_000_000 })
    assert.equal(entry.metricLoader, ruleType)
    assert.deepEqual([...entry.events], ['SHUN_MASTER_SETTLED'])
    assert.equal(entry.supportsHistoricalBackfill, true, '历史累计必须支持补发')
    assert.equal(entry.group, '挂号')
  }
  assert.ok(BADGE_EVALUATION_EVENTS.includes('SHUN_MASTER_SETTLED'))
  // Each badge binds its own rule row, so no shared config can couple them.
  assert.match(schema, /model BadgeRule \{[\s\S]{0,600}?badgeId\s+String\s+@unique/)
  assert.match(schema, /model BadgeRule \{[\s\S]{0,600}?ruleType\s+BadgeRuleType/)
})

test('cumulative metrics read the authoritative rounds and exclude the bonus', () => {
  const metrics = read('lib/badge-metrics.ts')
  assert.match(metrics, /SHUN_STOLEN_TOTAL: async \(userId\) => safeMetric\(\(await prisma\.shunMasterRound\.aggregate\(\{\s*where: \{ actorId: userId \}, _sum: \{ amount: true \}/)
  assert.match(metrics, /SHUN_VICTIM_TOTAL: async \(userId\) => safeMetric\(\(await prisma\.shunMasterRound\.aggregate\(\{\s*where: \{ victimId: userId \}, _sum: \{ amount: true \}/)
  assert.match(metrics, /SHUN_RECOVERED_TOTAL: async \(userId\) => safeMetric\(\(await prisma\.shunMasterRound\.aggregate\(\{\s*where: \{ victimId: userId, result: 'SUCCESS' \}, _sum: \{ recovered: true \}/)
  // The bonus column is never summed into the badge metric.
  assert.doesNotMatch(metrics, /_sum: \{ bonusAwarded: true \}/)
})

test('settlements refresh badges for both sides after commit', () => {
  assert.match(service, /import \{ triggerBadgeEvaluation \} from '\.\/badge-rule-engine'/)
  assert.match(service, /for \(const account of \[actorId, victimId\]\) \{\s*if \(account\) void triggerBadgeEvaluation\(account, 'SHUN_MASTER_SETTLED'\)/)
  assert.match(service, /for \(const account of \[userId, actorId\]\) \{\s*if \(account\) void triggerBadgeEvaluation\(account, 'SHUN_MASTER_SETTLED'\)/)
  // Best effort only: a badge failure must never fail a settled transfer.
  assert.match(service, /triggerBadgeEvaluation\(account, 'SHUN_MASTER_SETTLED'\)\.catch\(\(\) => false\)/)
})

test('the badge admin prefills the published 727 default', () => {
  const badgeAdmin = read('app/admin/badges/BadgeAdminManager.tsx')
  assert.match(badgeAdmin, /defaultThreshold \?\? current\.threshold/)
})

// ------------------------------------------------------- migration hygiene

test('the V5 migration is additive and keeps historical rows untouched', () => {
  assert.doesNotMatch(migration, /DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|UPDATE `/i)
  assert.match(migration, /CREATE TABLE `ShunMasterCaptureLetter`/)
  assert.match(migration, /UNIQUE INDEX `ShunMasterCaptureLetter_roundId_key`/)
  assert.match(migration, /ALTER TABLE `BadgeRule` MODIFY `ruleType` ENUM\([^)]*'SHUN_STOLEN_TOTAL', 'SHUN_VICTIM_TOTAL', 'SHUN_RECOVERED_TOTAL'\)/)
  assert.match(migration, /CREATE INDEX `ShunMasterRound_captureNotifyStatus_captureNotifyDueAt_idx`/)
  // Historical rounds were already notified inline, so no backfill statement.
  assert.match(migration, /`captureNotifyStatus` VARCHAR\(16\) NOT NULL DEFAULT 'SENT_PLAIN'/)
})

test('permanent opt-out keeps history and blocks only new participation', () => {
  // The cumulative metrics are derived from rounds, so opting out never clears them.
  assert.doesNotMatch(service, /permanentlyOptedOutAt[\s\S]{0,80}?(deleteMany|updateMany)\(\{ where: \{ (actorId|victimId)/)
  // A settled capture keeps working even for an opted-out capturer.
  assert.doesNotMatch(service, /shunCaptureNotifyRound[\s\S]{0,600}?permanentlyOptedOutAt/, '抓捕留言不得因退出被阻断')
  // Only new takes are gated by the opt-out flag.
  assert.match(service, /if \(optedOut\) throw new ShunError\('OPTED_OUT'/)
})
