import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test, { after } from 'node:test'
import { prisma } from '../lib/prisma'
import { getShunCandidateSummary, setShunEnabled, shunAttempt, shunCapture, shunRecords, shunStatus, updateShunConfig } from '../lib/shun-master'
import { readAnonymousLetter } from '../lib/shun-anonymous-letter'
import { activityTier, defaultShunConfig, shunDay } from '../lib/shun-master-rules'

/**
 * Isolated-MySQL acceptance for the rules added on top of the anonymous letter
 * work: the two-stage stratified victim draw, the hidden friend-first pool and
 * the settled-letter identity reveal. Free-form probability / weight validation
 * is covered by `shun-master-rules.test.ts` and `shun-master-match-source.test.ts`.
 *
 * It runs against its own empty fixture database so it can never share state
 * with `shun-master-mysql.test.ts`, and it is skipped unless
 * `SHUN_MATCH_MYSQL_QA=1` is set explicitly.
 */

const qa = process.env.SHUN_MATCH_MYSQL_QA === '1'
const DAY = 86_400_000

const baseConfig = {
  ...defaultShunConfig,
  attempts: 7,
  victimCap: 20,
  goldenMinutes: 10,
  weights: [100, 100, 100, 100, 100],
  friendChance: 0,
}

function assertIsolatedFixture() {
  const url = new URL(process.env.DATABASE_URL || '')
  assert.equal(url.protocol, 'mysql:')
  assert.equal(url.hostname, '127.0.0.1')
  assert.equal(url.port, process.env.GITHUB_ACTIONS === 'true' ? '3306' : '33326')
  assert.equal(url.pathname, '/ecfc_shun_match_qa')
}

let operatorId = ''

function createUser(points = 0) {
  const name = 'shun-match-' + randomUUID()
  return prisma.user.create({ data: {
    username: name, usernameNormalized: name, nickname: name,
    email: `${name}@example.invalid`, emailVerifiedAt: new Date(), points, passwordHash: 'fixture',
    Profile: { create: { displayName: name } },
  } })
}

/** Bulk fixture rows; keeps the pool of a 17-connection client happy. */
async function bulkUsers(count: number, points = 0) {
  const ids = Array.from({ length: count }, () => 'shun-match-' + randomUUID())
  await prisma.user.createMany({ data: ids.map((id) => ({
    id, username: id, usernameNormalized: id, nickname: id, passwordHash: 'fixture', points,
  })) })
  await prisma.profile.createMany({ data: ids.map((id) => ({ userId: id, displayName: id })) })
  return ids
}

async function publish(overrides: Partial<typeof baseConfig> = {}) {
  await updateShunConfig(operatorId, { ...baseConfig, ...overrides })
  await setShunEnabled(operatorId, true)
}

async function ensureSettings() {
  await prisma.shunMasterSettings.upsert({
    where: { id: 1 }, update: {}, create: { id: 1, config: { ...defaultShunConfig } },
  })
  const operator = await createUser(0)
  operatorId = operator.id
  await publish()
}

/** A real, accepted friendship stored with the same ordering the app uses. */
function befriend(left: string, right: string) {
  const [userAId, userBId] = [left, right].sort()
  return prisma.friendship.create({ data: { userAId, userBId } })
}

const protect = (...userIds: string[]) => prisma.shunMasterProtection.createMany({
  data: userIds.map((userId) => ({ userId, protected: true })), skipDuplicates: true,
})

/**
 * Pins the target population to exactly `keep`.
 *
 * Winning a take credits the winner, so every actor silently turns into a funded
 * target itself. Each deterministic or statistical assertion therefore freezes
 * the population first, otherwise the fixture would drift under the test.
 */
async function pinFundedTo(...keep: string[]) {
  const funded = await prisma.user.findMany({ where: { points: { gt: 0 }, id: { notIn: keep } }, select: { id: true } })
  if (funded.length) await protect(...funded.map(({ id }) => id))
}

