import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

/**
 * Source-level contracts for the two-stage target lottery (free probabilities,
 * free activity weights, friend-first pool) and for the hidden nature of the
 * friend mechanic. Behaviour is exercised for real by
 * `tests/shun-master-rules.test.ts` (seeded simulation) and
 * `tests/shun-master-mysql.test.ts` (isolated MySQL).
 */

const read = (path: string) => readFileSync(path, 'utf8')
const service = read('lib/shun-master.ts')
const rules = read('lib/shun-config.ts')
const runtimeRules = read('lib/shun-master-rules.ts')
const adminApi = read('app/api/admin/shun-master/route.ts')
const adminUi = read('app/admin/shun-master/ShunMasterAdmin.tsx')
const playerApi = read('app/api/shun-master/[action]/route.ts')
const playerClient = read('app/shun-master/ShunMasterClient.tsx')
const schema = read('prisma/schema.prisma')
const migration = read('prisma/migrations/20261124213000_add_shun_master_match_source/migration.sql')

const attemptBody = (() => {
  const start = service.indexOf('export async function shunAttempt')
  assert.ok(start > 0)
  return service.slice(start, service.indexOf('export async function shunRecords'))
})()

// ------------------------------------------------------------- configuration

test('amount probabilities are validated by range and total only, never by order', () => {
  assert.match(rules, /c\.probabilities\.reduce\(\(sum: number, n\) => sum \+ \(n as number\), 0\) !== 100/)
  assert.match(rules, /!c\.probabilities\.some\(\(n\) => \(n as number\) > 0\)/, '至少一档必须大于 0%')
  assert.match(rules, /bounded\(n, 0, 100\)/, '单档允许 0%，上限 100%')
  assert.doesNotMatch(rules, /严格递减/, '必须删除「金额概率必须严格递减」的提示')
  assert.doesNotMatch(rules, /values\[i - 1\]/, '金额档位不得再与相邻档比较')
})

