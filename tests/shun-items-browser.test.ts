import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { chromium } from 'playwright'
import { authCookieName, createSessionToken } from '../lib/auth'
import { prisma } from '../lib/prisma'
import { lockShunItemUsers, postShunItemMovement } from '../lib/shun-item-inventory'
import { shunTransaction } from '../lib/shun-master'
import { shunDay } from '../lib/shun-master-rules'

test('V4.2 authenticated PC and H5 item box, randomized gifting and refresh', {
  skip: process.env.SHUN_ITEMS_BROWSER_QA !== '1',
  timeout: 180_000,
}, async () => {
  const url = new URL(process.env.DATABASE_URL ?? '')
  assert.equal(url.hostname, '127.0.0.1')
  assert.equal(url.pathname, '/ecfc_shun_items_fixture_qa')
  const base = process.env.SHUN_ITEMS_BROWSER_BASE ?? 'http://127.0.0.1:3127'
  assert.equal(new URL(base).hostname, '127.0.0.1')
  const output = process.env.SHUN_ITEMS_QA_OUTPUT
  assert.ok(output)
  await mkdir(output, { recursive: true })
  const fixture = async () => {
    const nickname = 'V42Browser-' + randomUUID().slice(0, 8)
    return prisma.user.create({ data: {
      username: nickname, usernameNormalized: nickname.toLowerCase(), nickname, passwordHash: 'fixture',
      Profile: { create: { displayName: nickname } },
    } })
  }
  const [sender, receiver] = await Promise.all([fixture(), fixture()])
  const [userAId, userBId] = [sender.id, receiver.id].sort()
  await prisma.friendship.create({ data: { userAId, userBId } })
  const active = await prisma.shunItemConfigVersion.findFirstOrThrow({ orderBy: { version: 'desc' } })
  assert.equal(active.enabled, true)
  await shunTransaction(async (tx) => {
    await lockShunItemUsers(tx, [sender.id])
    for (const code of ['EXTRA_ATTEMPT', 'FRIEND_GIFT'] as const) await postShunItemMovement(tx, {
      userId: sender.id, code, type: 'DAILY_MAIN', day: shunDay(new Date()),
      requestKey: 'browser-' + code, configVersion: active.version,
    })
  })
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.SHUN_ITEMS_BROWSER_PATH ? { executablePath: process.env.SHUN_ITEMS_BROWSER_PATH } : {}),
  })
  try {
    for (const [label, width, height] of [['pc', 1440, 960], ['h5', 390, 844], ['h5-small', 360, 780]] as const) {
      const context = await browser.newContext({ viewport: { width, height }, isMobile: label !== 'pc', hasTouch: label !== 'pc' })
      try {
        await context.addCookies([{ name: authCookieName, value: await createSessionToken(sender), url: base }])
        const page = await context.newPage()
        await page.goto(base + '/shun-master?items=1')
        const box = page.getByRole('dialog', { name: /百宝箱/ })
        await box.waitFor()
        assert.equal(await box.getByRole('list', { name: '道具图鉴' }).getByRole('listitem').count(), 7)
        const boxFits = await box.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)
        assert.ok(boxFits, label + ' horizontal overflow')
        if (label === 'pc') {
          await box.getByRole('button', { name: '随机赠送' }).click()
          await box.getByText('幸运已经送达！').waitFor()
          await box.getByText(new RegExp(receiver.nickname)).waitFor()
          assert.equal(await box.getByRole('region', { name: '通讯录好友' }).count(), 0)
          await page.screenshot({ path: join(output, 'v42-pc-gift.png') })
          await box.getByRole('button', { name: '使用', exact: true }).click()
          await box.getByRole('listitem').filter({ hasText: '顺手牵羊' }).getByText('持有 0').first().waitFor()
          assert.equal((await prisma.shunItemDaily.findUniqueOrThrow({
            where: { userId_day: { userId: sender.id, day: shunDay(new Date()) } },
          })).extraAttemptsGranted, 1)
          assert.equal(await prisma.shunItemGift.count({ where: { senderId: sender.id, receiverId: receiver.id } }), 1)
        } else {
          await box.getByText(/送出礼物/).waitFor()
        }
        await page.screenshot({ path: join(output, 'v42-' + label + '-box.png') })
      } finally {
        await context.close()
      }
    }

    await prisma.user.update({ where: { id: sender.id }, data: { points: 20 } })
    await prisma.user.update({ where: { id: receiver.id }, data: { points: 50 } })
    await shunTransaction(async (tx) => {
      await lockShunItemUsers(tx, [sender.id, receiver.id])
      for (const [userId, code] of [[sender.id, 'TARGET_FRIEND'], [receiver.id, 'RETRY_CAPTURE'], [receiver.id, 'REVENGE']] as const) {
        await postShunItemMovement(tx, {
          userId, code, type: 'DAILY_MAIN', day: shunDay(new Date()),
          requestKey: 'browser-' + code, configVersion: active.version,
        })
      }
    })
    const actorContext = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' })
    const victimContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
    try {
      await actorContext.addCookies([{ name: authCookieName, value: await createSessionToken(sender), url: base }])
      const actorPage = await actorContext.newPage()
      await actorPage.goto(base + '/shun-master?items=1')
      const itemBox = actorPage.getByRole('dialog', { name: /百宝箱/ })
      await itemBox.getByRole('button', { name: '选择好友', exact: true }).click()
      await itemBox.getByRole('button', { name: receiver.nickname, exact: true }).click()
      const result = actorPage.getByRole('dialog', { name: '顺走啦！' })
      await result.getByRole('button', { name: '不留言并再顺一手' }).waitFor()
      await result.getByRole('button', { name: '匿名留言', exact: true }).click()
      await actorPage.getByRole('textbox', { name: '匿名留言内容' }).fill('隔离测试中的匿名留言')
      await actorPage.getByRole('button', { name: '发送匿名留言' }).click()
      const round = await prisma.shunMasterRound.findFirstOrThrow({
        where: { actorId: sender.id, victimId: receiver.id }, orderBy: { createdAt: 'desc' },
      })
      assert.equal(await prisma.shunItemRoundEffect.count({ where: { roundId: round.id, code: 'TARGET_FRIEND' } }), 1)
      await actorPage.getByText('留言已送达', { exact: false }).first().waitFor()

      await victimContext.addCookies([{ name: authCookieName, value: await createSessionToken(receiver), url: base }])
      const victimPage = await victimContext.newPage()
      await victimPage.goto(base + '/shun-master?record=' + round.id)
      const card = victimPage.locator('#shun-record-' + round.id)
      await card.getByRole('button', { name: '立即调查' }).click()
      const investigation = card.getByRole('region', { name: '抓捕追回' })
      await investigation.waitFor()
      assert.equal(await investigation.getByRole('radio').count(), 2)
      await victimPage.screenshot({ path: join(output, 'v42-h5-inline-investigation.png') })
      await investigation.locator('label').filter({ hasNotText: sender.nickname }).getByRole('radio').check()
      await investigation.getByRole('button', { name: '确认抓捕' }).click()
      await card.getByText('让 TA 溜了！').waitFor()
      await card.getByRole('button', { name: '使用时光倒流' }).click()
      await card.getByText(/时光倒流 · 已追回/).waitFor()
      await card.getByRole('button', { name: '使用最佳损友' }).click()
      await card.getByText(/最佳损友 · 反击/).waitFor()
      await victimPage.screenshot({ path: join(output, 'v42-h5-record-effects.png') })
      await victimPage.reload()
      await card.getByText(/时光倒流 · 已追回/).waitFor()
      await card.getByText(/最佳损友 · 反击/).waitFor()
    } finally {
      await actorContext.close()
      await victimContext.close()
    }
  } finally {
    await browser.close()
    await prisma.$disconnect()
  }
})
