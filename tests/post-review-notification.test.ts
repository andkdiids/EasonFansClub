import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

const reviewRoute = read('app/api/admin/posts/review/route.ts')

test('审核通过 / 拒绝都在同一事务内给作者创建通知', () => {
  const transactionStart = reviewRoute.indexOf('prisma.$transaction')
  const notificationCreate = reviewRoute.indexOf('tx.notification.create')
  const transactionReturn = reviewRoute.indexOf('return { post: updated')
  assert.ok(transactionStart > 0 && notificationCreate > transactionStart && transactionReturn > notificationCreate)
  assert.match(reviewRoute, /recipientId: current\.authorId/)
  assert.match(reviewRoute, /type: 'ADMIN'/)
})

test('只有审核状态实际变化时才通知，重复审核不重复发送', () => {
  const guardIndex = reviewRoute.indexOf('const statusChanged = current.moderationStatus !== updated.moderationStatus')
  const notificationCreate = reviewRoute.indexOf('tx.notification.create')
  assert.ok(guardIndex > 0 && notificationCreate > guardIndex)
  // 通知创建在最终状态变化守卫之内（守卫结束于 friendActivity 之前不允许跨出）
  const blockEnd = reviewRoute.indexOf("if (updated.moderationStatus === 'APPROVED' && current.moderationStatus !== 'APPROVED')")
  assert.ok(notificationCreate < blockEnd)
})

test('审核通过与拒绝的通知文案和链接正确', () => {
  assert.match(reviewRoute, /帖子审核通过/)
  assert.match(reviewRoute, /已通过审核，现在可以在 E院广场查看。/)
  assert.match(reviewRoute, /帖子未通过审核/)
  // 有原因时附带原因，无原因时使用通用文案，不出现空的“原因：”
  assert.match(reviewRoute, /updated\.rejectionReason\s*\?\s*`你发布的帖子《\$\{current\.title\}》未通过审核。原因：\$\{updated\.rejectionReason\}`\s*:\s*`你发布的帖子《\$\{current\.title\}》未通过审核，请修改后重新提交。`/)
  // 链接指向用户可见的帖子详情页，而非后台
  assert.match(reviewRoute, /link: `\/posts\/\$\{current\.id\}`/)
})
