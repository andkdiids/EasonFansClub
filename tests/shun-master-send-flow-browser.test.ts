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
import { formatUid } from '../lib/uid'

/**
 * Real click-through of the new sending order: 顺一手 transfers immediately,
 * the actor sees who was hit, and only then decides between a letter and the
 * ordinary notice. Also checks the delivery animation runs after the server
 * confirmed the letter, and that "返回" never starts a second take.
 *
 * Isolated MySQL fixture + real Next.js server; never touches production data
 * or a real user's registration fee.
 * 运行方式：与其它浏览器/集成用例共享同一个隔离库（ecfc_shun_qa），需串行执行：
 * `tsx --test --test-concurrency=1`。
 */
test('顺一手 transfers first, then the result dialog decides the notification', {
  skip: process.env.SHUN_LETTER_BROWSER_QA !== '1', timeout: 300000,
}, async () => {
  const url = new URL(process.env.DATABASE_URL || '')
  assert.equal(url.hostname, '127.0.0.1')
  assert.equal(url.port, process.env.GITHUB_ACTIONS === 'true' ? '3306' : '33326')
  assert.equal(url.pathname, '/ecfc_shun_qa')
  const base = process.env.SHUN_LETTER_BROWSER_BASE || 'http://127.0.0.1:3126'
  const output = process.env.SHUN_LETTER_QA_OUTPUT
  const create = (points = 0) => {
    const name = 'send-qa-' + randomUUID()
    return prisma.user.create({ data: { username: name, usernameNormalized: name, nickname: name,
      points, passwordHash: 'fixture', Profile: { create: { displayName: name } } } })
  }
  // Every fixture account starts with no balance: only the intended victim is
  // funded right before its scenario, which keeps the draw deterministic without
  // relying on durable protections (those can never be undone).
  const [admin, actor, victim, actor2, victim2, ...decoys] = await Promise.all([
    create(), create(), create(), create(), create(), create(), create(), create(), create(),
  ])
  await prisma.user.update({ where: { id: victim.id }, data: { points: 40 } })
  const outsiders = await prisma.user.findMany({
    where: { id: { notIn: [admin.id, actor.id, victim.id, actor2.id, victim2.id, ...decoys.map(({ id }) => id)] } },
    select: { id: true },
  })
  await prisma.shunMasterProtection.createMany({
    data: [...outsiders, admin].map(({ id: userId }) => ({ userId, protected: true })), skipDuplicates: true,
  })
  await updateShunConfig(admin.id, { ...defaultShunConfig, enabled: false })
  await setShunEnabled(admin.id, true)

  const executablePath = process.env.SHUN_MASTER_BROWSER_PATH
  const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true })
  try {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    await context.addCookies([{ name: authCookieName, value: await createSessionToken(actor), url: base }])
    const page = await context.newPage()
    page.setDefaultTimeout(120000)
    page.setDefaultNavigationTimeout(120000)
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error') pageErrors.push(message.text()) })

    await page.goto(base + '/shun-master')
    await page.getByRole('button', { name: '顺一手' }).click()

    // ---- the result dialog names the target before any decision ------------
    const result = page.getByRole('dialog', { name: '顺走啦！' })
    await result.waitFor()
    await result.getByText(victim.nickname, { exact: true }).waitFor()
    await result.getByText('UID ' + formatUid(victim.uid), { exact: true }).waitFor()
    const amountLabel = await result.locator('strong').first().innerText()
    assert.match(amountLabel, /^\+\d+ 挂号费$/, '结果弹窗必须展示本次顺走的挂号费')
    for (const label of ['匿名留言', '不留言', '关闭']) {
      await result.getByRole('button', { name: label, exact: true }).waitFor()
    }
    const round = await prisma.shunMasterRound.findFirstOrThrow({ where: { actorId: actor.id } })
    assert.equal(round.victimId, victim.id)
    assert.equal(round.notifyStatus, 'PENDING', '顺取后先待通知')
    assert.equal(await prisma.notification.count({ where: { recipientId: victim.id } }), 0,
      '玩家做选择前不得通知被顺者')
    if (output) { await mkdir(output, { recursive: true }); await page.screenshot({ path: join(output, 'send-result.png') }) }

    // ---- 返回 只回到结果页，不重新顺取 --------------------------------------
    await result.getByRole('button', { name: '匿名留言', exact: true }).click()
    await page.getByRole('dialog', { name: '给 TA 留一句匿名的话' }).waitFor()
    await page.getByRole('button', { name: '返回', exact: true }).click()
    await page.getByRole('dialog', { name: '顺走啦！' }).waitFor()
    assert.equal(await result.locator('strong').first().innerText(), amountLabel, '返回不得改变金额')
    assert.equal(await prisma.shunMasterRound.count({ where: { actorId: actor.id } }), 1, '返回不得重新顺取')

    // ---- 不留言 sends the ordinary notice ----------------------------------
    await result.getByRole('button', { name: '不留言', exact: true }).click()
    await result.waitFor({ state: 'hidden' })
    const plainNotice = await prisma.notification.findFirstOrThrow({ where: { key: `shun:${round.id}:taken` } })
    assert.equal(plainNotice.title, '你的挂号费被顺走啦！')
    assert.equal(plainNotice.link, `/shun-master?record=${round.id}&side=in`)
    assert.equal((await prisma.shunMasterRound.findUniqueOrThrow({ where: { id: round.id } })).notifyStatus, 'SENT_PLAIN')

    // ---- 匿名留言, then the delivery animation -----------------------------
    // Move the only spendable balance to the second victim so the draw is pinned.
    await prisma.user.updateMany({ where: { id: { in: [victim.id, actor.id] } }, data: { points: 0 } })
    await prisma.user.update({ where: { id: victim2.id }, data: { points: 40 } })
    await context.addCookies([{ name: authCookieName, value: await createSessionToken(actor2), url: base }])
    const page2 = await context.newPage()
    page2.setDefaultTimeout(120000)
    page2.setDefaultNavigationTimeout(120000)
    page2.on('pageerror', (error) => pageErrors.push(error.message))
    await page2.goto(base + '/shun-master')
    await page2.getByRole('button', { name: '顺一手' }).click()
    const result2 = page2.getByRole('dialog', { name: '顺走啦！' })
    await result2.waitFor()
    await result2.getByText(victim2.nickname, { exact: true }).waitFor()
    const round2 = await prisma.shunMasterRound.findFirstOrThrow({ where: { actorId: actor2.id } })
    await result2.getByRole('button', { name: '匿名留言', exact: true }).click()

    const composer = page2.getByRole('dialog', { name: '给 TA 留一句匿名的话' })
    await composer.waitFor()
    await composer.getByText(victim2.nickname, { exact: true }).waitFor()
    const message = '这句话只有你能看到\n第二行也要完整显示'
    await composer.getByLabel('匿名留言内容').fill(message)
    assert.equal(await prisma.shunMasterAnonymousLetter.count({ where: { roundId: round2.id } }), 0,
      '输入期间不得提前落库')
    await composer.getByRole('button', { name: '发送留言', exact: true }).click()

    // the animation only starts once the server confirmed the letter
    await page2.locator('[data-stage]').first().waitFor()
    assert.equal((await prisma.shunMasterRound.findUniqueOrThrow({ where: { id: round2.id } })).notifyStatus, 'SENT_LETTER')
    assert.equal((await prisma.shunMasterAnonymousLetter.findUniqueOrThrow({ where: { roundId: round2.id } })).content, message)
    const notice2 = await prisma.notification.findFirstOrThrow({ where: { key: `shun:${round2.id}:taken-letter` } })
    assert.equal(notice2.link, `/shun-master?record=${round2.id}&side=in&letter=1`)
    assert.equal(await prisma.notification.count({ where: { key: `shun:${round2.id}:taken` } }), 0,
      '有留言时不得再发普通通知')
    if (output) await page2.screenshot({ path: join(output, 'send-animation.png') })

    await page2.getByRole('button', { name: '跳过动画' }).click()
    await page2.getByRole('dialog', { name: '匿名信已送达 ✉️' }).waitFor()
    await page2.getByRole('button', { name: '返回顺大师', exact: true }).waitFor()
    assert.equal(await prisma.shunMasterAnonymousLetter.count({ where: { roundId: round2.id } }), 1,
      '跳过动画不得重复发送')
    assert.deepEqual(pageErrors.filter((error) => !/favicon|404 \(Not Found\)/i.test(error)), [],
      '发送流程不得出现前端错误')

    await context.close()
  } finally {
    await browser.close()
    await prisma.shunMasterProtection.deleteMany({ where: { userId: { in: [admin.id, actor.id, victim.id, actor2.id, victim2.id, ...decoys.map(({ id }) => id)] } } })
    await prisma.$disconnect()
  }
})
