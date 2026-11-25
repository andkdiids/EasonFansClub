import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { chromium, type Browser } from 'playwright'
import { authCookieName, createSessionToken } from '../lib/auth'
import { prisma } from '../lib/prisma'
import { setShunEnabled, updateShunConfig } from '../lib/shun-master'
import { defaultShunConfig } from '../lib/shun-master-rules'
import { beijingMinuteOfDay, formatShunClock, shunOpenHoursHint, shunOpenHoursLabel } from '../lib/shun-open-hours'

/**
 * Real-browser acceptance for V6 (daily opening hours).
 *
 * Proves what source assertions cannot: the closed state really renders, the
 * take button really is disabled, the copy follows the configured times in
 * light and midnight mode on a phone viewport, a direct API call is refused by
 * the server, and the page flips to closed on its own when the boundary passes
 * — without a reload.
 *
 * Requires SHUN_LETTER_BROWSER_QA=1, the isolated MySQL fixture and a running
 * Next.js server.
 */

const qa = process.env.SHUN_LETTER_BROWSER_QA === '1'

/** `17:05:` style wall clock in Beijing for scheduling the next boundary. */
function currentBeijingMinute() {
  return beijingMinuteOfDay(new Date())
}

const LIGHT = { width: 390, height: 844 }
const SMALL = { width: 375, height: 812 }

type FixtureUser = Awaited<ReturnType<typeof createFixtureUser>>

async function openContext(browser: Browser, base: string, user: FixtureUser,
  viewport: { width: number; height: number }, theme: 'day' | 'midnight') {
  const token = await createSessionToken(user)
  const context = await browser.newContext({
    viewport, isMobile: true, hasTouch: true, colorScheme: theme === 'midnight' ? 'dark' : 'light',
  })
  await context.addCookies([{ name: authCookieName, value: token, url: base }])
  await context.addInitScript((value) => { try { window.localStorage.setItem('ecfc-theme', value) } catch { /* private */ } }, theme)
  const page = await context.newPage()
  page.setDefaultTimeout(120000)
  return { context, page }
}

async function createFixtureUser() {
  const name = 'v6-open-hours-' + randomUUID()
  return prisma.user.create({ data: {
    username: name, usernameNormalized: name, nickname: name,
    passwordHash: 'fixture', Profile: { create: { displayName: name } },
  } })
}

/** Publishes a window and leaves the game enabled. */
async function publish(operatorId: string, window: { openHoursEnabled: boolean; openTime: string; closeTime: string }) {
  await updateShunConfig(operatorId, { ...defaultShunConfig, ...window })
  await setShunEnabled(operatorId, true)
}

/** A window guaranteed to be closed right now (opens an hour from now). */
function closedNow() {
  const minute = currentBeijingMinute()
  return { openHoursEnabled: true, openTime: formatShunClock((minute + 60) % 1440),
    closeTime: formatShunClock((minute + 120) % 1440) }
}

/** A one-minute window that contains right now and closes at the next minute. */
function closingAtNextMinute() {
  const minute = currentBeijingMinute()
  return { openHoursEnabled: true, openTime: formatShunClock((minute + 1439) % 1440),
    closeTime: formatShunClock((minute + 2) % 1440) }
}