/** One check-in day, `offsetDays` in the past, inside the 7-day activity window. */
function checkinDay(userId: string, offsetDays: number) {
  const date = new Date(Date.now() - offsetDays * DAY)
  return { userId, checkDate: date, checkinDateKey: shunDay(date), points: 0 }
}

/** Days of activity needed to land in one activity tier (see `activityTier`). */
const tierDays = [1, 2, 4, 5, 7]

function roundsOf(actorId: string) {
  return prisma.shunMasterRound.findMany({ where: { actorId }, orderBy: { createdAt: 'asc' } })
}

/** A victim must always be a real, still-eligible target — never a shortcut. */
async function assertEligibleVictim(victimId: string, actorId: string) {
  assert.notEqual(victimId, actorId, '不得顺取自己')
  const victim = await prisma.user.findUniqueOrThrow({
    where: { id: victimId }, select: { points: true, status: true, isDeleted: true, Profile: { select: { id: true } } },
  })
  assert.ok(victim.points > 0, '不得顺取没有余额的用户')
  assert.equal(victim.status, 'ACTIVE')
  assert.equal(victim.isDeleted, false)
  assert.ok(victim.Profile, '不得顺取没有资料的账号')
  assert.equal(await prisma.shunMasterProtection.count({ where: { userId: victimId, protected: true } }), 0,
    '不得顺取已拒绝扣费的用户')
}

after(async () => { await prisma.$disconnect() })

