import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { chromium } from 'playwright'
import { authCookieName, createSessionToken } from '../lib/auth'
import { prisma } from '../lib/prisma'
import { setShunEnabled, shunAttempt, shunSendNotification, updateShunConfig } from '../lib/shun-master'
import { defaultShunConfig } from '../lib/shun-master-rules'

/**
 * Real click-through of the notification surfaces: the recipient must reach the
 * letter from the notification center itself, not only from a hand-built URL.
 *
 * Runs against an isolated MySQL fixture plus a real Next.js server, so it never
 * touches production data or a real user's registration fee.
 * 运行方式：与其它浏览器/集成用例共享同一个隔离库（ecfc_shun_qa），需串行执行：
 * `tsx --test --test-concurrency=1`。
 */
test('notification center opens the anonymous letter and jumps straight into the capture picker', {
  skip: process.env.SHUN_LETTER_BROWSER_QA !== '1', timeout: 240000,
}, async () => {
  const url = new URL(process.env.DATABASE_URL || '')
  assert.equal(url.hostname, '127.0.0.1')
  assert.equal(url.port, process.env.GITHUB_ACTIONS === 'true' ? '3306' : '33326')
  assert.equal(url.pathname, '/ecfc_shun_qa')
  const base = process.env.SHUN_LETTER_BROWSER_BASE || 'http://127.0.0.1:3126'
  const create = (points = 0) => {
    const name = 'letter-qa-' + randomUUID()
    return prisma.user.create({ data: { username: name, usernameNormalized: name, nickname: name,
      points, passwordHash: 'fixture', Profile: { create: { displayName: name } } } })
  }
  const MESSAGE = '范范Vanessa：这句话只有你能看到\n第二行也要完整显示'

  const [admin, actor, victim, ...decoys] = await Promise.all([
    create(), create(0), create(40), create(), create(), create(), create(),
  ])
  const outsiders = await prisma.user.findMany({
    where: { id: { notIn: [admin.id, actor.id, victim.id, ...decoys.map(({ id }) => id)] } }, select: { id: true },
  })
  // Make every unrelated account un-shunnable so the round must land on our
  // victim, while leaving the decoys unprotected so the capture pool is legal.
  await prisma.shunMasterProtection.createMany({
    data: [...outsiders, admin, actor].map(({ id: userId }) => ({ userId, protected: true })), skipDuplicates: true,
  })
  await updateShunConfig(admin.id, { ...defaultShunConfig, enabled: false })
  await setShunEnabled(admin.id, true)

  const outcome = await shunAttempt(actor.id, randomUUID())
  assert.equal(outcome.person?.uid, victim.uid, '本次顺取必须命中夹具收件人')
  // The letter is a separate, later decision now: it is what actually notifies
  // the victim and what starts the golden capture window.
  await shunSendNotification(actor.id, outcome.id, MESSAGE)
  const round = await prisma.shunMasterRound.findUniqueOrThrow({ where: { id: outcome.id } })
  assert.equal(round.victimId, victim.id)
  assert.equal(round.notifyStatus, 'SENT_LETTER')

  const notice = await prisma.notification.findFirstOrThrow({ where: { recipientId: victim.id, key: { contains: 'taken-letter' } } })
  assert.equal(notice.type, 'SYSTEM', '匿名信通知沿用 SYSTEM 类型（正是历史缺陷的触发条件）')
  assert.ok(notice.link?.includes('letter=1'), '通知必须携带信件标记')

  const victimToken = await createSessionToken(victim)
  const actorToken = await createSessionToken(actor)
  const executablePath = process.env.SHUN_MASTER_BROWSER_PATH
  const browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true })
  const output = process.env.SHUN_LETTER_QA_OUTPUT

  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await context.addCookies([{ name: authCookieName, value: victimToken, url: base }])
    const page = await context.newPage()
    // First hit compiles the route on demand; give it room without weakening assertions.
    page.setDefaultTimeout(120000)
    page.setDefaultNavigationTimeout(120000)
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    page.on('console', (message) => { if (message.type() === 'error') pageErrors.push(message.text()) })
    await page.goto(base + '/notifications')
    const card = page.locator('#notification-' + notice.id)
    await card.waitFor()
    const tile = card.locator('article')
    assert.equal(await tile.getAttribute('role'), 'link', '匿名信卡片必须是导航卡片，而不是普通系统通知按钮')
    await card.getByText('打开神秘来信', { exact: false }).waitFor()

    // ---- click the notification itself: detail with both entries -----------
    await tile.click()
    const detail = page.getByRole('dialog').filter({ hasText: '你收到一封神秘来信' })
    await detail.waitFor()
    // 本次升级的核心：带信的通知也必须同时给出「前往调查」。
    await detail.getByRole('button', { name: '打开神秘来信' }).waitFor()
    await detail.getByRole('button', { name: '前往调查' }).waitFor()
    await detail.getByRole('button', { name: '关闭', exact: true }).waitFor()
    // 打开详情触发的已读是一次独立请求，给它一个明确的完成窗口，而不是立刻断言。
    const readDeadline = Date.now() + 15_000
    let readAt = (await prisma.notification.findUniqueOrThrow({ where: { id: notice.id } })).readAt
    while (!readAt && Date.now() < readDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      readAt = (await prisma.notification.findUniqueOrThrow({ where: { id: notice.id } })).readAt
    }
    assert.ok(readAt, '点击后通知必须落已读')
    await detail.getByRole('button', { name: '打开神秘来信' }).click()
    await page.waitForURL(/\/shun-master\?record=[a-z0-9]+&side=in&letter=1/)

    // ---- letter animation, then the real body ------------------------------
    const letterDialog = page.getByRole('dialog').filter({ hasText: '一封来自神秘 EF 的信' })
    await letterDialog.waitFor()
    const stage = page.locator('[data-stage]').first()
    await stage.waitFor()
    assert.notEqual(await stage.getAttribute('data-stage'), 'open', '首屏必须从飞入阶段开始（有动画）')
    await page.getByRole('button', { name: '跳过动画' }).click()
    await stage.waitFor()
    assert.equal(await stage.getAttribute('data-stage'), 'open')
    await letterDialog.getByText('范范Vanessa：这句话只有你能看到').waitFor()
    await letterDialog.getByText('第二行也要完整显示').waitFor()
    await letterDialog.getByText('—— 一位神秘的 EF').waitFor()
    // 信纸必须完全展开成不透明白纸（否则正文会被页面内容穿透）
    await page.waitForFunction(() => {
      const paper = document.querySelector<HTMLElement>('[class*="paper"]')
      return !!paper && Number(getComputedStyle(paper).opacity) === 1
    })
    // 匿名身份：不出现发送者昵称
    assert.equal(await letterDialog.getByText(actor.nickname, { exact: true }).count(), 0, '不得泄露发送者')
    if (output) { await mkdir(output, { recursive: true }); await page.screenshot({ path: join(output, 'letter-desktop.png') }) }

    // ---- 立即调查 jumps straight into the capture picker -------------------
    const goldenBefore = round.goldenUntil.toISOString()
    await letterDialog.getByRole('button', { name: '立即调查' }).click()
    await page.getByRole('region', { name: '抓捕追回' }).waitFor()
    await page.getByRole('group', { name: '选择一位 EF' }).waitFor()
    assert.equal(await page.getByRole('radio').count(), 2, '黄金期内必须保留二选一')
    assert.equal(await page.getByText(/抓到你啦|让 TA 溜了/).count(), 0, '前往调查不得自动提交答案')
    assert.equal((await prisma.shunMasterRound.findUniqueOrThrow({ where: { id: round.id } })).goldenUntil.toISOString(),
      goldenBefore, '看信与调查入口不得重置黄金抓捕倒计时')
    // 已抓捕/结果未知前，不得产生任何抓捕结算
    assert.equal((await prisma.shunMasterRound.findUniqueOrThrow({ where: { id: round.id } })).result, null)
    if (output) await page.screenshot({ path: join(output, 'capture-picker.png') })

    // ---- refresh: no replay, but the letter stays reachable ----------------
    await page.goto(base + '/shun-master?record=' + round.id + '&side=in')
    const reread = page.getByRole('button', { name: '查看神秘来信' })
    await reread.waitFor()
    await page.reload()
    assert.equal(await page.getByRole('dialog').filter({ hasText: '一封来自神秘 EF 的信' }).count(), 0,
      '刷新普通记录页不得自动弹信')
    await page.getByRole('button', { name: '查看神秘来信' }).click()
    const rereadDialog = page.getByRole('dialog').filter({ hasText: '一封来自神秘 EF 的信' })
    await rereadDialog.waitFor()
    assert.equal(await page.locator('[data-stage]').first().getAttribute('data-stage'), 'open',
      '再次查看必须直接展示信纸，不重播飞入动画')
    await rereadDialog.getByText('范范Vanessa：这句话只有你能看到').waitFor()
    await rereadDialog.getByRole('button', { name: '收下这封信' }).click()
    await rereadDialog.waitFor({ state: 'hidden' })
    assert.equal((await prisma.shunMasterAnonymousLetter.findFirstOrThrow({ where: { roundId: round.id } })).content, MESSAGE,
      '收下这封信不得删除匿名留言')
    assert.deepEqual(pageErrors.filter((error) => !/favicon|404 \(Not Found\)/i.test(error)), [],
      '信件与调查入口流程中不得出现前端错误')
    await context.close()

    // ---- non-recipient never sees the letter ------------------------------
    const other = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    await other.addCookies([{ name: authCookieName, value: actorToken, url: base }])
    const page2 = await other.newPage()
    await page2.goto(base + '/shun-master?record=' + round.id + '&side=in&letter=1')
    await page2.waitForLoadState('networkidle')
    assert.equal(await page2.getByRole('dialog').filter({ hasText: '一封来自神秘 EF 的信' }).count(), 0,
      '非收件人打开信件链接不得看到任何信件')
    const api = await page2.evaluate(async (id) => (await fetch('/api/shun-master/letter/' + id)).status, round.id)
    assert.equal(api, 404, '非收件人读取接口必须 404')
    await other.close()

    // ---- mobile: letter visible and CTA reachable -------------------------
    const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    await mobile.addCookies([{ name: authCookieName, value: victimToken, url: base }])
    const phone = await mobile.newPage()
    phone.setDefaultTimeout(120000)
    phone.setDefaultNavigationTimeout(120000)
    await phone.goto(base + '/notifications')
    const phoneCard = phone.locator('#notification-' + notice.id)
    await phoneCard.waitFor()
    await phoneCard.locator('article').click()
    const phoneDetail = phone.getByRole('dialog').filter({ hasText: '你收到一封神秘来信' })
    await phoneDetail.waitFor()
    // 小屏同样必须先给出两个入口，再进信件。
    const phoneInvestigate = phoneDetail.getByRole('button', { name: '前往调查' })
    const investBox = await phoneInvestigate.boundingBox()
    assert.ok(investBox && investBox.y + investBox.height <= 844, '小屏不得遮挡「前往调查」按钮')
    await phoneDetail.getByRole('button', { name: '打开神秘来信' }).click()
    await phone.waitForURL(/letter=1/)
    const phoneLetter = phone.getByRole('dialog').filter({ hasText: '一封来自神秘 EF 的信' })
    await phoneLetter.waitFor()
    await phone.getByRole('button', { name: '跳过动画' }).click()
    await phoneLetter.getByText('范范Vanessa：这句话只有你能看到').waitFor()
    await phone.waitForFunction(() => {
      const paper = document.querySelector<HTMLElement>('[class*="paper"]')
      return !!paper && Number(getComputedStyle(paper).opacity) === 1
    })
    const cta = phoneLetter.getByRole('button', { name: '立即调查' })
    const box = await cta.boundingBox()
    assert.ok(box && box.y + box.height <= 844, '小屏不得遮挡「立即调查」按钮')
    if (output) await phone.screenshot({ path: join(output, 'letter-mobile.png') })
    await mobile.close()
  } finally {
    await browser.close()
    await prisma.shunMasterProtection.deleteMany({ where: { userId: { in: [admin.id, actor.id, victim.id, ...decoys.map(({ id }) => id)] } } })
    await prisma.$disconnect()
  }
})
