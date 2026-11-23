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
    assert.equal((await request('/api/shun-master/attempt', undefined, { requestId: randomUUID() })).status, 401)
    assert.equal((await request('/api/admin/shun-master', actorToken)).status, 403)
    assert.equal((await request('/api/admin/shun-master', actorToken, { operation: 'enable', confirmed: true }, 'PATCH')).status, 403)
    assert.equal((await request('/api/admin/shun-master', adminToken, { operation: 'disable' }, 'PATCH')).status, 200)
    await prisma.systemNotification.updateMany({ where: { title: { contains: '顺大师' } }, data: { published: false } })
    const custom = { ...defaultShunConfig, enabled: true, attempts: 8, victimCap: 3, goldenMinutes: 12,
      probabilities: [24, 22, 17, 14, 10, 7, 6], weights: [129, 120, 115, 108, 100], budget: 900 }
    const saved = await request('/api/admin/shun-master', adminToken, custom, 'PATCH')
    assert.equal(saved.status, 200)
    assert.deepEqual(saved.body.config, { ...custom, enabled: false })
    assert.equal((await request('/api/admin/shun-master', adminToken, defaultShunConfig, 'PATCH')).status, 200)
    assert.equal((await request('/api/shun-master/attempt', actorToken, { requestId: randomUUID() })).body.code, 'DISABLED')
    const refusal = await prisma.shunMasterProtection.create({ data: { userId: actor.id, protected: true } })
    await prisma.userOperationLog.create({ data: { userId: actor.id, category: 'SHUN_MASTER', action: 'LEAVE',
      summary: '合成旧退出记录', source: 'WEB', operatorType: 'USER' } })
    assert.equal((await request('/api/admin/shun-master', adminToken, { ...defaultShunConfig, enabled: false, probabilities: [1, 1, 1, 1, 1, 1, 1] }, 'PATCH')).status, 400)
    assert.equal((await request('/api/admin/shun-master', adminToken, { operation: 'enable' }, 'PATCH')).body.code, 'CONFIRM_REQUIRED')
    assert.equal((await request('/api/admin/shun-master', adminToken, { operation: 'enable', confirmed: true }, 'PATCH')).body.code, 'NOTICE_REQUIRED')
    const notice = await prisma.systemNotification.create({ data: { createdById: admin.id, title: '顺大师初次开放公告', content: '顺大师挂号费扣除规则与匹配保护',
      type: 'ANNOUNCEMENT', isPublished: true, published: true, publishedAt: new Date(), publishAt: new Date() } })
    assert.equal((await request('/api/admin/shun-master', adminToken, { operation: 'enable', confirmed: true }, 'PATCH')).status, 200)
    assert.equal((await prisma.shunMasterSettings.findUniqueOrThrow({ where: { id: 1 } })).launchNoticeId, notice.id)
    assert.equal((await request('/api/shun-master/protection', undefined, { protected: true })).status, 401)
    assert.equal((await request('/api/shun-master/protection', actorToken, { protected: false })).status, 404)
    assert.equal((await request('/api/shun-master/membership', actorToken, { joined: false })).status, 404)
    assert.deepEqual(await prisma.shunMasterProtection.findUnique({ where: { userId: actor.id } }), refusal)
    const config = await request('/api/shun-master/config', actorToken)
    assert.equal(config.status, 200)
    for (const internal of ['weights', 'probabilities', 'budget']) assert.ok(!(internal in config.body))
    const desktop = await client.newContext({ viewport: { width: 1360, height: 1000 } })
    await desktop.addCookies([{ name: authCookieName, value: actorToken, url: base }])
    const page = await desktop.newPage()
    const guest = await client.newPage()
    await guest.goto(base + '/shun-master')
    const guestRules = guest.locator('details').filter({ hasText: '顺大师 · 玩法说明' })
    assert.equal(await guestRules.getAttribute('open'), null)
    await guestRules.locator('summary').click()
    await guestRules.getByText('每日机会于北京时间 00:00 重置。', { exact: true }).waitFor()
    const rulesText = await guestRules.innerText()
    assert.doesNotMatch(rulesText, /候选池|准备金|余额不足|平台补偿|同意规则/)
    assert.equal(await guest.getByRole('button', { name: '顺一手' }).count(), 0)
    await guest.getByRole('link', { name: '登录参与顺大师' }).waitFor()
    assert.equal(new URL(guest.url()).pathname, '/shun-master')
    await guest.close()
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
    assert.equal(await page.getByRole('button', { name: /匹配保护|同意|加入|退出后续匹配/ }).count(), 0)
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
    assert.deepEqual(await prisma.shunMasterProtection.findUnique({ where: { userId: actor.id } }), refusal)
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
    assert.ok(overview.body.candidatePool.excluded.refused > 0)
    assert.ok(overview.body.refusalAudit.some((entry: { userId: string; action: string }) => entry.userId === actor.id && entry.action === 'LEAVE'))
    assert.ok(overview.body.abuse.some((item: { userId: string }) => item.userId === actor.id))
    const operator = await client.newContext({ viewport: { width: 1360, height: 1000 } })
    await operator.addCookies([{ name: authCookieName, value: adminToken, url: base }])
    const adminPage = await operator.newPage()
    await adminPage.goto(base + '/admin/shun-master')
    await adminPage.getByRole('heading', { name: '顺大师管理' }).waitFor()
    await adminPage.getByRole('heading', { name: /符合今日扣费目标条件/ }).waitFor()
    await adminPage.getByText('近期高频请求拦截', { exact: true }).click()
    await adminPage.getByText('shun-master:attempt', { exact: false }).first().waitFor()
    if (output) await adminPage.screenshot({ path: join(output, 'admin.png') })
    await adminPage.getByRole('button', { name: '关闭顺大师' }).click()
    const state = adminPage.getByRole('region', { name: '游戏状态' })
    await state.getByText('已关闭', { exact: true }).waitFor()
    await adminPage.getByRole('button', { name: '保存配置' }).click()
    await adminPage.getByText('顺大师规则已保存，启停状态未改变。', { exact: true }).waitFor()
    assert.equal(await adminPage.getByText('已发布的全站公告 ID', { exact: false }).count(), 0)
    assert.equal((await request('/api/shun-master/attempt', victimToken, { requestId: randomUUID() })).body.code, 'DISABLED')
    await adminPage.evaluate(() => window.scrollTo(0, 0))
    if (output) await adminPage.screenshot({ path: join(output, 'admin-after.png') })
    adminPage.once('dialog', (popup) => popup.dismiss())
    await adminPage.getByRole('button', { name: '启用顺大师' }).click()
    assert.equal((await request('/api/admin/shun-master', adminToken)).body.effectiveEnabled, false)
    adminPage.once('dialog', (popup) => popup.accept())
    await adminPage.getByRole('button', { name: '启用顺大师' }).click()
    await state.getByText('已启用', { exact: true }).waitFor()
    for (const theme of ['day', 'midnight']) {
      await adminPage.evaluate((value) => { document.documentElement.dataset.theme = value }, theme)
      for (const width of [320, 360, 375, 390, 414, 430, 768, 1280]) {
        await adminPage.setViewportSize({ width, height: 844 })
        const form = adminPage.locator('main form')
        const layout = await form.evaluate((element) => {
          const rect = element.getBoundingClientRect()
          return { width: innerWidth, documentWidth: document.documentElement.scrollWidth,
            formWidth: element.clientWidth, formScrollWidth: element.scrollWidth, left: rect.x, right: rect.right }
        })
        assert.ok(layout.documentWidth <= layout.width && layout.formScrollWidth <= layout.formWidth
          && layout.left >= 0 && layout.right <= layout.width, `admin ${theme} ${width} ${JSON.stringify(layout)}`)
        if (output && width === 390) await adminPage.screenshot({ path: join(output, `admin-h5-${theme}.png`) })
      }
    }
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
    await phone.setViewportSize({ width: 390, height: 844 })
    const phoneRules = phone.locator('details').filter({ hasText: '顺大师 · 玩法说明' })
    assert.equal(await phoneRules.getAttribute('open'), null)
    await phoneRules.locator('summary').click()
    assert.equal(await phoneRules.innerText(), rulesText)
    if (output) await phoneRules.screenshot({ path: join(output, 'rules-h5.png') })
  } finally { await client.close(); await prisma.$disconnect() }
})