test('friend-first pool honours the chance, the real friendship relation and every existing rule', {
  skip: !qa, timeout: 300000,
}, async () => {
  assertIsolatedFixture()
  assert.equal(await prisma.shunMasterRound.count(), 0, 'requires an empty isolated fixture')
  await ensureSettings()
  // Three permanent, always-eligible decoy accounts: the golden-period candidate
  // list needs two of them, and every population pin must leave them alone.
  await Promise.all([createUser(), createUser(), createUser()])

  // --- 0%: the friend pool is never entered, yet the full pool still holds friends.
  await publish({ friendChance: 0 })
  const zeroActor = await createUser()
  const zeroFriends = await Promise.all([createUser(60), createUser(60), createUser(60)])
  for (const friend of zeroFriends) await befriend(zeroActor.id, friend.id)
  await pinFundedTo(...zeroFriends.map((friend) => friend.id))
  const zeroResults = await Promise.all(Array.from({ length: 3 }, () => shunAttempt(zeroActor.id, randomUUID())))
  assert.ok(zeroResults.every((round) => !('friendHit' in round) && !('victimTier' in round)),
    '玩家视图不得携带匹配来源字段')
  const zeroRounds = await roundsOf(zeroActor.id)
  assert.equal(zeroRounds.length, 3)
  assert.ok(zeroRounds.every((round) => round.friendHit === false), '0% 好友概率不得触发好友池')
  assert.deepEqual(new Set(zeroRounds.map((round) => round.victimId)), new Set(zeroFriends.map((friend) => friend.id)),
    '好友概率为 0 时仍可从全站池命中好友')

  // --- 100%: the friend pool is always used when it holds an eligible friend.
  await publish({ friendChance: 100 })
  const loyalActor = await createUser()
  const loyalFriends = await Promise.all([createUser(80), createUser(80)])
  for (const friend of loyalFriends) await befriend(loyalActor.id, friend.id)
  await pinFundedTo(...loyalFriends.map((friend) => friend.id))
  const loyalRounds = await Promise.all([shunAttempt(loyalActor.id, randomUUID()), shunAttempt(loyalActor.id, randomUUID())])
  const storedLoyal = await prisma.shunMasterRound.findMany({ where: { id: { in: loyalRounds.map((round) => round.id) } } })
  assert.equal(storedLoyal.length, 2)
  assert.ok(storedLoyal.every((round) => round.friendHit === true), '100% 好友概率必须命中好友池')
  assert.ok(storedLoyal.every((round) => loyalFriends.some((friend) => friend.id === round.victimId)),
    '好友池命中时目标必须是好友')
  for (const round of storedLoyal) await assertEligibleVictim(round.victimId, loyalActor.id)

  // --- An account without friends silently falls back to the whole pool.
  const lonelyActor = await createUser()
  const lonelyTarget = await createUser(70)
  await pinFundedTo(lonelyTarget.id)
  const lonelyRound = await shunAttempt(lonelyActor.id, randomUUID())
  const storedLonely = await prisma.shunMasterRound.findUniqueOrThrow({ where: { id: lonelyRound.id } })
  assert.equal(storedLonely.friendHit, false, '没有合格好友时必须回退到全站池')
  assert.equal(storedLonely.victimId, lonelyTarget.id, '回退到全站池时仍能命中普通用户')

  // --- Only a real Friendship row counts: pending requests and follows never do.
  const relationActor = await createUser()
  const pending = await createUser(70)
  const follower = await createUser(70)
  const followed = await createUser(70)
  await prisma.friendRequest.create({ data: { senderId: relationActor.id, receiverId: pending.id } })
  await prisma.follow.create({ data: { followerId: relationActor.id, followingId: follower.id } })
  await prisma.friendFollow.create({ data: { followerId: relationActor.id, followedId: followed.id } })
  await pinFundedTo(pending.id, follower.id, followed.id)
  const relationRound = await shunAttempt(relationActor.id, randomUUID())
  const storedRelation = await prisma.shunMasterRound.findUniqueOrThrow({ where: { id: relationRound.id } })
  assert.equal(storedRelation.friendHit, false, '待处理申请与关注关系不得算作好友')
  assert.ok([pending.id, follower.id, followed.id].includes(storedRelation.victimId),
    '回退后的全站池仍应覆盖这些用户')
  await assertEligibleVictim(storedRelation.victimId, relationActor.id)

  // --- A friendship that was deleted stops counting immediately.
  const exFriend = await createUser(70)
  const exFriend2 = await createUser(70)
  const link = await befriend(relationActor.id, exFriend.id)
  await pinFundedTo(exFriend.id, exFriend2.id)
  const friendHitRound = await shunAttempt(relationActor.id, randomUUID())
  const storedFriendHit = await prisma.shunMasterRound.findUniqueOrThrow({ where: { id: friendHitRound.id } })
  assert.equal(storedFriendHit.friendHit, true, '正式好友关系必须进入好友池')
  assert.equal(storedFriendHit.victimId, exFriend.id, '好友池只剩这一位合格好友时目标必须是他')
  await prisma.friendship.delete({ where: { id: link.id } })
  await pinFundedTo(exFriend2.id)
  const afterDelete = await shunAttempt(relationActor.id, randomUUID())
  const storedAfterDelete = await prisma.shunMasterRound.findUniqueOrThrow({ where: { id: afterDelete.id } })
  assert.equal(storedAfterDelete.friendHit, false, '已删除的好友关系不得再进入好友池')
  assert.equal(storedAfterDelete.victimId, exFriend2.id, '删除好友后会回退到剩下的全站用户')

  // --- A friend still has to clear balance, cap, block and repeat rules.
  await publish({ friendChance: 100 })
  const strictActor = await createUser()
  const noBalance = await createUser(0)
  const capped = await createUser(90)
  const blocked = await createUser(90)
  const already = await createUser(90)
  const healthy = await createUser(90)
  for (const friend of [noBalance, capped, blocked, already, healthy]) await befriend(strictActor.id, friend.id)
  await prisma.block.create({ data: { blockerId: blocked.id, blockedId: strictActor.id } })
  const today = shunDay(new Date())
  const capActors = await bulkUsers(baseConfig.victimCap)
  await prisma.shunMasterRound.createMany({ data: capActors.map((actorId) => ({
    actorId, victimId: capped.id, requestId: randomUUID(), day: today,
    rolled: 1, amount: 1, candidates: [], goldenUntil: new Date(),
  })) })
  await prisma.shunMasterRound.create({ data: {
    actorId: strictActor.id, victimId: already.id, requestId: randomUUID(), day: today,
    rolled: 1, amount: 1, candidates: [], goldenUntil: new Date(),
  } })
  await pinFundedTo(capped.id, blocked.id, already.id, healthy.id)
  const strictRound = await shunAttempt(strictActor.id, randomUUID())
  const storedStrict = await prisma.shunMasterRound.findUniqueOrThrow({ where: { id: strictRound.id } })
  assert.equal(storedStrict.friendHit, true)
  assert.equal(storedStrict.victimId, healthy.id, '好友池只剩一位合格好友时不得抽到不合格好友')
  const everyStrictRound = await roundsOf(strictActor.id)
  for (const ineligible of [noBalance, capped, blocked]) {
    assert.ok(everyStrictRound.every((round) => round.victimId !== ineligible.id),
      '余额为 0、已达上限、已互相拉黑的好友都不得被抽中')
  }
  await assertEligibleVictim(storedStrict.victimId, strictActor.id)

  // --- The recorded activity tier is the tier the lottery actually used.
  const tierTarget = await createUser(90)
  await prisma.checkIn.createMany({ data: Array.from({ length: 4 }, (_, index) => checkinDay(tierTarget.id, index)) })
  const tierActor = await createUser()
  await befriend(tierActor.id, tierTarget.id)
  await pinFundedTo(tierTarget.id)
  const tierRound = await shunAttempt(tierActor.id, randomUUID())
  const storedTier = await prisma.shunMasterRound.findUniqueOrThrow({ where: { id: tierRound.id } })
  assert.equal(storedTier.friendHit, true)
  assert.equal(storedTier.victimId, tierTarget.id)
  assert.equal(storedTier.victimTier, activityTier(4), '记录的活跃度档位必须与抽签使用的档位一致')
  assert.equal(storedTier.victimTier, 2)
})

