import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { authCookieName, createSessionToken } from '../lib/auth'
import { getMobileUserById, issueMobileSession } from '../lib/mobile-auth'
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
  } finally {
    await prisma.$disconnect()
  }
})
