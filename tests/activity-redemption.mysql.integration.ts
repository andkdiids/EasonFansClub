import assert from 'node:assert/strict'

// Explicit isolated target only. This script never loads production credentials
// or creates/drops databases. Provision the current Prisma schema in a fresh DB.
async function main() {
  const raw = process.env.ACTIVITY_REDEMPTION_MYSQL_URL || ''
  const target = new URL(raw)
  assert.equal(target.protocol, 'mysql:')
  assert.equal(target.hostname, '127.0.0.1')
  assert.ok((target.port === '33319' && target.pathname === '/ecfc_redemption_qa_20261113')
    || (target.port === '3306' && target.pathname === '/activity_redemption_qa'), 'requires an explicitly isolated local/CI target')
  assert.equal(target.search, '')
  process.env.DATABASE_URL = raw
  const { prisma } = await import('../lib/prisma')
  const { confirmActivityRedemption, getActivityRedemptionLookupByToken } = await import('../lib/activity-redemption')
  try {
    assert.equal(await prisma.activity.count(), 0, 'requires fresh isolated test DB')
    const [admin, user, other] = await Promise.all(['admin', 'user', 'other'].map((id) => prisma.user.create({ data: { id, username: id, usernameNormalized: id, nickname: id, passwordHash: 'test-only-not-a-password', role: id === 'admin' ? 'ADMIN' : 'USER' } })))
    const now = new Date()
    const activityData = { title: '本场活动', description: '隔离测试', status: 'PUBLISHED' as const, verificationMode: 'QR' as const, startsAt: new Date(now.getTime() - 3_600_000), endsAt: new Date(now.getTime() + 3_600_000), coverUrl: 'https://example.test/cover.jpg', locationName: '会场', locationAddress: '地址' }
    const [activity, otherActivity] = await Promise.all(['activity', 'other-activity'].map((id) => prisma.activity.create({ data: { id, ...activityData } })))
    const registration = await prisma.activityRegistration.create({ data: { activityId: activity.id, userId: user.id, verificationToken: 'qa-current-token' } })
    const otherRegistration = await prisma.activityRegistration.create({ data: { activityId: activity.id, userId: other.id, verificationToken: 'qa-other-token' } })
    const material = await prisma.materialRedemption.create({ data: { title: '应援物料', description: '真实配置', stockTotal: 20, stockRemaining: 15, createdByAdminId: admin.id, exchangeStartAt: now, exchangeEndAt: new Date(now.getTime() + 3_600_000), redeemEndAt: new Date(now.getTime() + 3_600_000), status: 'PUBLISHED' } })
    const makeOrder = (id: string, linkedActivityId: string, userId: string, quantity: number) => prisma.materialRedemptionOrder.create({ data: { id, materialId: material.id, userId, linkedActivityId, quantity, unitCost: 0, totalCost: 0, redeemCode: id, redeemToken: id, eligibilitySnapshot: {}, idempotencyKey: id } })
    const [orderA, orderB, foreignOrder, otherUserOrder] = await Promise.all([
      makeOrder('order-a', activity.id, user.id, 2), makeOrder('order-b', activity.id, user.id, 3), makeOrder('foreign-order', otherActivity.id, user.id, 1), makeOrder('other-user-order', activity.id, other.id, 1),
    ])
    const createWinner = async (id: string, activityId: string, virtual = false) => {
      const lottery = await prisma.lottery.create({ data: { title: id, activityId, status: 'DRAWN' } })
      const prize = await prisma.lotteryPrize.create({ data: { lotteryId: lottery.id, name: id, type: virtual ? 'POINTS' : 'PHYSICAL', prizeType: virtual ? 'VIRTUAL' : 'PHYSICAL', quantity: 99, remaining: 98 } })
      return prisma.lotteryEntry.create({ data: { lotteryId: lottery.id, userId: user.id, prizeId: prize.id, registrationId: activityId === activity.id ? registration.id : null, fulfillmentStatus: virtual ? 'FULFILLED' : 'NOT_REQUIRED', fulfilledAt: virtual ? now : null } })
    }
    const [winnerA, winnerB, foreignWinner, virtualWinner] = await Promise.all([createWinner('奖品一', activity.id), createWinner('奖品二', activity.id), createWinner('别场奖品', otherActivity.id), createWinner('虚拟奖品', activity.id, true)])
    const lookup = await getActivityRedemptionLookupByToken('qa-current-token')
    assert.equal(lookup.activity.coverUrl, activityData.coverUrl)
    assert.equal(lookup.activity.locationName, '会场')
    assert.deepEqual(lookup.entitlements.filter((e) => e.type === 'MATERIAL').map((e) => [e.id, e.quantity]), [[orderA.id, 2], [orderB.id, 3]])
    const prizes = lookup.entitlements.filter((e) => e.type === 'LOTTERY_PRIZE')
    assert.equal(prizes.length, 3)
    assert.ok(prizes.every((p) => p.quantity === 1), 'prize stock must never become recipient quantity')
    assert.equal(prizes.find((p) => p.prizeType === 'VIRTUAL')?.selectable, false)
    await prisma.lotteryEntry.update({ where: { id: virtualWinner.id }, data: { fulfillmentStatus: 'FAILED', fulfilledAt: null } })
    const failedVirtual = (await getActivityRedemptionLookupByToken('qa-current-token')).entitlements.find((e) => e.id === virtualWinner.id)
    assert.equal(failedVirtual?.selectable, false)
    assert.equal(failedVirtual?.status, 'UNAVAILABLE')
    assert.match(failedVirtual?.subtitle || '', /发放失败/)
    assert.equal((await getActivityRedemptionLookupByToken('qa-other-token')).entitlements.filter((e) => e.type === 'LOTTERY_PRIZE').length, 0)
    for (const status of ['CANCELLED', 'EXPIRED', 'REFUNDED'] as const) {
      const order = await makeOrder('state-' + status, activity.id, user.id, 1)
      await prisma.materialRedemptionOrder.update({ where: { id: order.id }, data: { status } })
    }
    const stateLookup = await getActivityRedemptionLookupByToken('qa-current-token')
    for (const [status, label] of [['CANCELLED', '已取消'], ['EXPIRED', '已失效'], ['REFUNDED', '已退款']]) {
      const item = stateLookup.entitlements.find((e) => e.id === 'state-' + status)
      assert.equal(item?.selectable, false)
      assert.equal(item?.status, 'UNAVAILABLE')
      assert.ok(item?.blockedReason?.includes(label))
    }
    for (const selected of [{ type: 'MATERIAL', id: foreignOrder.id }, { type: 'MATERIAL', id: otherUserOrder.id }, { type: 'LOTTERY_PRIZE', id: foreignWinner.id }]) {
      await assert.rejects(confirmActivityRedemption(activity.id, 'qa-current-token', [selected], admin.id), /不属于当前活动|当前用户/)
    }
    await assert.rejects(confirmActivityRedemption(otherActivity.id, 'qa-current-token', [{ type: 'MATERIAL', id: foreignOrder.id }], admin.id), /报名记录/)
    await assert.rejects(confirmActivityRedemption(activity.id, 'qa-current-token', [{ type: 'LOTTERY_PRIZE', id: winnerA.id }], admin.id), /完成活动签到/)
    await assert.rejects(confirmActivityRedemption(activity.id, 'qa-current-token', [{ type: 'LOTTERY_PRIZE', id: virtualWinner.id }], admin.id), /虚拟奖品/)
    // A valid check-in earlier in a batch must roll back when a later item is foreign.
    await assert.rejects(confirmActivityRedemption(activity.id, 'qa-other-token', [
      { type: 'ACTIVITY_REGISTRATION', id: otherRegistration.id }, { type: 'MATERIAL', id: orderA.id },
    ], admin.id), /当前用户/)
    assert.equal((await prisma.activityRegistration.findUniqueOrThrow({ where: { id: otherRegistration.id } })).verifiedAt, null)
    assert.equal(await prisma.adminAction.count({ where: { targetId: otherRegistration.id, operationType: 'ACTIVITY_REDEMPTION_CONFIRM' } }), 0)
    await confirmActivityRedemption(activity.id, 'qa-other-token', [{ type: 'ACTIVITY_REGISTRATION', id: otherRegistration.id }], admin.id)
    assert.equal((await prisma.materialRedemptionOrder.findUniqueOrThrow({ where: { id: otherUserOrder.id } })).status, 'SUCCESS', 'check-in never implicitly redeems unselected materials')
    const selections = [{ type: 'LOTTERY_PRIZE', id: winnerA.id }, { type: 'MATERIAL', id: orderB.id }, { type: 'ACTIVITY_REGISTRATION', id: registration.id }, { type: 'MATERIAL', id: orderA.id }, { type: 'LOTTERY_PRIZE', id: winnerB.id }]
    const results = await Promise.all(Array.from({ length: 4 }, (_, index) => confirmActivityRedemption(activity.id, 'qa-current-token', index === 0 ? [...selections, selections[0]] : selections, admin.id)))
    assert.equal(results.flatMap((r) => r.results).filter((r) => r.status === 'REDEEMED').length, selections.length)
    assert.equal(await prisma.materialRedemptionOrder.count({ where: { id: { in: [orderA.id, orderB.id] }, status: 'REDEEMED', redeemedByAdminId: admin.id } }), 2)
    assert.equal(await prisma.lotteryEntry.count({ where: { id: { in: [winnerA.id, winnerB.id] }, redemptionStatus: 'REDEEMED', redeemedByAdminId: admin.id } }), 2)
    assert.equal((await prisma.materialRedemptionOrder.findUniqueOrThrow({ where: { id: foreignOrder.id } })).status, 'SUCCESS')
    const audit = await prisma.adminAction.findMany({ where: { targetId: registration.id, operationType: 'ACTIVITY_REDEMPTION_CONFIRM' } })
    assert.equal(audit.length, 4)
    assert.ok(audit.every((r) => r.adminId === admin.id && r.createdAt && r.metadata))
    for (const record of audit) {
      const metadata = record.metadata as { activityId: string; registrationId: string; selections: Array<{ type: string; id: string }> }
      assert.equal(metadata.activityId, activity.id)
      assert.equal(metadata.registrationId, registration.id)
      assert.deepEqual(metadata.selections.map((item) => `${item.type}:${item.id}`).sort(), selections.map((item) => `${item.type}:${item.id}`).sort())
    }
    const secondAdmin = await prisma.user.create({ data: { id: 'admin-2', username: 'admin-2', usernameNormalized: 'admin-2', nickname: 'admin-2', passwordHash: 'test-only', role: 'ADMIN' } })
    const beforeRetry = await prisma.materialRedemptionOrder.findUniqueOrThrow({ where: { id: orderA.id } })
    const retry = await confirmActivityRedemption(activity.id, 'qa-current-token', [{ type: 'MATERIAL', id: orderA.id }], secondAdmin.id)
    assert.equal(retry.results[0].status, 'ALREADY_REDEEMED')
    const afterRetry = await prisma.materialRedemptionOrder.findUniqueOrThrow({ where: { id: orderA.id } })
    assert.equal(afterRetry.redeemedByAdminId, admin.id, 'a retry cannot replace the original operator')
    assert.equal(afterRetry.redeemedAt?.getTime(), beforeRetry.redeemedAt?.getTime(), 'a retry cannot replace the original redemption time')
    await prisma.activityRegistration.update({ where: { id: registration.id }, data: { status: 'CANCELLED' } })
    await assert.rejects(confirmActivityRedemption(activity.id, 'qa-current-token', selections, admin.id), /报名已取消/)
    console.log('REAL_MYSQL_ACTIVITY_REDEMPTION_CONCURRENCY_ISOLATION_AUDIT=PASS')
  } finally {
    await prisma.$disconnect()
  }
}
main().catch((error) => { console.error(error instanceof Error ? error.message : 'INTEGRATION_FAILED'); process.exitCode = 1 })