test('activity weights are five independent integers with no ordering rule', () => {
  assert.match(rules, /ACTIVITY_WEIGHT_RANGE = \{ min: 1, max: 300 \}/)
  assert.match(rules, /bounded\(n, ACTIVITY_WEIGHT_RANGE\.min, ACTIVITY_WEIGHT_RANGE\.max\)/)
  assert.match(rules, /c\.weights\.length !== SHUN_ACTIVITY_TIERS/)
  assert.doesNotMatch(rules, /<= \(values\[i - 1\]/, '权重不得要求不递增')
  assert.doesNotMatch(rules, />= \(values\[i - 1\]/, '权重不得要求不递减')
})

test('the friend chance is a 0-100 integer with a 20 default and legacy tolerance', () => {
  assert.match(rules, /FRIEND_CHANCE_DEFAULT = 20/)
  assert.match(rules, /friendChance: FRIEND_CHANCE_DEFAULT,/)
  assert.match(rules, /c\.friendChance !== undefined && !bounded\(c\.friendChance, 0, 100\)/)
  assert.match(rules, /friendChance: typeof c\.friendChance === 'number' \? c\.friendChance : FRIEND_CHANCE_DEFAULT/,
    '旧配置没有好友概率时必须能读取而不是报错')
})

test('the server service, the admin API and the admin form share one validator', () => {
  assert.match(adminApi, /import \{ defaultShunConfig, shunConfigError, shunDay, validateShunConfig \} from '@\/lib\/shun-master-rules'/)
  assert.match(adminApi, /if \(!config\) return json\(\{ message: shunConfigError\(draft\) \?\? '配置无效。' \}, 400\)/)
  assert.match(adminUi, /import \{ ACTIVITY_TIER_LABELS, shunConfigError, type ShunConfig \} from '@\/lib\/shun-config'/,
    '前端必须复用同一校验函数（纯模块，不引入 node:crypto）')
  assert.match(adminUi, /const invalid = shunConfigError\(config\)[\s\S]{0,80}if \(invalid\) \{ setMessage\(invalid\); return \}/,
    '前端必须先按同一规则校验再提交')
  assert.doesNotMatch(rules, /from 'node:crypto'/, '校验模块必须保持纯函数，前后端共用')
  assert.match(runtimeRules, /from 'node:crypto'/, '只有运行时模块持有随机数')
})

test('rule changes bump the rules version, including weights and the friend chance', () => {
  assert.match(rules, /previous\.friendChance !== next\.friendChance/)
  assert.match(rules, /previous\.weights\.some\(\(value, i\) => value !== next\.weights\[i\]\)/)
})

// ------------------------------------------------------- two-stage lottery

test('the lottery uses the whole eligible population instead of a 128-row sample', () => {
  assert.match(service, /async function loadTargetPopulation\(rangeStart: Date, day: string, now: Date\): Promise<TargetCandidate\[\]>/)
  assert.match(service, /SELECT u\.id, u\.uid, u\.lastActiveAt, u\.lastLoginAt FROM User u\s*\n\s*WHERE \$\{candidateAccount\} AND \$\{hasSpendableBalance\}/,
    '必须读取完整合格候选池，否则人数仍会主导命中率')
  assert.doesNotMatch(service, /LIMIT 128/, '不得再用 128 行采样')
  assert.doesNotMatch(service, /slots/, '不得再用 UID 抽样引入额外偏差')
  assert.match(service, /tier: activityTier\(days\.size\)/, '活跃度判定沿用原有映射')
  // The snapshot must be read before the settlement transaction, otherwise the
  // serialised section times out under concurrent clicks.
  assert.match(service, /const \[population, friendIds\] = await Promise\.all\(\[\s*loadTargetPopulation\(rangeStart, day, now\),\s*loadFriendIds\(actorId\),\s*\]\)/)
  assert.match(attemptBody, /const eligibleTargets = population\.filter\(\(target\) => !targetExclusions\.has\(target\.id\)\)/,
    '事务内只做按发起者的排除过滤')
  assert.doesNotMatch(attemptBody, /\$queryRaw<Target\[\]>/, '事务内不得再做全量候选扫描')
})

test('the draw is: pick a non-empty tier by weight, then one user inside it', () => {
  assert.match(rules, /export function pickStratified<T extends StratifiedCandidate>/)
  assert.match(rules, /const buckets = new Map<number, T\[\]>\(\)/)
  assert.match(rules, /const chosen = weightedIndex\(tiers\.map\(\(tier\) => weights\[tier\] \?\? 0\), draw\)/)
  assert.match(rules, /return bucket\[draw\(bucket\.length\)\]/, '群体内部必须均匀抽取')
  assert.match(attemptBody, /pickStratified\(friendPoolUsed \? friendPool : eligibleTargets, config\.weights, randomInt\)/)
})

test('the friend pool is a subset of the already eligible targets, never a bypass', () => {
  assert.match(attemptBody, /const friendPool = config\.friendChance > 0 && friendIds\.size\s*\n?\s*\? eligibleTargets\.filter\(\(target\) => friendIds\.has\(target\.id\)\)/,
    '好友池必须来自已通过全部资格规则的候选')
  assert.match(attemptBody, /const friendPoolUsed = !targeted && friendPool\.length > 0 && friendPoolDraw\(config\.friendChance, randomInt\)/)
  assert.match(attemptBody, /if \(!victim\)/, '抽不到任何目标时必须走原有失败/回退路径')
  // No eligibility predicate is relaxed for friends: the pool query is shared.
  const friendBlock = attemptBody.slice(attemptBody.indexOf('const friendPool ='), attemptBody.indexOf('const victim ='))
  assert.doesNotMatch(friendBlock, /points: \{ gt/, '好友模式不得单独放宽余额条件')
  assert.doesNotMatch(friendBlock, /candidateFilter|hasSpendableBalance/, '资格过滤必须只有一处定义')
})

test('a friendship is the undirected Friendship row and nothing weaker', () => {
  assert.match(service, /where: \{ OR: \[\{ userAId: actorId \}, \{ userBId: actorId \}\] \}/,
    '好友关系必须双向查询')
  assert.match(service, /link\.userAId === actorId \? link\.userBId : link\.userAId/)
  assert.doesNotMatch(service, /friendRequest|follow\.findMany/, '仅关注或待处理申请不得算作好友')
})

test('the match source is recorded for admin statistics only', () => {
  assert.match(attemptBody, /friendHit: friendPoolUsed, victimTier: victim\.tier/)
  assert.match(schema, /friendHit Boolean @default\(false\)/)
  assert.match(schema, /victimTier Int\?/)
  assert.match(migration, /ADD COLUMN `friendHit` BOOLEAN NOT NULL DEFAULT false/)
  assert.match(migration, /ADD COLUMN `victimTier` INTEGER NULL/)
  assert.doesNotMatch(migration, /\b(DROP|RENAME|TRUNCATE|DELETE|UPDATE)\b/i, '迁移必须是纯增量')
})

test('the player-facing record projection never carries the match source', () => {
  const presentBody = service.slice(service.indexOf('async function present'), service.indexOf('export async function shunStatus'))
  assert.doesNotMatch(presentBody, /friendHit|victimTier/, '记录投影不得包含好友命中或活跃度档位')
  assert.doesNotMatch(playerApi, /friendChance|friendHit|victimTier|weights|probabilities/,
    '玩家接口不得暴露好友概率、目标池来源或权重')
  assert.doesNotMatch(playerClient, /friendChance|friendHit|victimTier|好友池/, '前台不得展示隐藏机制')
  assert.doesNotMatch(adminApi.match(/return json\(\{ config, effectiveEnabled[\s\S]*?\}\)/)![0], /friendChance[\s\S]{0,40}player/,
    '仅后台可见')
})

test('the admin surface exposes the friend chance and the read-only statistics', () => {
  assert.match(adminUi, /好友命中概率/)
  assert.match(adminUi, /value=\{config\.friendChance\}/)
  assert.match(adminUi, /好友池命中 \{data\.matchStats\.friendHits\} 笔 \/ 全部 \{data\.matchStats\.total\} 笔/)
  assert.match(adminUi, /data\.matchStats\.tiers\.map/)
  assert.match(adminApi, /groupBy\(\{ by: \['friendHit', 'victimTier'\], where: \{ day \}, _count: \{ _all: true \} \}\)/)
  assert.match(adminApi, /friendRate: totalTransfers \? Math\.round\(friendHits \/ totalTransfers \* 1000\) \/ 10 : 0/)
})

test('the existing game rules are untouched by the new lottery', () => {
  assert.match(service, /const rolled = weightedIndex\(config\.probabilities\) \+ 1/, '金额仍按七档概率抽取')
  assert.match(service, /const amount = effect === 'DOUBLE_AMOUNT' \? Math\.min\(rolled \* 2, 14, victimBalance\) : Math\.min\(rolled, victimBalance\)/, '金额上限仍受账户余额约束')
  assert.match(service, /if \(played\.length >= config\.attempts \+ \(itemDaily\?\.extraAttemptsGranted \?\? 0\)\) \{\s*throw new ShunError\('LIMIT'/, '每日次数不变')
  assert.match(service, /hitsByUser\]\.filter\(\(\[, count\]\) => count >= config\.victimCap\)/, '每日被顺上限不变')
  assert.match(service, /goldenUntil: new Date\(now\.getTime\(\) \+ config\.goldenMinutes \* 60000\)/, '黄金抓捕期不变')
  assert.match(service, /const compensation = correct \? round\.amount - debit : 0/, '补偿规则不变')
})
