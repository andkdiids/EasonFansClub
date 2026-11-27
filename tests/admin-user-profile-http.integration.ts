import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import { authCookieName, createSessionToken } from '../lib/auth'
import { getMobileUserById, issueMobileSession } from '../lib/mobile-auth'
import { prisma } from '../lib/prisma'

test('administrator profile edits enforce origin, role and version over HTTP', { timeout: 120000 }, async () => {
  const db = new URL(process.env.DATABASE_URL || '')
  assert.equal(db.protocol, 'mysql:')
  assert.equal(db.hostname, '127.0.0.1')
  assert.equal(db.pathname, '/ecfc_shun_qa')
  assert.equal(process.env.GITHUB_ACTIONS, 'true')
  assert.equal(db.port, '3306')

  const create = (role: 'USER' | 'SUPER_ADMIN') => {
    const name = 'admin-profile-qa-' + randomUUID()
    return prisma.user.create({
      data: { username: name, usernameNormalized: name, nickname: name, role, passwordHash: 'fixture', bio: '旧简介' },
    })
  }
  const [admin, target] = await Promise.all([create('SUPER_ADMIN'), create('USER')])
  const bearerFor = async (userId: string) => {
    const user = await getMobileUserById(userId)
    assert.ok(user)
    return { Authorization: 'Bearer ' + (await issueMobileSession(user)).accessToken }
  }
  const adminBearer = await bearerFor(admin.id)
  const targetBearer = await bearerFor(target.id)
  const origin = 'http://127.0.0.1:3126'
  const path = origin + '/api/admin/users/' + encodeURIComponent(target.id)
  const browser = { Cookie: authCookieName + '=' + await createSessionToken(admin), Origin: origin }
  const read = (headers: Record<string, string> = {}) => fetch(path + '?view=profile-edit', { headers, redirect: 'manual' })
  const save = (headers: Record<string, string>, body: object) => fetch(path, {
    method: 'PATCH', redirect: 'manual',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'updateMobileProfile', ...body }),
  })

  assert.equal((await read()).status, 401)
  assert.equal((await read(targetBearer)).status, 403)
  const start = await read(adminBearer)
  assert.equal(start.status, 200)
  const { user } = await start.json()
  assert.equal(user.bio, '旧简介')
  assert.deepEqual(Object.keys(user).sort(), ['bio', 'id', 'nickname', 'uid', 'updatedAt'])
  const patch = { bio: '管理员更新简介', expectedUpdatedAt: user.updatedAt }
  assert.equal((await save(targetBearer, patch)).status, 403)
  assert.equal((await save({ ...browser, Origin: 'https://untrusted.example.invalid' }, patch)).status, 403)
  assert.equal((await save(adminBearer, { ...patch, role: 'SUPER_ADMIN' })).status, 400)
  assert.equal((await save(adminBearer, patch)).status, 200)
  assert.equal((await save(browser, { ...patch, bio: '过期修改' })).status, 409)
  const browserRead = await read(browser)
  assert.equal(browserRead.status, 200)
  assert.equal((await browserRead.json()).user.bio, patch.bio)
  assert.equal(await prisma.userOperationLog.count({
    where: { userId: target.id, operatorUserId: admin.id, action: 'UPDATE_USER_PROFILE' },
  }), 1)
})
