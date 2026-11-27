import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { recordFaultEvidence } from './helpers/shun-fault-evidence'
import { chromium } from 'playwright'
import { authCookieName, createSessionToken } from '../lib/auth'
import { prisma } from '../lib/prisma'
import { validateShunItemDraft } from '../lib/shun-item-config'
import { runShunItemRewardSweep } from '../lib/shun-item-rewards'
import { getTodayTasks } from '../lib/growth-tasks/registry'
import { lockShunItemUsers, postShunItemMovement } from '../lib/shun-item-inventory'
import { shunTransaction, updateShunConfig } from '../lib/shun-master'
import { shunDay, validateShunConfig } from '../lib/shun-master-rules'

test('V4.2 authenticated PC and H5 item box, randomized gifting and refresh', {
  skip: process.env.SHUN_ITEMS_BROWSER_QA !== '1',
  timeout: 180_000,
}, async () => {
  const url = new URL(process.env.DATABASE_URL ?? '')
  assert.equal(url.protocol, 'mysql:')
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
  await shunTransaction(async (tx) => {
    await lockShunItemUsers(tx, [sender.id])
    await postShunItemMovement(tx, {
      userId: sender.id, code: 'FRIEND_GIFT', type: 'WEEKLY_REWARD',
      day: shunDay(new Date()), requestKey: 'browser-gift-refresh-retry', configVersion: active.version,
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
          const giftRequests: string[] = []
          let committedGift: { id: string; code: string } | undefined
          const mysql = process.env.SHUN_ITEMS_MYSQL_CLIENT
          assert.ok(mysql)
          const trigger = 'shun_browser_notify_' + randomUUID().replaceAll('-', '')
          const fixtureDdl = (input: string) => execFileSync(mysql, [
            '--no-defaults', '--host=127.0.0.1', '--protocol=TCP', '--port=' + url.port,
            '--user=' + decodeURIComponent(url.username), 'ecfc_shun_items_fixture_qa',
          ], { input, env: { ...process.env, MYSQL_PWD: decodeURIComponent(url.password) } })
          assert.match(receiver.id, /^[a-z0-9]+$/)
          await page.route('**/api/shun-master/gift', async (route) => {
            giftRequests.push(route.request().postDataJSON().requestId)
            if (giftRequests.length === 1) return route.abort('internetdisconnected')
            if (giftRequests.length === 2) {
              fixtureDdl(`CREATE TRIGGER ${trigger} BEFORE INSERT ON Notification FOR EACH ROW SET NEW.id = IF(NEW.recipientId = '${receiver.id}', NULL, NEW.id)`)
              try {
                const rolledBack = await route.fetch()
                assert.equal(rolledBack.status(), 500)
                return await route.abort('connectionreset')
              } finally {
                fixtureDdl(`DROP TRIGGER ${trigger}`)
              }
            }
            const response = await route.fetch()
            assert.equal(response.status(), 200)
            const delivery = await response.json()
            if (giftRequests.length === 3) {
              committedGift = delivery
              return route.abort('connectionreset')
            }
            assert.deepEqual(delivery, committedGift)
            await route.fulfill({ response })
          })
          const gift = box.getByRole('button', { name: '随机赠送' })
          await gift.click()
          await box.getByText('网络连接中断，请重试。').waitFor()
          assert.equal(await prisma.shunItemGift.count({ where: { senderId: sender.id } }), 0)
          await gift.click()
          await box.getByText('网络连接中断，请重试。').waitFor()
          const persisted = await prisma.shunItemGiftIntent.findUniqueOrThrow({
            where: { senderId_requestKey: { senderId: sender.id, requestKey: 'gift:' + giftRequests[0] } },
          })
          assert.equal(persisted.status, 'PENDING')
          assert.equal(await prisma.shunItemGift.count({ where: { senderId: sender.id } }), 0)
          await gift.click()
          await box.getByText('网络连接中断，请重试。').waitFor()
          assert.equal(await prisma.shunItemGift.count({ where: { senderId: sender.id } }), 1)
          assert.equal(committedGift?.code, persisted.code)
          await page.reload()
          await gift.click()
          await box.getByText('幸运已经送达！').waitFor()
          assert.equal(giftRequests.length, 4)
          assert.equal(new Set(giftRequests).size, 1)
          await recordFaultEvidence(join(output, 'fault-matrix.jsonl'), {
            id: 'GIFT-HTTP-ROLLBACK-REFRESH',
            business: 'FRIEND_GIFT',
            scenario: 'request missing, real rollback, response loss and refresh replay',
            method: 'Playwright route.fetch with real HTTP and MySQL notification trigger',
            before: { gifts: 0 },
            after: { gifts: 1, requestKeys: [...new Set(giftRequests)], intentId: persisted.id, code: persisted.code },
            result: 'PASS',
            logPath: process.env.SHUN_ITEMS_BROWSER_LOG ?? join(output, '..', 'gift-intent-browser.log'),
          })
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
    const now = new Date()
    const dateKey = shunDay(now)
    const otherTasks = getTodayTasks().filter(({ code }) => code !== 'DAILY_CHECKIN')
    await prisma.growthTaskCompletion.createMany({ data: otherTasks.flatMap((task) =>
      Array.from({ length: task.dailyCap ?? task.completionThreshold ?? 1 }, (_, index) => ({
        userId: checkInUser.id, taskCode: task.code, periodKey: dateKey,
        sourceEventId: `browser-progress:${task.code}:${index}`, completedAt: now,
      }))) })
    const commentCount = otherTasks.find(({ code }) => code === 'DAILY_COMMENT')?.dailyCap ?? 1
    await prisma.pointLog.createMany({ data: Array.from({ length: commentCount }, (_, index) => ({
      userId: checkInUser.id, action: 'COMMENT_POST' as const, points: 1, before: index, after: index + 1,
      dateKey, businessKey: `browser-progress:${checkInUser.id}:${index}`, createdAt: now,
    })) })
    await prisma.user.update({ where: { id: checkInUser.id }, data: { points: commentCount } })
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
      await box.getByText(/每日主线 ·/).waitFor()
      assert.deepEqual(await prisma.shunItemDaily.findUnique({
        where: { userId_day: { userId: checkInUser.id, day: dateKey } },
        select: { mainGranted: true, behaviorGranted: true },
      }), { mainGranted: true, behaviorGranted: true })
      await page.screenshot({ path: join(output, 'v42-pc-independent-rewards.png') })
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

test('V4.2 prescription, comment, friend post share and like use real reward facts', {
  skip: process.env.SHUN_ITEMS_BROWSER_QA !== '1',
  timeout: 180_000,
}, async () => {
  const database = new URL(process.env.DATABASE_URL ?? '')
  const base = process.env.SHUN_ITEMS_BROWSER_BASE ?? 'http://127.0.0.1:3127'
  const output = process.env.SHUN_ITEMS_QA_OUTPUT
  assert.equal(database.hostname, '127.0.0.1')
  assert.equal(database.pathname, '/ecfc_shun_items_fixture_qa')
  assert.equal(new URL(base).hostname, '127.0.0.1')
  assert.ok(output)
  const source = validateShunItemDraft(await prisma.shunItemConfigVersion.findFirst({
    orderBy: { version: 'desc' }, include: { definitions: true },
  }))
  assert.ok(source)
  const oldGate = process.env.SHUN_ITEMS_ENABLED
  process.env.SHUN_ITEMS_ENABLED = 'true'
  const fixture = () => {
    const name = 'V42Activity-' + randomUUID().slice(0, 12)
    return prisma.user.create({ data: {
      username: name, usernameNormalized: name.toLowerCase(), nickname: name, passwordHash: 'fixture',
      Profile: { create: { displayName: name } },
    } })
  }
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.SHUN_ITEMS_BROWSER_PATH ? { executablePath: process.env.SHUN_ITEMS_BROWSER_PATH } : {}),
  })
  try {
    const owner = await fixture()
    const title = '顺大师行为隔离测试 ' + randomUUID().slice(0, 8)
    const board = await prisma.board.create({ data: { name: title, slug: randomUUID() } })
    const post = await prisma.post.create({ data: { title, content: '隔离验收测试帖子。', authorId: owner.id, boardId: board.id } })
    const kinds = ['PRESCRIPTION', 'COMMENT', 'SHARE', 'LIKE'] as const
    for (const chance of [0, 100]) {
      const drops = Object.fromEntries(Object.entries(source.rules.drops).map(([kind, rule]) => [kind, { ...rule, chance }]))
      await prisma.shunItemConfigVersion.create({ data: {
        createdBy: owner.id, enabled: true, definitions: { create: source.definitions },
        rules: { ...source.rules, community: true, dailyMax: 2, drops },
      } })
      const actors = await Promise.all(kinds.map(async (kind) => {
        const user = await fixture()
        const [userAId, userBId] = [owner.id, user.id].sort()
        await prisma.friendship.create({ data: { userAId, userBId } })
        const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
        await context.addCookies([{ name: authCookieName, value: await createSessionToken(user), url: base }])
        return { kind, user, context }
      }))
      try {
        const actions = await Promise.all(actors.map(async ({ kind, user, context }) => {
          const page = await context.newPage()
          await page.goto(base + (kind === 'PRESCRIPTION' ? '/games/daily-prescription' : '/posts/' + post.id))
          const routes = { PRESCRIPTION: '/api/entertainment/daily-draw', COMMENT: '/api/posts/' + post.id + '/replies',
            SHARE: '/api/posts/' + post.id + '/share', LIKE: '/api/posts/' + post.id + '/like' }
          const fields = {
            COMMENT: { content: '这一条隔离验收评论足够长且具有唯一文本。' + user.nickname },
            SHARE: { recipientId: owner.id, clientMessageId: randomUUID() },
            PRESCRIPTION: {}, LIKE: {},
          }
          const submit = () => context.request.post(base + routes[kind], { headers: { Origin: base }, data: fields[kind] })
          const response = await submit()
          assert.ok(response.ok(), kind + ': ' + response.status() + ' ' + await response.text())
          const repeat = async () => {
            const headers = { Origin: base }
            if (kind === 'COMMENT') {
              const reply = await prisma.reply.findFirstOrThrow({ where: { postId: post.id, authorId: user.id, isDeleted: false } })
              assert.ok((await context.request.delete(base + '/api/replies/' + reply.id, { headers })).ok())
            }
            if (kind === 'LIKE') assert.ok((await context.request.delete(base + routes.LIKE, { headers })).ok())
            if (kind === 'SHARE') fields.SHARE.clientMessageId = randomUUID()
            const replay = await submit()
            assert.ok(replay.ok(), kind + ' repeat: ' + replay.status())
          }
          return { kind, user, page, repeat }
        }))
        for (let i = 0; i < 8; i++) await runShunItemRewardSweep()
        for (const { kind, user, page } of actions) {
          const entries = await prisma.shunItemEntry.findMany({ where: { userId: user.id, type: 'COMMUNITY_DROP' } })
          assert.equal(entries.length, chance === 100 ? 1 : 0, kind)
          if (!chance) {
            assert.equal(await page.getByRole('link', { name: /意外收获/ }).count(), 0)
            continue
          }
          const stock = await prisma.shunItemInventory.findMany({ where: { userId: user.id } })
          assert.equal(stock.reduce((sum, row) => sum + row.available, 0), 1)
        }
        await Promise.all(actions.map(async ({ kind, page, repeat }) => {
          if (chance) {
            const toast = page.getByRole('link', { name: /意外收获/ })
            await toast.waitFor()
            await page.screenshot({ path: join(output, 'v42-activity-' + kind + '.png') })
            await toast.click()
            const box = page.getByRole('dialog', { name: /百宝箱/ })
            await box.getByText(/意外收获 ·/).waitFor()
            await page.reload()
            await box.getByText(/意外收获 ·/).waitFor()
          }
          await repeat()
        }))
        for (let i = 0; i < 4; i++) await runShunItemRewardSweep()
        for (const { kind, user } of actions) assert.equal(
          await prisma.shunItemEntry.count({ where: { userId: user.id, type: 'COMMUNITY_DROP' } }),
          chance ? 1 : 0, kind + ' duplicate',
        )
      } finally {
        await Promise.all(actors.map(({ context }) => context.close()))
      }
    }
  } finally {
    if (oldGate === undefined) delete process.env.SHUN_ITEMS_ENABLED
    else process.env.SHUN_ITEMS_ENABLED = oldGate
    await browser.close()
    await prisma.$disconnect()
  }
})
