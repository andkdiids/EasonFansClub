import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { chromium } from 'playwright'
import { authCookieName, createSessionToken } from '../lib/auth'
import { prisma } from '../lib/prisma'
import { setShunEnabled, updateShunConfig } from '../lib/shun-master'
import { defaultShunConfig } from '../lib/shun-master-rules'

/**
 * Real-browser acceptance for the permanent opt-out UI on a phone viewport:
 * hidden until rules expanded, entry at the very bottom, checkbox-gated double
 * confirmation, cancel is a no-op, and the confirmed state survives reload.
 * Requires SHUN_LETTER_BROWSER_QA=1 and a running Next.js dev server.
 */
test('permanent opt-out browser flow', {
  skip: process.env.SHUN_LETTER_BROWSER_QA !== '1', timeout: 300000,
}, async () => {
  const url = new URL(process.env.DATABASE_URL || '')
  assert.equal(url.pathname, '/ecfc_shun_qa')
  const base = process.env.SHUN_LETTER_BROWSER_BASE || 'http://127.0.0.1:3126'
  const output = process.env.SHUN_LETTER_QA_OUTPUT
  const name = 'v41-optout-' + randomUUID()
  const user = await prisma.user.create({ data: {
    username: name, usernameNormalized: name, nickname: name,
    passwordHash: 'fixture', Profile: { create: { displayName: name } },
  } })
  const token = await createSessionToken(user)
  await updateShunConfig(user.id, { ...defaultShunConfig, enabled: false })
  await setShunEnabled(user.id, true)

  const browser = await chromium.launch({ ...(process.env.SHUN_MASTER_BROWSER_PATH
    ? { executablePath: process.env.SHUN_MASTER_BROWSER_PATH } : {}), headless: true })
  try {
    if (output) await mkdir(output, { recursive: true })
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    await context.addCookies([{ name: authCookieName, value: token, url: base }])
    const page = await context.newPage()
    page.setDefaultTimeout(120000)
    await page.goto(base + '/shun-master')
    // Wait for client hydration + status fetch before probing the DOM.
    await page.waitForFunction(() => document.body.innerText.includes('今日剩余'), undefined, { timeout: 60000 })

    // The rules block is collapsed by default and holds no exit entry.
    const rules = page.locator('details').filter({ has: page.locator('summary', { hasText: '玩法说明' }) })
    assert.equal(await rules.evaluate((el: HTMLDetailsElement) => el.open), false, '玩法说明必须默认折叠')
    assert.equal(await page.getByRole('button', { name: '永久退出顺大师' }).count(), 0,
      '折叠状态下不得显示退出入口')

    // Expand: the entry appears and is the very last element in the rules block.
    await rules.locator('summary').click()
    const exitLink = page.getByRole('button', { name: '永久退出顺大师' })
    await exitLink.waitFor()
    const isLast = await rules.evaluate((el: HTMLDetailsElement) => {
      const buttons = Array.from(el.querySelectorAll('button'))
      const link = buttons.find((b) => b.textContent?.includes('永久退出顺大师'))
      return !!link && link === buttons[buttons.length - 1] // the only button inside the rules block
    })
    assert.equal(isLast, true, '退出入口必须位于玩法说明最底部')
    if (output) await page.screenshot({ path: join(output, 'opt-out-rules-expanded.png') })

    // Cancel keeps participation and the checkbox gating works.
    await exitLink.click()
    const dialog = page.getByRole('dialog', { name: '确定永久退出顺大师？' })
    await dialog.waitFor()
    const confirm = dialog.getByRole('button', { name: '确认永久退出' })
    assert.equal(await confirm.isDisabled(), true, '未勾选时确认按钮必须禁用')
    await dialog.getByRole('button', { name: '取消' }).click()
    await dialog.waitFor({ state: 'detached' })
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).permanentlyOptedOutAt, null,
      '取消不得改变状态')
    assert.equal(await page.getByRole('button', { name: '顺一手' }).count(), 1, '取消后仍可参与')
    if (output) await page.screenshot({ path: join(output, 'opt-out-cancelled.png') })

    // Confirm: check the box, submit, and the durable state shows on reload.
    await page.getByRole('button', { name: '永久退出顺大师' }).click()
    await dialog.waitFor()
    await dialog.getByRole('checkbox').check()
    assert.equal(await confirm.isDisabled(), false, '勾选后确认按钮必须可用')
    if (output) await page.screenshot({ path: join(output, 'opt-out-confirm.png') })
    await confirm.click()
    await page.getByText('你已永久退出顺大师').first().waitFor()
    await page.getByRole('button', { name: '顺一手' }).waitFor({ state: 'detached', timeout: 30000 })
    assert.equal(await page.getByRole('button', { name: '顺一手' }).count(), 0, '退出后顺一手必须消失')
    assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).permanentlyOptedOutAt, '服务端必须持久化退出')
    if (output) await page.screenshot({ path: join(output, 'opt-out-done.png') })

    // Reload: still opted out, no rejoin surface.
    await page.reload()
    await page.getByText('你已永久退出顺大师').first().waitFor()
    assert.equal(await page.getByRole('button', { name: '顺一手' }).count(), 0, '刷新后仍不可参与')
    assert.equal(await page.getByRole('button', { name: '永久退出顺大师' }).count(), 0,
      '退出后玩法说明内不得再有退出/重新加入按钮')
    await context.close()
  } finally {
    await browser.close()
    await prisma.$disconnect()
  }
})
