import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { authCookieName, createSessionToken } from '../lib/auth'
import { getMobileUserById, issueMobileSession } from '../lib/mobile-auth'
import { setShunEnabled, updateShunConfig } from '../lib/shun-master'
import { defaultShunConfig } from '../lib/shun-master-rules'
import { prisma } from '../lib/prisma'

test('Shun Master resolves Web and Android users through the same HTTP routes', { timeout: 120000 }, async () => {
  const db = new URL(process.env.DATABASE_URL || '')
  assert.equal(db.hostname, '127.0.0.1')
  assert.equal(db.pathname, '/ecfc_shun_qa')
  assert.equal(db.port, process.env.GITHUB_ACTIONS === 'true' ? '3306' : '33326')

  const create = (points: number) => {
    const name = 'shun-http-' + randomUUID()
    return prisma.user.create({ data: { username: name, usernameNormalized: name, nickname: name,
      points, passwordHash: 'fixture', Profile: { create: { displayName: name } } } })
  }
  const base = 'http://127.0.0.1:3126'
  const request = (path: string, headers: Record<string, string> = {}, body?: object) =>
    fetch(base + '/api/shun-master/' + path, {
      redirect: 'manual',
      headers: { ...headers, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    })

  try {
    const [actor, other] = await Promise.all([create(71), create(13)])
    const mobileUser = await getMobileUserById(actor.id)
    assert.ok(mobileUser)
    const session = { Cookie: authCookieName + '=' + await createSessionToken(actor) }
    const mobile = { Authorization: 'Bearer ' + (await issueMobileSession(mobileUser)).accessToken }
    const expired = { Authorization: 'Bearer ' + (await issueMobileSession(mobileUser, new Date(Date.now() - 3600000))).accessToken }
    const invalid = { Authorization: 'Bearer invalid' }

    for (const headers of [session, mobile]) {
      const status = await request('status?userId=' + other.id, headers)
      assert.equal(status.status, 200)
      assert.equal((await status.json()).balance, 71)
      const records = await request('records?side=in&range=today', headers)
      assert.equal(records.status, 200)
      assert.deepEqual((await records.json()).records, [])
    }
    for (const headers of [{}, expired, invalid, { ...session, ...invalid }]) {
      assert.equal((await request('status', headers)).status, 401)
      assert.equal((await request('attempt', headers, { requestId: randomUUID() })).status, 401)
    }
    const rejected = await request('attempt', { ...session, Origin: 'https://untrusted.example.invalid' }, { requestId: randomUUID() })
    assert.equal(rejected.status, 403)
    assert.equal(await prisma.shunMasterRound.count({ where: { actorId: actor.id } }), 0)
    await setShunEnabled(actor.id, false)
    const closed = await request('attempt', mobile, { requestId: randomUUID() })
    assert.ok(closed.status >= 400)

    const decoys = await Promise.all([create(0), create(0)])
    await prisma.user.updateMany({ where: { id: { notIn: [actor.id, other.id, ...decoys.map(user => user.id)] } }, data: { points: 0 } })
    await updateShunConfig(actor.id, { ...defaultShunConfig, enabled: false, openHoursEnabled: false, bonusChance: 0 })
    await setShunEnabled(actor.id, true)
    const victimDto = await getMobileUserById(other.id)
    assert.ok(victimDto)
    const victimMobile = { Authorization: 'Bearer ' + (await issueMobileSession(victimDto)).accessToken }
    const victimSession = { Cookie: authCookieName + '=' + await createSessionToken(other), Origin: base }

    const requestId = randomUUID()
    const writes = await Promise.all([mobile, { ...session, Origin: base }].map(headers => request('attempt', headers, { requestId })))
    const rounds = await Promise.all(writes.map(async response => {
      assert.equal(response.status, 200)
      return response.json()
    }))
    const [round] = rounds
    const note = '隔离环境匿名问候'
    const letterPath = 'letter/' + round.id
    const sendPath = 'round/' + round.id + '/letter'
    assert.equal((await request(sendPath, expired, { message: note })).status, 401)
    assert.equal((await request(sendPath, { ...mobile, Origin: 'https://untrusted.example.invalid' }, { message: note })).status, 403)
    const sent = await request(sendPath, mobile, { message: note })
    assert.equal(sent.status, 200)
    assert.equal((await sent.json()).status, 'SENT_LETTER')
    assert.equal((await request(letterPath, expired)).status, 401)
    assert.equal((await request(letterPath, mobile)).status, 404)
    const opened = await request(letterPath, victimMobile)
    assert.equal(opened.status, 200)
    const receivedLetter = await opened.json()
    assert.equal(receivedLetter.content, note)
    assert.equal(receivedLetter.result, null)
    assert.equal(receivedLetter.sender, undefined)
    assert.equal(receivedLetter.senderId, undefined)
    assert.equal(round.id, rounds[1].id)
    assert.ok(round.amount >= 1 && round.amount <= 7)
    assert.equal(await prisma.shunMasterRound.count({ where: { actorId: actor.id } }), 1)
    assert.equal(await prisma.pointLog.count({ where: { action: 'SHUN_STEAL', userId: { in: [actor.id, other.id] } } }), 2)
    for (const headers of [session, mobile]) {
      assert.equal((await (await request('status', headers)).json()).balance, 71 + round.amount)
      const history = await request('records?side=out&range=today', headers)
      assert.equal(history.status, 200)
      assert.equal((await history.json()).records[0].id, round.id)
    }
    const incoming = await request('records?side=in&range=today', victimMobile)
    assert.equal(incoming.status, 200)
    assert.equal((await incoming.json()).records[0].person, null)
    assert.equal((await request('capture/' + round.id + '/start', mobile, {})).status, 404)

    const start = await request('capture/' + round.id + '/start', victimSession, {})
    assert.equal(start.status, 200)
    const candidates = await start.json()
    assert.equal(candidates.mode, 2)
    assert.equal(candidates.candidates.length, 2)
    assert.ok(candidates.candidates.every((candidate: Record<string, unknown>) => !('correct' in candidate)))
    assert.ok(candidates.candidates.every((candidate: Record<string, unknown>) =>
      Object.hasOwn(candidate, 'avatarUrl') && Object.keys(candidate).every(key => ['uid', 'nickname', 'avatarUrl'].includes(key))))
    const guesses = await Promise.all([victimSession, victimMobile].map(headers =>
      request('capture/' + round.id + '/guess', headers, { uid: actor.uid, mode: 2 })))
    for (const response of guesses) {
      assert.equal(response.status, 200)
      assert.equal((await response.json()).record.recovered, round.amount)
    }
    assert.equal(await prisma.pointLog.count({ where: { action: 'SHUN_RECOVERY', userId: { in: [actor.id, other.id] } } }), 2)
    const users = await prisma.user.findMany({ where: { id: { in: [actor.id, other.id] } }, select: { id: true, points: true } })
    assert.equal(users.find(user => user.id === actor.id)?.points, 71)
    assert.equal(users.find(user => user.id === other.id)?.points, 13)
    const retries = await Promise.all(Array.from({ length: 19 }, () => request('attempt', mobile, { requestId })))
    assert.ok(retries.some(response => response.status === 429), 'write throttling must apply to Bearer requests')
    assert.equal(await prisma.shunMasterRound.count({ where: { actorId: actor.id } }), 1)
  } finally {
    await prisma.$disconnect()
  }
})