test('two-stage stratified draw ignores population size differences', {
  skip: !qa, timeout: 600000,
}, async () => {
  assertIsolatedFixture()
  await ensureSettings()
  // Five non-empty tiers whose base sizes differ by 10x; equal weights.
  await publish({ friendChance: 0, weights: [100, 100, 100, 100, 100] })
  const sizes = [3, 6, 9, 12, 30]
  const targets: Array<{ id: string; tier: number }> = []
  for (const [tier, size] of sizes.entries()) {
    const ids = await bulkUsers(size, 100)
    await prisma.checkIn.createMany({ data: ids.flatMap((id) =>
      Array.from({ length: tierDays[tier] }, (_, index) => checkinDay(id, index))) })
    targets.push(...ids.map((id) => ({ id, tier })))
  }
  assert.equal(targets.length, sizes.reduce((sum, size) => sum + size, 0))
  const population = new Map(targets.map((target) => [target.id, target.tier]))
  await pinFundedTo(...targets.map((target) => target.id))

  const samples = 200
  const actors = await bulkUsers(samples, 0)
  for (const actorId of actors) {
    assert.ok((await shunAttempt(actorId, randomUUID())).id)
    // A winner is credited and would join the funded population itself.
    await protect(actorId)
  }
  const rounds = await prisma.shunMasterRound.findMany({ where: { actorId: { in: actors } } })
  assert.equal(rounds.length, samples, '每一次抽签都必须落一条记录')
  assert.ok(rounds.every((round) => round.friendHit === false), '好友概率为 0 时不得触发好友池')
  assert.ok(rounds.every((round) => population.has(round.victimId)), '不得抽到合格总体之外的用户')
  assert.ok(rounds.every((round) => round.victimTier === population.get(round.victimId)),
    '记录的档位必须与用户真实档位一致')

  const counts = [0, 0, 0, 0, 0]
  for (const round of rounds) counts[round.victimTier as number] += 1
  const shares = counts.map((count) => count / samples)
  // Equal weights over five non-empty tiers must land near 20% each, no matter
  // that the top tier holds ten times the people of the bottom one.
  for (const [tier, share] of shares.entries()) {
    assert.ok(share >= 0.12 && share <= 0.30,
      `等权重档位 ${tier} 的命中占比 ${(share * 100).toFixed(1)}% 偏离 20% 过多`)
  }
  // What head-count sampling would have produced, kept as an explicit contrast.
  const headcount = sizes.map((size) => size / targets.length)
  assert.ok(shares[0] > headcount[0] * 2, '小基数档位的命中率必须显著高于按人数抽样的占比')
  assert.ok(shares[4] < headcount[4] * 0.8, '大基数档位的命中率必须显著低于按人数抽样的占比')
  console.log('SHUN_MATCH_DIST', JSON.stringify({
    samples, sizes, counts,
    shares: shares.map((share) => Number(share.toFixed(3))),
    headcount: headcount.map((share) => Number(share.toFixed(3))),
  }))
})

