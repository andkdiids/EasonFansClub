import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { chromium } from 'playwright'
import { authCookieName, createSessionToken } from '../lib/auth'
import { prisma } from '../lib/prisma'
import { defaultShunConfig } from '../lib/shun-master-rules'

test('real HTTP and browser exercise the public pool, result modal, capture and navigation', {
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
      points, passwordHash: 'fixture', role, Profile: { create: { displayName: name } } } })
  }
  const client = await chromium.launch({ executablePath: process.env.SHUN_MASTER_BROWSER_PATH, headless: true })
  try {
    const [admin, actor, victim, ...decoys] = await Promise.all([create(0, 'SUPER_ADMIN'), create(0), create(21), create(0), create(0)])
    const fixtures = [admin, actor, victim, ...decoys]
    const previousFixtures = await prisma.user.findMany({ where: { id: { notIn: fixtures.map(({ id }) => id) } }, select: { id: true } })
    await prisma.shunMasterProtection.createMany({ data: previousFixtures.map(({ id: userId }) => ({ userId, protected: true })), skipDuplicates: true })
    await prisma.shunMasterProtection.updateMany({ where: { userId: { notIn: fixtures.map(({ id }) => id) } }, data: { protected: true } })
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
    assert.equal((await request('/api/admin/shun-master', adminToken, defaultShunConfig, 'PATCH')).status, 200)
    assert.equal((await request('/api/shun-master/attempt', actorToken, { requestId: randomUUID() })).body.code, 'DISABLED')
    assert.equal((await request('/api/shun-master/protection', actorToken, { protected: true })).status, 200)
    assert.equal((await request('/api/admin/shun-master', adminToken, { ...defaultShunConfig, probabilities: [1, 1, 1, 1, 1, 1, 1] }, 'PATCH')).status, 400)
    assert.equal((await request('/api/admin/shun-master', adminToken, { ...defaultShunConfig, enabled: true }, 'PATCH')).body.code, 'NOTICE_REQUIRED')
    const notice = await prisma.systemNotification.create({ data: { createdById: admin.id, title: '顺大师初次开放公告', content: '挂号费扣除规则与匹配保护', published: true } })
    assert.equal((await request('/api/admin/shun-master', adminToken,
      { ...defaultShunConfig, enabled: true, launchNoticeId: notice.id, confirmProtection: true }, 'PATCH')).status, 200)
    assert.equal((await request('/api/shun-master/protection', undefined, { protected: true })).status, 401)
    assert.equal((await request('/api/shun-master/attempt', actorToken, { requestId: randomUUID() })).body.code, 'PROTECTED')
    assert.equal((await request('/api/shun-master/protection', actorToken, { protected: false })).status, 200)
    const config = await request('/api/shun-master/config', actorToken)
    assert.equal(config.status, 200)
    for (const internal of ['weights', 'probabilities', 'budget']) assert.ok(!(internal in config.body))
    const desktop = await client.newContext({ viewport: { width: 1360, height: 1000 } })
    await desktop.addCookies([{ name: authCookieName, value: actorToken, url: base }])
    const page = await desktop.newPage()
    await page.goto(base + '/games')
    assert.equal(await page.locator('.app-topbar').getByRole('link', { name: '顺大师' }).count(), 0)
    await page.getByRole('link', { name: '进入顺大师' }).click()
    await page.getByRole('heading', { name: '顺大师', exact: true }).waitFor()
    await page.waitForFunction(() => document.title === '顺大师')
    await page.getByRole('button', { name: '顺一手' }).waitFor()
    await page.goto(base + '/community')
    await page.waitForFunction(() => document.title === '私家E院')
    assert.equal(await page.locator('.app-topbar').getByRole('link', { name: '顺大师' }).count(), 0)
    await page.goto(base + '/forum')
    await page.waitForFunction(() => document.title === '小E书')
    await page.goBack()
    await page.waitForFunction(() => document.title === '私家E院')
    await page.goForward()
    await page.waitForFunction(() => document.title === '小E书')
    assert.equal(await page.locator('.app-topbar').getByRole('link', { name: '顺大师' }).count(), 0)
    await page.goto(base + '/shun-master')
    await page.getByRole('button', { name: '顺一手' }).waitFor()
    let interrupted = false
    let firstRequestId: string | undefined
    await page.route('**/api/shun-master/attempt', async (route) => {
      const requestId = route.request().postDataJSON().requestId as string
      if (!interrupted) {
        interrupted = true
        firstRequestId = requestId
        assert.equal((await route.fetch()).status(), 200)
        await route.abort()
      } else {
        assert.equal(requestId, firstRequestId)
        await route.continue()
      }
    })
    await page.getByRole('button', { name: '顺一手' }).click()
    await page.getByText('网络连接中断，请重试。', { exact: true }).waitFor()
    await page.getByRole('button', { name: '顺一手' }).click()
    await page.getByText('看看哪个 EF 这么幸运...', { exact: true }).waitFor()
    assert.notEqual(await page.locator('.shun-hands').evaluate((el) => getComputedStyle(el).animationName), 'none')
    const modal = page.getByRole('dialog', { name: '顺走啦！' })
    await modal.waitFor()
    await modal.getByText(victim.nickname, { exact: true }).waitFor()
    const output = process.env.SHUN_MASTER_QA_OUTPUT
    if (output) { await mkdir(output, { recursive: true }); await page.screenshot({ path: join(output, 'desktop.png') }) }
    const incoming = await request('/api/shun-master/records?side=in', victimToken)
    const record = incoming.body.records[0]
    assert.equal(incoming.body.records.length, 1)
    await page.unroute('**/api/shun-master/attempt')
    await modal.getByText('+' + record.amount + ' 挂号费', { exact: true }).waitFor()
    await page.setViewportSize({ width: 390, height: 844 })
    if (output) await page.screenshot({ path: join(output, 'h5-result-modal.png') })
    const second = await create(1)
    await modal.getByRole('button', { name: '再顺一手' }).click()
    await modal.getByText(second.nickname, { exact: true }).waitFor()
    assert.equal(await page.getByRole('dialog', { name: '顺走啦！' }).count(), 1)
    await modal.getByRole('button', { name: '关闭' }).click()
    await modal.waitFor({ state: 'hidden' })
    await page.getByRole('combobox', { name: '记录日期' }).selectOption('today')
    await page.getByRole('region', { name: '历史记录' }).getByText(victim.nickname, { exact: true }).waitFor()
    await page.getByRole('combobox', { name: '记录日期' }).selectOption('yesterday')
    await page.getByText('还没有记录。', { exact: true }).waitFor()
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
    assert.equal((await request('/api/shun-master/protection', actorToken, { protected: true })).status, 200)
    const ordinaryAttempt = await request('/api/shun-master/attempt', decoyTokens[0], { requestId: randomUUID() })
    assert.equal(ordinaryAttempt.status, 200)
    assert.equal(ordinaryAttempt.body.person.uid, victim.uid)
    await prisma.shunMasterRound.update({ where: { id: ordinaryAttempt.body.id }, data: { goldenUntil: new Date(0) } })
    await phone.goto(base + '/shun-master?record=' + ordinaryAttempt.body.id)
    await phone.getByRole('button', { name: '抓捕追回' }).click()
    await phone.getByRole('heading', { name: '三选一抓捕' }).waitFor()
    assert.equal(await phone.getByRole('radio').count(), 3)
    const options = await phone.getByRole('group', { name: '选择一位 EF' }).locator('label').all()
    for (const option of options) {
      if (!(await option.textContent())?.includes(decoys[0].nickname)) {
        await option.getByRole('radio').check()
        break
      }
    }
    await phone.getByRole('button', { name: '确认抓捕' }).click()
    await phone.getByText('让 TA 溜了！', { exact: true }).waitFor()
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
    const stamp = new Date()
    const memoir = await prisma.activity.create({ data: { title: '葡萄成熟时', description: 'Browser fixture', type: 'TOPIC_ACTIVITY',
      annualMemoirConfig: { create: { year: 2026, previewAt: stamp, reservationOpensAt: stamp, reservationClosesAt: stamp,
        statisticsStartAt: stamp, statisticsEndAt: stamp, reportOpensAt: stamp, notificationAt: stamp, endsAt: stamp, settlementAt: stamp } } } })
    await adminPage.goto(base + '/admin/activities/' + memoir.id + '/annual-memoir-preview')
    await adminPage.waitForFunction(() => document.title === '《葡萄成熟时》')
    await adminPage.goto(base + '/community')
    await adminPage.waitForFunction(() => document.title === '私家E院')
    await adminPage.goto(base + '/shun-master')
    await adminPage.waitForFunction(() => document.title === '顺大师')
    await adminPage.goto(base + '/forum')
    await adminPage.waitForFunction(() => document.title === '小E书')
    for (const theme of ['day', 'midnight']) {
      if (theme === 'midnight') await phone.locator('.app-topbar').getByRole('button', { name: '切换到深夜主题' }).click()
      assert.equal(await phone.locator('html').getAttribute('data-theme'), theme)
      for (const width of [320, 360, 375, 390, 414, 430, 768, 1280]) {
        await phone.setViewportSize({ width, height: 844 })
        assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        const layout = await phone.locator('[data-shun-balance-icon]').evaluate((icon) => {
          const stats = icon.closest('dl')!
          const columns = [...stats.children].map((column) => column.getBoundingClientRect().width)
          const art = icon.closest('section')!.querySelector('svg.shun-art')!.getBoundingClientRect()
          const area = icon.closest('section')!.getBoundingClientRect()
          const page = icon.closest('main')!
          const frame = page.parentElement!.getBoundingClientRect()
          const pageRect = page.getBoundingClientRect()
          return Math.max(...columns) - Math.min(...columns) < 1
            && Math.abs((art.left + art.right) - (area.left + area.right)) < 2
            && Math.abs((pageRect.left + pageRect.right) - (frame.left + frame.right)) < 2
            && icon.parentElement?.tagName === 'DD'
        })
        assert.equal(layout, true, `${theme} ${width}`)
        if (output && width === 390) await phone.screenshot({ path: join(output, `h5-${theme}.png`) })
      }
    }
  } finally { await client.close(); await prisma.$disconnect() }
})
