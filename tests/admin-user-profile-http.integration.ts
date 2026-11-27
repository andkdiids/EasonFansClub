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
      data: { username: name, usernameNormalized: name, nickname: name, role, passwordHash: 'fixture', bio: '旧简介', Profile: { create: { displayName: name } } },
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
  const { user, options } = await start.json()
  assert.equal(user.bio, '旧简介')
  assert.deepEqual(Object.keys(user).sort(), ['bio', 'birthDay', 'birthMonth', 'birthdayPublic', 'customGender', 'gender', 'id', 'location', 'nickname', 'showBadgeActivity', 'showBadgeProgressNotifications', 'uid', 'updatedAt'].sort())
  assert.ok(options.genders.includes('PRIVATE'))
  const patch = {
    bio: '管理员更新简介', birthdayPublic: !user.birthdayPublic, expectedUpdatedAt: user.updatedAt,
    birthMonth: 2, birthDay: 29, gender: 'PRIVATE', location: { countryCode: 'CN', regionCode: 'CN-44' },
  }
  assert.equal((await save(targetBearer, patch)).status, 403)
  assert.equal((await save({ ...browser, Origin: 'https://untrusted.example.invalid' }, patch)).status, 403)
  assert.equal((await save(adminBearer, { ...patch, role: 'SUPER_ADMIN' })).status, 400)
  assert.equal((await save(adminBearer, { ...patch, birthDay: 30 })).status, 400)
  assert.equal((await save(adminBearer, patch)).status, 200)
  assert.equal((await save(browser, { ...patch, bio: '过期修改' })).status, 409)
  const browserRead = await read(browser)
  assert.equal(browserRead.status, 200)
  const reloaded = (await browserRead.json()).user
  assert.equal(reloaded.bio, patch.bio)
  assert.equal(reloaded.birthdayPublic, patch.birthdayPublic)
  assert.equal(reloaded.birthMonth, 2)
  assert.equal(reloaded.birthDay, 29)
  assert.equal(reloaded.gender, 'PRIVATE')
  assert.equal(reloaded.location.regionCode, 'CN-44')
  assert.equal(await prisma.adminActionLog.count({
    where: { targetUserId: target.id, adminId: admin.id, action: 'UPDATE_USER_PROFILE' },
  }), 1)
  const timeline = (headers: Record<string, string>) => fetch(
    origin + '/api/admin/user-operations?' + new URLSearchParams({ view: 'timeline', projection: 'mobile', userId: target.id, pageSize: '20' }),
    { headers, redirect: 'manual' },
  )
  assert.equal((await timeline(targetBearer)).status, 403)
  const history = await timeline(adminBearer)
  assert.equal(history.status, 200)
  const { events, pagination } = await history.json()
  assert.equal(pagination.page, 1)
  const profileEdit = events.find((event: { action: string }) => event.action === 'UPDATE_USER_PROFILE')
  assert.ok(profileEdit)
  assert.equal(profileEdit.operator.uid, admin.uid)
  assert.ok(profileEdit.detail.changedFields.split('、').includes('bio'))
  assert.equal(profileEdit.detail.oldValue, undefined)

  const makeup = origin + '/api/admin/checkin-makeup'
  const previewUrl = makeup + '?' + new URLSearchParams({ userId: target.id, rangeDays: '30' })
  assert.equal((await fetch(previewUrl, { headers: targetBearer })).status, 403)
  await prisma.user.update({ where: { id: target.id }, data: { createdAt: new Date('2020-01-01T00:00:00Z') } })
  const preview = await fetch(previewUrl, { headers: adminBearer })
  assert.equal(preview.status, 200)
  const [date] = (await preview.json()).eligibleMissingDates
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/)
  const reason = '隔离数据库审核验证'
  const submit = (headers: Record<string, string>) => fetch(makeup, {
    method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: target.id, dates: [date], reason }),
  })
  assert.equal((await submit(targetBearer)).status, 403)
  assert.equal((await submit({ ...adminBearer, Origin: 'https://untrusted.example.invalid' })).status, 403)
  assert.equal((await submit(adminBearer)).status, 201)
  assert.equal((await submit(adminBearer)).status, 409)
  assert.equal(await prisma.adminActionLog.count({
    where: { action: 'CHECK_IN_ADMIN_MAKEUP', adminId: admin.id, targetUserId: target.id },
  }), 1)
  const recordUrl = makeup + '/records?' + new URLSearchParams({ q: String(target.uid), type: 'ADMIN' })
  assert.equal((await fetch(recordUrl, { headers: targetBearer })).status, 403)
  const recordRead = await fetch(recordUrl, { headers: adminBearer })
  assert.equal(recordRead.status, 200)
  const { records } = await recordRead.json()
  assert.equal(records.length, 1)
  assert.equal(records[0].dateKey, date)
  assert.equal(records[0].operator.reason, reason)
  const admins = origin + '/api/admin/admins'
  const grant = (headers: Record<string, string>, userId: string, permissions: string[]) =>
    fetch(admins, {
      method: 'POST', redirect: 'manual', headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, permissions }),
    })
  const optionsUrl = admins + '?view=permission-options'
  assert.equal((await fetch(optionsUrl, { headers: targetBearer })).status, 403)
  assert.equal((await grant(adminBearer, target.id, ['admin_manage'])).status, 200)
  const delegated = await fetch(optionsUrl, { headers: targetBearer })
  assert.equal(delegated.status, 200)
  assert.deepEqual((await delegated.json()).options.map((item: { key: string }) => item.key), ['admin_manage'])
  assert.equal((await grant(targetBearer, target.id, ['admin_manage'])).status, 403)
  const another = await create('USER')
  assert.equal((await grant(targetBearer, another.id, ['user_manage'])).status, 403)
  const revoke = await fetch(admins + '/' + encodeURIComponent(target.id), { method: 'DELETE', headers: adminBearer })
  assert.equal(revoke.status, 200)
  assert.equal((await fetch(optionsUrl, { headers: targetBearer })).status, 403)
  assert.equal(await prisma.adminAction.count({
    where: { targetUserId: target.id, adminId: admin.id, action: 'UPDATE_USER_ROLE' },
  }), 2)

  const board = await prisma.board.create({ data: { name: '评论测试', slug: 'reply-qa-' + randomUUID() } })
  const post = await prisma.post.create({ data: { title: '隔离测试帖', content: '正文', authorId: admin.id, boardId: board.id } })
  const reply = await prisma.reply.create({ data: { content: '隔离测试评论', authorId: target.id, postId: post.id } })
  const postReview = origin + '/api/admin/posts/review?' + new URLSearchParams({ status: 'ALL', keyword: post.id, contentType: 'NORMAL', postId: post.id })
  assert.equal((await fetch(postReview, { headers: targetBearer })).status, 403)
  const posts = await fetch(postReview, { headers: adminBearer })
  assert.equal(posts.status, 200)
  const managedPosts = (await posts.json()).posts
  assert.equal(managedPosts.length, 1)
  assert.equal(managedPosts[0].id, post.id)
  assert.equal(managedPosts[0].contentType, 'NORMAL')
  assert.deepEqual(managedPosts[0].reports, [])
  const replies = origin + '/api/admin/replies'
  const search = replies + '?' + new URLSearchParams({ keyword: reply.id })
  assert.equal((await fetch(search, { headers: targetBearer })).status, 403)
  const listed = await fetch(search, { headers: adminBearer })
  assert.equal(listed.status, 200)
  assert.deepEqual((await listed.json()).items.map((item: { id: string }) => item.id), [reply.id])
  const remove = (headers: Record<string, string>) => fetch(replies + '?id=' + reply.id, {
    method: 'DELETE', headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason: '隔离审核测试' }),
  })
  assert.equal((await remove(targetBearer)).status, 403)
  assert.equal((await remove({ ...browser, Origin: 'https://untrusted.example.invalid' })).status, 403)
  const outcomes = await Promise.all([remove(adminBearer), remove(adminBearer)])
  assert.deepEqual(outcomes.map(response => response.status).sort(), [200, 409])
  assert.equal(await prisma.adminAction.count({ where: { replyId: reply.id, action: 'DELETE_REPLY', reason: '隔离审核测试' } }), 1)
})
