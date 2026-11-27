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
  } finally {
    await browser.close()
    await prisma.$disconnect()
  }
})