function luminance(rgb: string) {
  const [r, g, b] = (rgb.match(/\d+/g) ?? ['0', '0', '0']).slice(0, 3).map(Number)
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

async function apiAttempt(base: string, user: FixtureUser) {
  const token = await createSessionToken(user)
  const response = await fetch(base + '/api/shun-master/attempt', {
    method: 'POST',
    headers: { Cookie: authCookieName + '=' + token, 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({ requestId: randomUUID() }),
  })
  return { status: response.status, body: await response.json() }
}

test('V6 休息态：文案、禁用按钮与服务端拒绝（390x844 浅色 + 黑夜）', { skip: !qa, timeout: 300000 }, async () => {
  const url = new URL(process.env.DATABASE_URL || '')
  assert.equal(url.pathname, '/ecfc_shun_qa')
  const base = process.env.SHUN_LETTER_BROWSER_BASE || 'http://127.0.0.1:3126'
  const output = process.env.SHUN_LETTER_QA_OUTPUT
  const user = await createFixtureUser()
  const windowSpec = closedNow()
  await publish(user.id, windowSpec)
  const hint = shunOpenHoursHint(windowSpec)
  const label = shunOpenHoursLabel(windowSpec)

  const browser = await chromium.launch({ ...(process.env.SHUN_MASTER_BROWSER_PATH
    ? { executablePath: process.env.SHUN_MASTER_BROWSER_PATH } : {}), headless: true })
  try {
    if (output) await mkdir(output, { recursive: true })
    for (const theme of ['day', 'midnight'] as const) {
      const { context, page } = await openContext(browser, base, user, LIGHT, theme)
      await page.goto(base + '/shun-master')
      await page.waitForFunction(() => document.body.innerText.includes('今日剩余'), undefined, { timeout: 60000 })

      // 主操作区：标题、副文案与每日开放时间全部来自配置。
      await page.getByText('顺大师已加入早睡联盟，正在休息中 💤').waitFor()
      await page.getByText(hint, { exact: true }).waitFor()
      await page.getByText('每日开放时间：' + label, { exact: true }).waitFor()

      // 「顺一手」必须不可用，且不再以可点击文案出现。
      const rest = page.getByRole('button', { name: '休息中 💤' })
      assert.equal(await rest.count(), 1, `${theme}: 必须出现禁用的「休息中 💤」按钮`)
      assert.equal(await rest.isDisabled(), true, `${theme}: 休息中按钮必须禁用`)
      assert.equal(await page.getByRole('button', { name: '顺一手' }).count(), 0, `${theme}: 休息中不得出现「顺一手」`)

      // 休息块在两种主题下都必须可读（前景与背景亮度差足够）。
      const contrast = await page.evaluate(() => {
        const root = Array.from(document.querySelectorAll('[role="status"]'))
          .find((node) => node.textContent?.includes('早睡联盟')) as HTMLElement | undefined
        if (!root) return null
        const strong = root.querySelector('strong') as HTMLElement
        const style = getComputedStyle(strong)
        return { color: style.color, background: getComputedStyle(root).backgroundColor }
      })
      assert.ok(contrast, `${theme}: 必须能定位到休息提示块`)
      assert.ok(Math.abs(luminance(contrast!.color) - luminance(contrast!.background)) > 0.35,
        `${theme}: 休息提示文字对比度不足（${contrast!.color} on ${contrast!.background}）`)
      if (output) await page.screenshot({ path: join(output, `v6-closed-390-${theme}.png`), fullPage: true })

      // 历史记录与玩法说明照常存在：休息只限制新的顺取。
      assert.equal(await page.getByRole('button', { name: '我顺了谁' }).count(), 1, `${theme}: 记录区必须可用`)
      const rules = page.locator('details').filter({ has: page.locator('summary', { hasText: '玩法说明' }) })
      await rules.locator('summary').click()
      await rules.getByText(`顺大师每日开放时间为 ${label}（北京时间），非开放时间无法发起新的顺取，但仍可查看记录及进行抓捕调查。`)
        .waitFor()
      assert.equal(await page.getByRole('button', { name: '永久退出顺大师' }).count(), 1, `${theme}: 退出入口保持不变`)
      await context.close()
    }

    // 直接调用 API 也必须被服务端拒绝：前端禁用只是提示。
    const refused = await apiAttempt(base, user)
    assert.equal(refused.status, 409, '非开放时间的 API 顺取必须被拒绝')
    assert.equal(refused.body.code, 'SHUN_CLOSED')
    assert.match(refused.body.message, /早睡联盟/)
    assert.equal(refused.body.details.openHours.open, false)
    assert.equal(refused.body.details.openHours.label, label)
    assert.ok(refused.body.details.openHours.nextOpenAt, '拒绝必须给出下一次开放时间')
    assert.equal(await prisma.shunMasterRound.count({ where: { actorId: user.id } }), 0, '拒绝不得创建对局')
    assert.equal(await prisma.pointLog.count({ where: { userId: user.id } }), 0, '拒绝不得产生流水')

    // 后台把窗口改成包含当前时间：无需重新部署，刷新即恢复可顺取。
    await publish(user.id, { openHoursEnabled: true, openTime: '00:00', closeTime: '23:59' })
    const { context, page } = await openContext(browser, base, user, LIGHT, 'day')
    await page.goto(base + '/shun-master')
    await page.waitForFunction(() => document.body.innerText.includes('今日剩余'), undefined, { timeout: 60000 })
    await page.getByRole('button', { name: '顺一手' }).waitFor()
    assert.equal(await page.getByText('早睡联盟').count(), 0, '开放时间内不得显示休息提示')
    // 玩法说明切换为全天开放之外的说明仍基于同一份配置。
    const rules = page.locator('details').filter({ has: page.locator('summary', { hasText: '玩法说明' }) })
    await rules.locator('summary').click()
    await rules.getByText('顺大师每日开放时间为 00:00–23:59（北京时间），非开放时间无法发起新的顺取，但仍可查看记录及进行抓捕调查。').waitFor()
    if (output) await page.screenshot({ path: join(output, 'v6-open-390-day.png'), fullPage: true })
    await context.close()
  } finally {
    await browser.close()
    await prisma.$disconnect()
  }
})

test('V6 跨时自动更新：到点自动进入休息态，无需刷新（375x812）', { skip: !qa, timeout: 300000 }, async () => {
  const base = process.env.SHUN_LETTER_BROWSER_BASE || 'http://127.0.0.1:3126'
  const output = process.env.SHUN_LETTER_QA_OUTPUT
  const user = await createFixtureUser()
  const windowSpec = closingAtNextMinute()
  await publish(user.id, windowSpec)

  const browser = await chromium.launch({ ...(process.env.SHUN_MASTER_BROWSER_PATH
    ? { executablePath: process.env.SHUN_MASTER_BROWSER_PATH } : {}), headless: true })
  try {
    const { context, page } = await openContext(browser, base, user, SMALL, 'day')
    await page.goto(base + '/shun-master')
    await page.waitForFunction(() => document.body.innerText.includes('今日剩余'), undefined, { timeout: 60000 })
    // Still open: the take button is live and no rest notice is shown.
    await page.getByRole('button', { name: '顺一手' }).waitFor()
    await page.evaluate(() => { (window as unknown as { __v6sameDoc: number }).__v6sameDoc = 1 })
    if (output) await page.screenshot({ path: join(output, 'v6-before-close-375.png'), fullPage: true })

    // 到点后页面必须自己翻成休息态，且文档没有重载。
    await page.getByRole('button', { name: '休息中 💤' }).waitFor({ timeout: 150000 })
    assert.equal(await page.evaluate(() => (window as unknown as { __v6sameDoc?: number }).__v6sameDoc), 1,
      '休息态必须在不刷新页面的情况下出现')
    assert.equal(await page.getByText('顺大师已加入早睡联盟，正在休息中 💤').count(), 1)
    assert.equal(await page.getByText('每日开放时间：' + shunOpenHoursLabel(windowSpec), { exact: true }).count(), 1)
    assert.equal(await page.getByRole('button', { name: '休息中 💤' }).isDisabled(), true)

    // 移动端不得出现横向溢出。
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true,
      '休息态在 375×812 下不得横向溢出')
    if (output) await page.screenshot({ path: join(output, 'v6-after-close-375.png'), fullPage: true })

    // 此时直接调用 API 同样被拒绝。
    const refused = await apiAttempt(base, user)
    assert.equal(refused.body.code, 'SHUN_CLOSED')
    await context.close()
  } finally {
    await browser.close()
    await prisma.$disconnect()
  }
})

test('V6 后台：开放时间可改、可保存、刷新后仍在，开始=结束被拒绝', { skip: !qa, timeout: 300000 }, async () => {
  const base = process.env.SHUN_LETTER_BROWSER_BASE || 'http://127.0.0.1:3126'
  const output = process.env.SHUN_LETTER_QA_OUTPUT
  const name = 'v6-admin-' + randomUUID()
  const admin = await prisma.user.create({ data: {
    username: name, usernameNormalized: name, nickname: name, role: 'SUPER_ADMIN',
    passwordHash: 'fixture', Profile: { create: { displayName: name } },
  } })
  const player = await createFixtureUser()
  await publish(admin.id, { openHoursEnabled: true, openTime: '09:00', closeTime: '23:00' })

  const browser = await chromium.launch({ ...(process.env.SHUN_MASTER_BROWSER_PATH
    ? { executablePath: process.env.SHUN_MASTER_BROWSER_PATH } : {}), headless: true })
  try {
    const { context, page } = await openContext(browser, base, admin, LIGHT, 'day')
    await page.goto(base + '/admin/shun-master')
    await page.getByRole('heading', { name: '每日开放时间' }).waitFor()
    const openInput = page.getByLabel('每日开放开始时间')
    const closeInput = page.getByLabel('每日开放结束时间')
    assert.equal(await openInput.inputValue(), '09:00')
    assert.equal(await closeInput.inputValue(), '23:00')
    assert.equal(await page.getByLabel('启用开放时间限制').isChecked(), true)
    await page.getByText('时区：北京时间（UTC+8）').waitFor()
    await page.getByText('开启后，用户只能在设定时间内发起新的顺取。历史记录、抓捕调查及已有留言不受限制。').waitFor()

    // 开始与结束时间相同：必须被拦住，且不得写入数据库。
    await openInput.fill('09:00')
    await closeInput.fill('09:00')
    await page.getByRole('button', { name: '保存开放时间' }).click()
    await page.getByText(/开始时间与结束时间不能相同/).waitFor()
    let stored = (await prisma.shunMasterSettings.findUniqueOrThrow({ where: { id: 1 } })).config as { openTime: string; closeTime: string }
    assert.equal(stored.openTime, '09:00')
    assert.equal(stored.closeTime, '23:00', '非法配置不得落库')

    // 改成 10:00–22:00 保存。
    await openInput.fill('10:00')
    await closeInput.fill('22:00')
    await page.getByRole('button', { name: '保存开放时间' }).click()
    await page.getByText('顺大师规则已保存，启停状态未改变。').waitFor()
    stored = (await prisma.shunMasterSettings.findUniqueOrThrow({ where: { id: 1 } })).config as { openTime: string; closeTime: string }
    assert.equal(stored.openTime, '10:00')
    assert.equal(stored.closeTime, '22:00')
    if (output) await page.screenshot({ path: join(output, 'v6-admin-open-hours.png'), fullPage: true })

    // 刷新后台后配置仍在。
    await page.reload()
    await page.getByRole('heading', { name: '每日开放时间' }).waitFor()
    assert.equal(await page.getByLabel('每日开放开始时间').inputValue(), '10:00')
    assert.equal(await page.getByLabel('每日开放结束时间').inputValue(), '22:00')
    await context.close()

    // 前台读同一份配置：玩法说明随之更新（与当前时间无关）。
    const playerContext = await openContext(browser, base, player, SMALL, 'day')
    await playerContext.page.goto(base + '/shun-master')
    await playerContext.page.waitForFunction(() => document.body.innerText.includes('今日剩余'), undefined, { timeout: 60000 })
    const rules = playerContext.page.locator('details').filter({ has: playerContext.page.locator('summary', { hasText: '玩法说明' }) })
    await rules.locator('summary').click()
    await rules.getByText('顺大师每日开放时间为 10:00–22:00（北京时间），非开放时间无法发起新的顺取，但仍可查看记录及进行抓捕调查。').waitFor()
    await playerContext.context.close()
  } finally {
    await browser.close()
    await prisma.$disconnect()
  }
})
