import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { chromium } from 'playwright'
import { authCookieName, createSessionToken } from '../lib/auth'
import { prisma } from '../lib/prisma'
import { validateShunItemDraft } from '../lib/shun-item-config'
import { runShunItemRewardSweep } from '../lib/shun-item-rewards'
import { lockShunItemUsers, postShunItemMovement } from '../lib/shun-item-inventory'
import { shunTransaction, updateShunConfig } from '../lib/shun-master'
import { shunDay, validateShunConfig } from '../lib/shun-master-rules'

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
  const fixture = async (points = 0) => {
    const nickname = 'V42Browser-' + randomUUID().slice(0, 8)
    return prisma.user.create({ data: {
      username: nickname, usernameNormalized: nickname.toLowerCase(), nickname, passwordHash: 'fixture', points,
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
          const forbidden = await context.request.post(base + '/api/shun-master/gift', {
            headers: { Origin: base }, data: { requestId: randomUUID(), friendId: receiver.id },
          })
          assert.equal(forbidden.status(), 400)
          assert.equal((await context.request.get(base + '/api/admin/shun-master/items')).status(), 403)
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
    const unfundedFriend = await fixture()
    const [unfundedA, unfundedB] = [sender.id, unfundedFriend.id].sort()
    await prisma.friendship.create({ data: { userAId: unfundedA, userBId: unfundedB } })
    const actorContext = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' })
    const victimContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
    try {
      await actorContext.addCookies([{ name: authCookieName, value: await createSessionToken(sender), url: base }])
      const actorPage = await actorContext.newPage()
      await actorPage.goto(base + '/shun-master?items=1')
      const itemBox = actorPage.getByRole('dialog', { name: /百宝箱/ })
      await itemBox.getByRole('button', { name: '选择好友', exact: true }).click()
      assert.ok(await itemBox.getByRole('button', { name: unfundedFriend.nickname + ' · 暂不可顺取' }).isDisabled())
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
    const admin = await fixture()
    const operator = await prisma.user.update({ where: { id: admin.id }, data: { role: 'SUPER_ADMIN' } })
    const adminContext = await browser.newContext({ viewport: { width: 1440, height: 960 } })
    try {
      await adminContext.addCookies([{ name: authCookieName, value: await createSessionToken(operator), url: base }])
      const adminPage = await adminContext.newPage()
      await adminPage.goto(base + '/admin/shun-master')
      const management = adminPage.getByRole('region', { name: '顺大师道具管理' })
      await management.getByRole('textbox', { name: '道具配置' }).waitFor()
      await management.getByRole('textbox', { name: '用户 ID' }).fill(sender.id)
      await management.getByRole('button', { name: '查询库存和流水' }).click()
      const gifts = management.locator('details').filter({ hasText: '好友赠送' })
      await gifts.locator('summary').click()
      await gifts.getByText(sender.id, { exact: false }).waitFor()
      await management.getByRole('button', { name: '保存新版本' }).click()
      await management.getByText(/道具配置版本 .* 已保存/).waitFor()
      assert.equal(await prisma.userOperationLog.count({
        where: { operatorUserId: operator.id, category: 'SHUN_MASTER', action: 'ITEM_CONFIG_UPDATE' },
      }), 1)
      await adminPage.screenshot({ path: join(output, 'v42-pc-admin-items.png'), fullPage: true })
    } finally {
      await adminContext.close()
    }

    const game = validateShunConfig((await prisma.shunMasterSettings.findUniqueOrThrow({ where: { id: 1 } })).config)
    assert.ok(game)
    const fundedBefore = await prisma.user.findMany({ where: { points: { gt: 0 } }, select: { id: true } })
    const [doubler, firstTarget, secondTarget] = await Promise.all([fixture(), fixture(30), fixture()])
    if (fundedBefore.length) await prisma.block.createMany({
      data: fundedBefore.map(({ id }) => ({ blockerId: doubler.id, blockedId: id })),
    })
    await shunTransaction(async (tx) => {
      await lockShunItemUsers(tx, [doubler.id])
      await postShunItemMovement(tx, {
        userId: doubler.id, code: 'DOUBLE_AMOUNT', type: 'DAILY_MAIN', day: shunDay(new Date()),
        requestKey: 'browser-double', configVersion: active.version,
      })
    })
    await updateShunConfig(operator.id, { ...game, attempts: 2 })
    const doubleContext = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
    try {
      await doubleContext.addCookies([{ name: authCookieName, value: await createSessionToken(doubler), url: base }])
      const page = await doubleContext.newPage()
      await page.goto(base + '/shun-master?items=1')
      const box = page.getByRole('dialog', { name: /百宝箱/ })
      const doubleCard = box.getByRole('listitem').filter({ hasText: '碌卡' })
      await doubleCard.getByRole('button', { name: '设为待生效' }).click()
      await doubleCard.getByRole('button', { name: '取消待生效' }).waitFor()
      await box.getByRole('button', { name: '关闭' }).click()
      await page.getByRole('button', { name: '顺一手', exact: true }).click()
      const result = page.getByRole('dialog', { name: '顺走啦！' })
      const continueButton = result.getByRole('button', { name: '不留言并再顺一手' })
      await continueButton.waitFor()
      const first = await prisma.shunMasterRound.findFirstOrThrow({ where: { actorId: doubler.id, victimId: firstTarget.id } })
      assert.equal(first.amount, first.rolled * 2)
      await prisma.user.update({ where: { id: secondTarget.id }, data: { points: 30 } })
      await continueButton.click()
      const endButton = result.getByRole('button', { name: '不留言', exact: true })
      await endButton.waitFor()
      const second = await prisma.shunMasterRound.findFirstOrThrow({ where: { actorId: doubler.id, victimId: secondTarget.id } })
      assert.equal(second.amount, second.rolled)
      assert.equal(await prisma.shunItemRoundEffect.count({ where: { roundId: second.id } }), 0)
      await page.screenshot({ path: join(output, 'v42-h5-small-last-attempt.png') })
      await endButton.click()
      await result.waitFor({ state: 'hidden' })
    } finally {
      await doubleContext.close()
      await updateShunConfig(operator.id, game)
    }

    const preTrapFunded = await prisma.user.findMany({ where: { points: { gt: 0 } }, select: { id: true } })
    const [trapper, trapped] = await Promise.all([fixture(), fixture(30)])
    if (preTrapFunded.length) await prisma.block.createMany({
      data: preTrapFunded.map(({ id }) => ({ blockerId: trapper.id, blockedId: id })),
    })
    await shunTransaction(async (tx) => {
      await lockShunItemUsers(tx, [trapper.id])
      await postShunItemMovement(tx, {
        userId: trapper.id, code: 'EXTRA_SUSPECT', type: 'DAILY_MAIN', day: shunDay(new Date()),
        requestKey: 'browser-ambush', configVersion: active.version,
      })
    })
    const trapContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
    try {
      await trapContext.addCookies([{ name: authCookieName, value: await createSessionToken(trapper), url: base }])
      const page = await trapContext.newPage()
      await page.goto(base + '/shun-master?items=1')
      const box = page.getByRole('dialog', { name: /百宝箱/ })
      const trapItem = box.getByRole('listitem').filter({ hasText: '十面埋伏' })
      await trapItem.getByRole('button', { name: '设为待生效' }).click()
      await trapItem.getByRole('button', { name: '取消待生效' }).waitFor()
      await box.getByRole('button', { name: '关闭' }).click()
      await page.getByRole('button', { name: '顺一手', exact: true }).click()
      await page.getByRole('dialog', { name: '顺走啦！' }).waitFor()
      const round = await prisma.shunMasterRound.findFirstOrThrow({ where: { actorId: trapper.id, victimId: trapped.id } })
      await trapContext.addCookies([{ name: authCookieName, value: await createSessionToken(trapped), url: base }])
      await page.goto(base + '/shun-master?record=' + round.id)
      const card = page.locator('#shun-record-' + round.id)
      const investigate = card.getByRole('button', { name: '立即调查' })
      const options = card.getByRole('region', { name: '抓捕追回' })
      await investigate.click()
      await options.getByText(/黄金抓捕期/).waitFor()
      assert.equal(await options.getByRole('radio').count(), 3)
      await page.screenshot({ path: join(output, 'v42-h5-ambush-golden.png') })
      await card.getByRole('button', { name: '收起调查' }).click()
      await prisma.shunMasterRound.update({ where: { id: round.id }, data: { goldenUntil: new Date(Date.now() - 1000) } })
      await investigate.click()
      await options.getByText('四选一抓捕').waitFor()
      assert.equal(await options.getByRole('radio').count(), 4)
      await page.screenshot({ path: join(output, 'v42-h5-ambush-normal.png') })
    } finally {
      await trapContext.close()
    }

    const draft = validateShunItemDraft(await prisma.shunItemConfigVersion.findFirst({
      orderBy: { version: 'desc' }, include: { definitions: true },
    }))
    assert.ok(draft)
    await prisma.shunItemConfigVersion.create({ data: {
      createdBy: operator.id, enabled: true, definitions: { create: draft.definitions },
      rules: { ...draft.rules, community: true, drops: { ...draft.rules.drops, CHECK_IN: { chance: 100, dailyChecks: 1 } } },
    } })
    const checkInUser = await fixture()
    const dropContext = await browser.newContext({ viewport: { width: 1440, height: 960 } })
    const previousGate = process.env.SHUN_ITEMS_ENABLED
    try {
      process.env.SHUN_ITEMS_ENABLED = 'true'
      await dropContext.addCookies([{ name: authCookieName, value: await createSessionToken(checkInUser), url: base }])
      const page = await dropContext.newPage()
      await page.goto(base + '/checkin')
      const registered = await dropContext.request.post(base + '/api/checkin', {
        headers: { Origin: base }, data: {},
      })
      assert.equal(registered.status(), 200)
      assert.equal(await prisma.checkIn.count({ where: { userId: checkInUser.id } }), 1)
      for (let pass = 0; pass < 4; pass++) await runShunItemRewardSweep()
      const toast = page.getByRole('link', { name: /意外收获/ })
      await toast.waitFor()
      await page.screenshot({ path: join(output, 'v42-pc-checkin-drop.png') })
      await toast.click()
      const box = page.getByRole('dialog', { name: /百宝箱/ })
      await box.getByText(/意外收获/).waitFor()
    } finally {
      if (previousGate === undefined) delete process.env.SHUN_ITEMS_ENABLED
      else process.env.SHUN_ITEMS_ENABLED = previousGate
      await dropContext.close()
    }
  } finally {
    await browser.close()
    await prisma.$disconnect()
  }
})
