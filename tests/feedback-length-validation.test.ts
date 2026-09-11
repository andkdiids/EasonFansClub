import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { FEEDBACK_DESCRIPTION_MAX_LENGTH, FEEDBACK_DESCRIPTION_TOO_LONG_ERROR } from '../lib/feedback'

function read(path: string) {
  return readFileSync(path, 'utf8')
}

const feedbackPage = read('app/feedback/FeedbackCenter.tsx')
const feedbackRoute = read('app/api/feedback/route.ts')
const prismaSchema = read('prisma/schema.prisma')
const mysqlTestSchema = read('prisma/schema.mysql-test.prisma')
const feedbackMigration = read('prisma/migrations/20260911120000_limit_feedback_description_length/migration.sql')

test('反馈文字边界统一为 2000 字，100 字和最大长度内均可通过', () => {
  assert.equal(FEEDBACK_DESCRIPTION_MAX_LENGTH, 2000)
  assert.ok('a'.repeat(100).length <= FEEDBACK_DESCRIPTION_MAX_LENGTH)
  assert.ok('a'.repeat(FEEDBACK_DESCRIPTION_MAX_LENGTH).length <= FEEDBACK_DESCRIPTION_MAX_LENGTH)
  assert.ok('a'.repeat(FEEDBACK_DESCRIPTION_MAX_LENGTH + 1).length > FEEDBACK_DESCRIPTION_MAX_LENGTH)
})

test('反馈前端展示实时计数、限制输入并在超长提交前定位输入框', () => {
  assert.match(feedbackPage, /maxLength=\{FEEDBACK_DESCRIPTION_MAX_LENGTH\}/)
  assert.match(feedbackPage, /\{form\.description\.length\} \/ \{FEEDBACK_DESCRIPTION_MAX_LENGTH\}/)
  assert.match(feedbackPage, /if \(form\.description\.length > FEEDBACK_DESCRIPTION_MAX_LENGTH\)/)
  assert.match(feedbackPage, /反馈内容过长，请减少部分文字后再提交/)
  assert.match(feedbackPage, /descriptionRef\.current\?\.focus\(\)/)
})

test('反馈 API 对超长内容直接返回 400 和明确错误，不依赖数据库异常', () => {
  assert.match(feedbackRoute, /rawContent\.length > FEEDBACK_DESCRIPTION_MAX_LENGTH/)
  assert.match(feedbackRoute, /code: 'FEEDBACK_DESCRIPTION_TOO_LONG'/)
  assert.match(feedbackRoute, /error: FEEDBACK_DESCRIPTION_TOO_LONG_ERROR/)
  assert.match(feedbackRoute, /message: FEEDBACK_DESCRIPTION_TOO_LONG_ERROR/)
  assert.match(feedbackRoute, /\{ status: 400 \}/)
  assert.match(feedbackRoute, /sanitizeText\(rawContent, FEEDBACK_DESCRIPTION_MAX_LENGTH\)/)
  assert.equal(FEEDBACK_DESCRIPTION_TOO_LONG_ERROR, '反馈内容超过最大长度限制')
})

test('前端把 API 超长错误转换为用户提示并保留输入内容', () => {
  assert.match(feedbackPage, /反馈内容过长，请修改后重新提交/)
  const submitStart = feedbackPage.indexOf('async function submitFeedback')
  const submitEnd = feedbackPage.indexOf('\n  async function submitReply', submitStart)
  const submitSource = feedbackPage.slice(submitStart, submitEnd)
  const catchSource = submitSource.slice(submitSource.lastIndexOf('    } catch (err)'))
  assert.doesNotMatch(catchSource, /setForm\(/)
  assert.match(catchSource, /setError\(/)
})

test('Feedback 和首次反馈复制到的 FeedbackReply 使用 TEXT 存储', () => {
  const feedbackModel = prismaSchema.slice(prismaSchema.indexOf('model Feedback {'), prismaSchema.indexOf('model FeedbackAttachment {'))
  const replyModel = prismaSchema.slice(prismaSchema.indexOf('model FeedbackReply {'), prismaSchema.indexOf('model Follow {'))
  const mysqlFeedbackModel = mysqlTestSchema.slice(mysqlTestSchema.indexOf('model Feedback {'), mysqlTestSchema.indexOf('model FeedbackAttachment {'))
  const mysqlReplyModel = mysqlTestSchema.slice(mysqlTestSchema.indexOf('model FeedbackReply {'), mysqlTestSchema.indexOf('model FeedbackAttachment {'))
  assert.match(feedbackModel, /content\s+String\s+@db\.Text/)
  assert.match(replyModel, /content\s+String\s+@db\.Text/)
  assert.match(mysqlFeedbackModel, /content\s+String\s+@db\.Text/)
  assert.match(mysqlReplyModel, /content\s+String\s+@db\.Text/)
  assert.match(feedbackMigration, /ALTER TABLE `Feedback`[\s\S]*MODIFY COLUMN `content` TEXT NOT NULL/)
  assert.match(feedbackMigration, /ALTER TABLE `FeedbackReply`[\s\S]*MODIFY COLUMN `content` TEXT NOT NULL/)
})
