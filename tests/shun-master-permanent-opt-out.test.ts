import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

/**
 * Permanent opt-out contracts: default participation, a server-side durable
 * gate in every target/decoy pool, an idempotent irreversible service call,
 * and a client entry that only lives at the very bottom of the rules block.
 */
const read = (path: string) => readFileSync(path, 'utf8')
const service = read('lib/shun-master.ts')
const route = read('app/api/shun-master/[action]/route.ts')
const client = read('app/shun-master/ShunMasterClient.tsx')
const schema = read('prisma/schema.prisma')
const migration = read('prisma/migrations/20261125100000_add_shun_master_permanent_opt_out/migration.sql')

test('schema persists a nullable opt-out timestamp with an additive migration', () => {
  assert.match(schema, /permanentlyOptedOutAt\s+DateTime\?/, '默认 null = 所有用户默认参与')
  assert.match(migration, /ADD COLUMN `permanentlyOptedOutAt` DATETIME\(3\) NULL/, '只能是增量加列')
  assert.doesNotMatch(migration, /DROP|DELETE|TRUNCATE|UPDATE/, '迁移不得清空或改写历史数据')
})

test('every authoritative eligibility gate excludes opted-out users', () => {
  // candidateAccount is shared by the whole target pool, the friend-first pool
  // and every decoy pool (candidateFilter embeds it).
  assert.match(service, /u\.permanentlyOptedOutAt IS NULL/, '候选账户 SQL 必须排除已退出用户')
  assert.match(service, /stillParticipating = \{ permanentlyOptedOutAt: null \}/, '事务复验必须包含退出状态')
  assert.match(service, /const transactionAccount = \{ \.\.\.eligible, \.\.\.stillParticipating/, 'transactionAccount 必须带上退出过滤')
  // The actor is rejected before any settlement even if the UI is bypassed.
  assert.match(service, /permanentlyOptedOutAt: \{ not: null \}/, '服务端必须主动拦截已退出的发起者')
  assert.match(service, /new ShunError\('OPTED_OUT'/, '已退出发起者必须收到明确错误')
})

test('opt-out is idempotent, irreversible and audited', () => {
  const fn = service.slice(service.indexOf('export async function shunPermanentOptOut'))
  assert.match(fn, /where: \{ id: userId, permanentlyOptedOutAt: null \}/, '重复退出只能命中一次')
  assert.match(fn, /updateMany/, '必须用带条件的 updateMany 保证幂等')
  assert.match(fn, /action: 'PERMANENT_OPT_OUT'/, '退出必须写审计日志')
  assert.doesNotMatch(fn, /permanentlyOptedOutAt: null \}\)\s*$/, '不得存在任何把字段写回 null 的路径')
  assert.doesNotMatch(service, /data:\s*\{[^}]*permanentlyOptedOutAt:\s*null/, '不得存在任何把退出状态写回 null 的恢复路径')
  assert.match(route, /action !== 'attempt' && action !== 'opt-out'/, '接口白名单只有顺取与退出，没有重新加入')
})

test('status exposes optedOut and a dedicated opt-out API exists', () => {
  assert.match(service, /const optedOut = account\.permanentlyOptedOutAt !== null/, 'status 必须返回退出状态')
  assert.match(service, /return \{ enabled: config\.enabled, optedOut,/, 'status 载荷必须含 optedOut')
  assert.match(route, /action !== 'attempt' && action !== 'opt-out'/, '必须提供独立 opt-out 动作')
  assert.match(route, /shunPermanentOptOut\(guard\.user\.id\)/, '退出必须走服务端持久化')
  assert.match(route, /if \(action === 'opt-out'\) return json\(await shunPermanentOptOut/, '退出请求无额外 body，不能携带身份')
})

test('the exit entry is hidden until the rules are expanded and sits at the bottom', () => {
  assert.match(client, /<details><summary>玩法说明<\/summary>/, '玩法说明必须使用默认折叠的 details')
  // V6 inserted the daily-window sentence before the exit block; the ordering
  // contract ("exit entry last, after every rules paragraph") is unchanged.
  assert.match(client,
    /<p>每日机会于北京时间 00:00 重置。<\/p>\s*\{openHours && <p>\{shunOpenHoursHelp\(openHours\)\}<\/p>\}\s*<div className=\{styles\.optOutArea\}>/,
    '退出区必须位于全部玩法说明文字之后')
  assert.match(client, /不想参与顺大师？/, '必须给出引导文案')
  assert.match(client, /你可以选择永久退出，退出后无法重新加入。/, '必须说明不可重新加入')
  assert.match(client, /className=\{styles\.optOutLink\}/, '退出按钮必须是低强调度文字按钮')
  assert.doesNotMatch(client, /optOutArea[\s\S]{0,400}<summary/, '退出入口不得出现在详情之外')
})

test('the double-confirmation dialog enforces the checkbox', () => {
  assert.match(client, /确定永久退出顺大师？/, '确认标题')
  assert.match(client, /退出后，你将无法再顺取其他 EF 的挂号费，也不会再被其他 EF 顺取。退出前的游戏记录和挂号费结算均会保留。/, '确认正文')
  assert.match(client, /此操作永久生效，确认后无法重新加入。/, '警告文案')
  assert.match(client, /我已了解，永久退出后无法重新加入。/, '必须勾选的确认框')
  assert.match(client, /disabled=\{!optOutAck \|\| busy === 'opt-out'\}/, '未勾选时确认按钮必须禁用')
  assert.match(client, /onClick=\{\(\) => \{ setOptOutOpen\(false\); setOptOutAck\(false\) \}\} disabled=\{busy === 'opt-out'\}>取消/, '取消不得改变状态')
  assert.match(client, /aria-modal="true" aria-labelledby="opt-out-title"/, '必须是模态弹窗')
  assert.match(client, /api<\{ optedOut: boolean \}>\('opt-out', undefined, 'POST'\)/,
    '退出必须用 POST，否则会命中 GET handler 返回 404')
})

test('after opting out the take button disappears and the entry becomes a notice', () => {
  assert.match(client, /status\.optedOut \? <p className=\{styles\.optedOut\}/, '退出后必须隐藏顺一手')
  assert.match(client, /你已永久退出顺大师/, '退出成功文案')
  assert.match(client, /今后你不会再被顺取挂号费，也无法继续顺取其他 EF。/, '退出后说明')
  assert.match(client, /你已永久退出顺大师，无法重新加入。/, '玩法说明内的退出入口改为不可重新加入提示')
  assert.doesNotMatch(client, /optOutDone[\s\S]{0,200}重新加入按钮/, '不得提供重新加入按钮')
})

test('default participation needs no opt-in surface', () => {
  assert.doesNotMatch(client, /报名|加入顺大师|立即参与/, '不应要求主动报名')
  assert.match(client, /const \[optOutAck, setOptOutAck\] = useState\(false\)/, '确认框默认不勾选')
  // V6 added the daily-window condition; participation is still gated only by
  // the remaining attempts plus that window (no opt-in, no other new gate).
  assert.match(client, /disabled=\{!!busy \|\| !status\.remaining \|\| !openNow\}/, '参与按钮仍按原规则启用')
})
