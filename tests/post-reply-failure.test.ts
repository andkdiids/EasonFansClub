import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { getReplyErrorMessage } from '../lib/reply-errors'
import { getReplyLengthMetrics, REPLY_MAX_LENGTH } from '../lib/reply-length'

const root = path.resolve(__dirname, '..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')
const schema = read('prisma/schema.prisma')
const mysqlTestSchema = read('prisma/schema.mysql-test.prisma')
const baseline = read('prisma/mysql-baseline/current/baseline.sql')
const migration = read('prisma/migrations/20260909150000_expand_reply_activity_content/migration.sql')
const replyRoute = read('app/api/posts/[postId]/replies/route.ts')
const replyForm = read('components/ReplyForm.tsx')

function sha256(value: string) {
  return createHash('sha256').update(value.replace(/\r\n?/g, '\n')).digest('hex')
}

test('comment storage supports the product 300-character contract', () => {
  assert.equal(REPLY_MAX_LENGTH, 300)
  assert.equal(getReplyLengthMetrics('中'.repeat(204)).exceededBy, 0)
  assert.equal(getReplyLengthMetrics(`${'中'.repeat(203)}😊`).actualLength, 204)
  assert.equal(getReplyLengthMetrics(`${'中'.repeat(298)}\nA`).actualLength, 300)
  assert.equal(getReplyLengthMetrics('中'.repeat(300)).exceededBy, 0)
  assert.equal(getReplyLengthMetrics('中'.repeat(301)).exceededBy, 1)

  assert.match(schema, /model Reply \{[\s\S]*?content\s+String\s+@db\.Text/)
  assert.match(schema, /model FriendActivity \{[\s\S]*?content\s+String\?\s+@db\.Text/)
  assert.match(mysqlTestSchema, /model Reply \{[\s\S]*?content\s+String\s+@db\.Text/)
  assert.match(mysqlTestSchema, /model FriendActivity \{[\s\S]*?content\s+String\?\s+@db\.Text/)
  assert.match(baseline, /CREATE TABLE `Reply` \([\s\S]*?`content` TEXT NOT NULL/)
  assert.match(baseline, /CREATE TABLE `FriendActivity` \([\s\S]*?`content` TEXT NULL/)
  assert.match(migration, /ALTER TABLE `Reply`[\s\S]*MODIFY COLUMN `content` TEXT NOT NULL/)
  assert.match(migration, /ALTER TABLE `FriendActivity`[\s\S]*MODIFY COLUMN `content` TEXT NULL/)
})

test('a reply transaction records the activity snapshot after the reply and keeps secondary notifications outside it', () => {
  const replyCreate = replyRoute.indexOf('tx.reply.create')
  const activityCreate = replyRoute.indexOf('tx.friendActivity.create')
  const reward = replyRoute.indexOf('const communityReward = await awardCommunityCommentRewards')
  const notification = replyRoute.lastIndexOf('safeNotificationWrite')
  assert.ok(replyCreate >= 0)
  assert.ok(activityCreate > replyCreate)
  assert.ok(reward > activityCreate)
  assert.ok(notification > reward)
  assert.match(replyRoute, /content: stickerId \? '\[表情\]' : textContent/)
  assert.match(replyRoute, /safeNotificationWrite\(/)
  assert.match(replyRoute, /completeTask\(/)
})

test('reply client preserves actionable status messages and only uses generic copy for unknown server errors', () => {
  assert.equal(getReplyErrorMessage(401, {}), '登录状态已失效，请重新登录')
  assert.equal(getReplyErrorMessage(404, {}), '该帖子已不存在，请刷新后重试')
  assert.equal(getReplyErrorMessage(409, { message: '不能回复不存在或已删除的评论' }), '不能回复不存在或已删除的评论')
  assert.equal(getReplyErrorMessage(429, {}), '操作太频繁，请稍后再试')
  assert.equal(getReplyErrorMessage(500, {}), '回复失败，请稍后重试')
  assert.equal(getReplyErrorMessage(400, { errors: { content: '回复最多 300 字' } }), '回复最多 300 字')
  assert.match(replyForm, /getReplyErrorMessage\(response\.status, data\)/)
  assert.match(replyForm, /onDraftClear\?\.\(\)/)
})

test('baseline metadata stays bound to the edited schema and baseline', () => {
  const metadata = JSON.parse(read('prisma/mysql-baseline/current/metadata.json')) as Record<string, unknown>
  assert.equal(metadata.schemaHash, sha256(read('prisma/schema.prisma')))
  assert.equal(metadata.baselineHash, sha256(baseline))
})