test('player-facing surfaces never expose the match source', {
  skip: !qa, timeout: 120000,
}, async () => {
  assertIsolatedFixture()
  await ensureSettings()
  await publish({ friendChance: 100 })
  const actor = await createUser()
  const friend = await createUser(120)
  await befriend(actor.id, friend.id)
  await pinFundedTo(friend.id)
  const round = await shunAttempt(actor.id, randomUUID(), '不要泄露来源')
  const status = await shunStatus(actor.id)
  assert.deepEqual(Object.keys(status).sort(), ['attempts', 'balance', 'enabled', 'goldenMinutes', 'received',
    'remaining', 'serverNow', 'victimCap'])
  assert.equal(JSON.stringify(status).includes('friendChance'), false, '状态接口不得携带好友命中概率')
  const summary = await getShunCandidateSummary(prisma, shunDay(new Date()), baseConfig.victimCap)
  assert.deepEqual(Object.keys(summary).sort(), ['day', 'eligible', 'excluded'])
  assert.deepEqual(Object.keys(summary.excluded).sort(), ['account', 'balance', 'dailyCap', 'refused'])
  const outgoing = await shunRecords(actor.id, 'out')
  const incoming = await shunRecords(friend.id, 'in')
  for (const row of [...outgoing.records, ...incoming.records]) {
    assert.equal('friendHit' in row, false)
    assert.equal('victimTier' in row, false)
    assert.equal(JSON.stringify(row).includes('friendHit'), false)
    assert.equal(JSON.stringify(row).includes('victimTier'), false)
  }
  const letter = await readAnonymousLetter(friend.id, round.id)
  assert.ok(letter)
  assert.equal(JSON.stringify(letter).includes('friendHit'), false)
  assert.equal(JSON.stringify(letter).includes('victimTier'), false)
  const notifications = await prisma.notification.findMany({ where: { recipientId: friend.id } })
  assert.ok(notifications.length > 0)
  for (const notification of notifications) {
    assert.equal(notification.title.includes('好友'), false, '通知文案不得暴露好友机制')
    assert.equal((notification.content ?? '').includes('好友'), false, '通知文案不得暴露好友机制')
    assert.equal((notification.content ?? '').includes(String(friend.uid)), false)
  }
})

