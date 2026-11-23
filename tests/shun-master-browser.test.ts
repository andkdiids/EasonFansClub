import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { chromium } from 'playwright'
import { authCookieName, createSessionToken } from '../lib/auth'
import { prisma } from '../lib/prisma'
import { defaultShunConfig } from '../lib/shun-master-rules'

test('real HTTP and browser exercise Shun Master opt-in, anonymity, capture and navigation', {
  skip: process.env.SHUN_MASTER_BROWSER_QA !== '1', timeout: 150000,
}, async () => {
  const db = new URL(process.env.DATABASE_URL || '')
  assert.equal(db.hostname, '127.0.0.1')
  assert.equal(db.port, '33326')
  assert.equal(db.pathname, '/ecfc_shun_qa')
  const base = 'http://127.0.0.1:3126'
  const create = (points: number, role: 'USER' | 'SUPER_ADMIN' = 'USER') => {
    const name = 'shun-browser-' + randomUUID()
    return prisma.user.create({ data: { username: name, usernameNormalized: name, nickname: name,
      email: name + '@example.invalid', emailVerifiedAt: new Date(), points, passwordHash: 'fixture', role,
      createdAt: new Date(Date.now() - 9 * 86400000), Profile: { create: { displayName: name } } } })
  }
  const client = await chromium.launch({ executablePath: process.env.SHUN_MASTER_BROWSER_PATH, headless: true })
  try {
    const [admin, actor, victim, ...decoys] = await Promise.all([create(0, 'SUPER_ADMIN'), create(0), create(21), create(0), create(0)])
    // This disposable DB may contain members from the concurrency test.
    await prisma.shunMasterMember.updateMany({ data: { joined: false } })
    const [adminToken, actorToken, victimToken, ...decoyTokens] = await Promise.all([admin, actor, victim, ...decoys].map(createSessionToken))
    const request = async (path: string, token?: string, body?: object, method?: string) => {
      const response = await fetch(base + path, { redirect: 'manual',
        headers: { ...(token ? { Cookie: authCookieName + '=' + token } : {}),
          ...(body ? { 'Content-Type': 'application/json', Origin: base } : {}) },
        ...(body ? { method: method || 'POST', body: JSON.stringify(body) } : {}),
      })
      return { status: response.status, body: await response.json() }
    }
    assert.equal((await request('/api/shun-master/status')).status, 401)
    assert.equal((await request('/api/admin/shun-master', actorToken)).status, 403)
    assert.equal((await request('/api/admin/shun-master', adminToken, { ...defaultShunConfig, probabilities: [1, 1, 1, 1, 1, 1, 1] }, 'PATCH')).status, 400)
    assert.equal((await request('/api/admin/shun-master', adminToken, { ...defaultShunConfig, enabled: true }, 'PATCH')).status, 200)
    for (const token of [victimToken, ...decoyTokens]) {
      assert.equal((await request('/api/shun-master/membership', token, { joined: true, victimCap: 4 })).status, 200)
    }
    const config = await request('/api/shun-master/config', actorToken)
    assert.equal(config.status, 200)
    for (const internal of ['weights', 'probabilities', 'budget']) assert.ok(!(internal in config.body))
    assert.equal((await request('/api/shun-master/attempt', actorToken, { requestId: randomUUID() })).body.code, 'MEMBERSHIP')
    const desktop = await client.newContext({ viewport: { width: 1360, height: 1000 } })
    await desktop.addCookies([{ name: authCookieName, value: actorToken, url: base }])
    const page = await desktop.newPage()
    await page.goto(base + '/games')
    await page.getByRole('link', { name: '进入顺大师' }).waitFor()
    await page.locator('.app-topbar').getByRole('link', { name: '顺大师' }).click()
    await page.getByRole('heading', { name: '顺大师', exact: true }).waitFor()
    await page.getByRole('button', { name: '同意规则并加入' }).click()
    await page.getByRole('button', { name: '顺一手' }).click()
    await page.getByText('看看哪个 EF 这么幸运...', { exact: true }).waitFor()
    assert.notEqual(await page.locator('.shun-hands').evaluate((el) => getComputedStyle(el).animationName), 'none')
    await page.getByText('顺走啦！', { exact: true }).waitFor()
    const output = process.env.SHUN_MASTER_QA_OUTPUT
    if (output) { await mkdir(output, { recursive: true }); await page.screenshot({ path: join(output, 'desktop.png') }) }
    const incoming = await request('/api/shun-master/records?side=in', victimToken)
    const record = incoming.body.records[0]
    assert.strictEqual(record.person, null)
    assert.ok(!JSON.stringify(record).includes(actor.id) && !('candidates' in record))
    const mobile = await client.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
    await mobile.addCookies([{ name: authCookieName, value: victimToken, url: base }])
    const phone = await mobile.newPage()
    await phone.goto(base + '/shun-master?record=' + record.id)
    await phone.getByText('神秘 EF', { exact: true }).waitFor()
    await phone.getByRole('button', { name: 'E院中心' }).click()
    const navigation = phone.getByRole('button', { name: '顺大师', exact: true })
    await navigation.waitFor()
    await phone.keyboard.press('Escape')
    await navigation.waitFor({ state: 'hidden' })
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await phone.getByRole('button', { name: '抓捕追回' }).click()
    await phone.getByRole('group', { name: '选择一位 EF' }).waitFor()
    assert.equal(await phone.getByRole('radio').count(), 2)
    if (output) await phone.screenshot({ path: join(output, 'h5-golden-capture.png'), fullPage: true })
    await phone.getByRole('radio', { name: actor.nickname }).check()
    await phone.getByRole('button', { name: '确认抓捕' }).click()
    await phone.getByText('抓到你啦！', { exact: true }).waitFor()
    const completed = await request('/api/shun-master/records?side=in', victimToken)
    assert.equal(completed.body.records[0].person.uid, actor.uid)
    assert.equal(completed.body.records[0].recovered, record.amount)
    const highFrequency = await Promise.all(Array.from({ length: 20 }, () =>
      request('/api/shun-master/attempt', actorToken, { requestId: 'invalid' })))
    assert.ok(highFrequency.some((result) => result.status === 429))
    const overview = await request('/api/admin/shun-master', adminToken)
    assert.equal(overview.status, 200)
    assert.ok(overview.body.abuse.some((item: { userId: string }) => item.userId === actor.id))
    const operator = await client.newContext({ viewport: { width: 1360, height: 1000 } })
    await operator.addCookies([{ name: authCookieName, value: adminToken, url: base }])
    const adminPage = await operator.newPage()
    await adminPage.goto(base + '/admin/shun-master')
    await adminPage.getByRole('heading', { name: '顺大师管理' }).waitFor()
    await adminPage.getByText('近期高频请求拦截', { exact: true }).click()
    await adminPage.getByText('shun-master:attempt', { exact: false }).first().waitFor()
    if (output) await adminPage.screenshot({ path: join(output, 'admin.png') })
    await phone.locator('.app-topbar').getByRole('button', { name: '切换到深夜主题' }).click()
    assert.equal(await phone.locator('html').getAttribute('data-theme'), 'midnight')
    for (const width of [320, 430]) {
      await phone.setViewportSize({ width, height: 844 })
      assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    }
    if (output) await phone.screenshot({ path: join(output, 'h5-midnight-capture-result.png') })
  } finally { await client.close(); await prisma.$disconnect() }
})
