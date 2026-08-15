import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const reviewRoute = read('app/api/admin/posts/review/route.ts')

test('审核状态先独立提交，通知在提交后发送且不再使用 tx.notification.create', () => {
  const patch = reviewRoute.slice(reviewRoute.indexOf('export async function PATCH'))
  const transactionStart = patch.indexOf('prisma.$transaction')
  const transactionEnd = patch.indexOf('const current = result.current')
  const notificationCall = patch.indexOf('writeReviewNotification')
  assert.ok(transactionStart > 0 && transactionEnd > transactionStart && notificationCall > transactionEnd)
  assert.doesNotMatch(patch, /tx\.notification\.create/)
  assert.match(reviewRoute, /recipientId: input\.authorId/)
  assert.match(reviewRoute, /type: 'ADMIN'/)
})

test('并发审核只允许 PENDING 状态转换，通知使用本次审核时间生成幂等 key', () => {
  assert.match(reviewRoute, /moderationStatus: 'PENDING'/)
  assert.match(reviewRoute, /key: `post-review-result:\$\{input\.postId\}:\$\{input\.status\}:\$\{input\.reviewedAt\.getTime\(\)\}`/)
  assert.match(reviewRoute, /POST_ALREADY_REVIEWED/)
})

test('审核通过与拒绝的通知文案和链接正确', () => {
  assert.match(reviewRoute, /title: input\.status === 'APPROVED' \? '帖子审核通过'/)
  assert.match(reviewRoute, /E院广场查看/)
  assert.match(reviewRoute, /帖子未通过审核/)
  assert.match(reviewRoute, /input\.rejectionReason/)
  assert.match(reviewRoute, /link: `\/posts\/\$\{input\.postId\}`/)
})