test('a settled letter reveals the real Shun actor, an open one never does', {
  skip: !qa, timeout: 300000,
}, async () => {
  assertIsolatedFixture()
  await ensureSettings()
  await publish({ friendChance: 0 })

  const victim = await createUser(60)
  const actor = await createUser()
  const stranger = await createUser()
  await pinFundedTo(victim.id)
  const sent = await shunAttempt(actor.id, randomUUID(), '  第一封真正的信  ')
  const sentRound = await prisma.shunMasterRound.findUniqueOrThrow({ where: { id: sent.id } })
  assert.equal(sentRound.victimId, victim.id)

  // Before settlement the payload carries nothing that could identify the sender.
  const open = await readAnonymousLetter(victim.id, sent.id)
  assert.ok(open)
  assert.equal(open.result, null, '未调查前不得揭晓身份')
  assert.equal(open.captured, false)
  assert.equal(open.capturable, true)
  assert.equal(open.content, '第一封真正的信')
  assert.equal(JSON.stringify(open).includes(actor.nickname), false, '未调查前不得泄露顺取者昵称')
  assert.equal(JSON.stringify(open).includes('"person"'), false, '未调查前不得携带身份投影')
  assert.equal(await readAnonymousLetter(stranger.id, sent.id), null, '非收件人必须读不到')
  assert.equal(await readAnonymousLetter(actor.id, sent.id), null, '发送者不得通过收件人接口回读')

  // Successful capture: identity plus the recovered amount are revealed in place.
  const options = await shunCapture(victim.id, sent.id)
  assert.equal(options.mode, 2)
  assert.ok(options.candidates?.some((candidate) => candidate.uid === actor.uid))
  const caught = await shunCapture(victim.id, sent.id, { mode: 2, uid: actor.uid })
  assert.equal(caught.record?.result, 'SUCCESS')
  const revealed = await readAnonymousLetter(victim.id, sent.id)
  assert.ok(revealed)
  assert.equal(revealed.captured, true)
  assert.equal(revealed.capturable, false)
  assert.equal(revealed.content, '第一封真正的信', '揭晓身份不得改写原始留言')
  assert.equal(revealed.result?.outcome, 'SUCCESS')
  assert.equal(revealed.result?.recovered, sentRound.amount)
  assert.equal(revealed.result?.amount, sentRound.amount)
  assert.equal(revealed.result?.person?.uid, actor.uid, '必须揭晓真实顺取者 UID')
  assert.equal(revealed.result?.person?.nickname, actor.nickname, '必须揭晓真实顺取者昵称')
  assert.deepEqual(await readAnonymousLetter(victim.id, sent.id), revealed, '关闭重开后必须与服务端一致')
  const recoveries = await prisma.pointLog.count({ where: { action: 'SHUN_RECOVERY' } })
  assert.equal((await shunCapture(victim.id, sent.id, { mode: 2, uid: actor.uid })).record?.result, 'SUCCESS')
  assert.equal(await prisma.pointLog.count({ where: { action: 'SHUN_RECOVERY' } }), recoveries, '重复抓捕不得重复结算')

  // Failed capture: the identity is revealed as well, with a zero recovery.
  const victim2 = await createUser(60)
  const actor2 = await createUser()
  await pinFundedTo(victim2.id)
  const sent2 = await shunAttempt(actor2.id, randomUUID(), '第二封真正的信')
  const options2 = await shunCapture(victim2.id, sent2.id)
  const decoy = options2.candidates?.find((candidate) => candidate.uid !== actor2.uid)
  assert.ok(decoy, '黄金期必须给出一个真实的干扰项')
  const missed = await shunCapture(victim2.id, sent2.id, { mode: 2, uid: decoy.uid })
  assert.equal(missed.record?.result, 'FAILED')
  const revealed2 = await readAnonymousLetter(victim2.id, sent2.id)
  assert.ok(revealed2)
  assert.equal(revealed2.result?.outcome, 'FAILED')
  assert.equal(revealed2.result?.recovered, 0)
  assert.equal(revealed2.result?.person?.uid, actor2.uid, '调查失败同样必须揭晓真实顺取者')
  assert.equal(revealed2.result?.person?.nickname, actor2.nickname)
  assert.equal(revealed2.content, '第二封真正的信')

  // A settled letter from an older round keeps revealing the same identity.
  await prisma.shunMasterRound.update({ where: { id: sent2.id },
    data: { createdAt: new Date(Date.now() - 20 * DAY), capturedAt: new Date(Date.now() - 20 * DAY) } })
  const historical = await readAnonymousLetter(victim2.id, sent2.id)
  assert.deepEqual(historical, revealed2, '历史信件必须仍然揭晓身份')
  const archive = await shunRecords(victim2.id, 'in')
  const archived = archive.records.find((row) => row.id === sent2.id)
  assert.equal(archived?.person?.uid, actor2.uid, '记录页与服务端的身份投影必须一致')

  // Hiding the letter still hides everything, including the settlement.
  await prisma.shunMasterAnonymousLetter.update({ where: { roundId: sent2.id }, data: { hiddenAt: new Date() } })
  assert.equal(await readAnonymousLetter(victim2.id, sent2.id), null, '被隐藏的信件不得返回内容')
})
