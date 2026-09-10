import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  buildGlobalPointsGrantNotificationContent,
  getGlobalPointsGrantNotificationKey,
  getGlobalPointsGrantPointBusinessKey,
  getGlobalPointsGrantBatchStatus,
  getGlobalPointsGrantRecipientWhere,
  normalizeGlobalPointsGrantInput,
} from '../lib/global-points-grant'

const root = path.resolve(__dirname, '..')
const read = (file: string) => readFileSync(path.join(root, file), 'utf8')

test('全站发放输入只接受正整数金额、必填标题正文和站内图片', () => {
  assert.deepEqual(normalizeGlobalPointsGrantInput({
    title: ' 中秋特别挂号费 ',
    content: '感谢大家的支持',
    amount: '74',
    imageUrl: null,
    idempotencyKey: 'global-grant-key-123456',
  }), {
    title: '中秋特别挂号费',
    content: '感谢大家的支持',
    amount: 74,
    imageUrl: null,
    idempotencyKey: 'global-grant-key-123456',
  })
  for (const amount of [0, -1, 1.5, Number.NaN, 100001]) {
    assert.throws(() => normalizeGlobalPointsGrantInput({ title: '标题', content: '正文', amount, idempotencyKey: 'global-grant-key-123456' }), /正整数/)
  }
  assert.throws(() => normalizeGlobalPointsGrantInput({ title: '', content: '正文', amount: 74, idempotencyKey: 'global-grant-key-123456' }), /标题不能为空/)
  assert.throws(() => normalizeGlobalPointsGrantInput({ title: '标题', content: '', amount: 74, idempotencyKey: 'global-grant-key-123456' }), /说明不能为空/)
  assert.throws(() => normalizeGlobalPointsGrantInput({ title: '标题', content: '正文', amount: 74, imageUrl: 'https://example.com/a.png', idempotencyKey: 'global-grant-key-123456' }), /站内上传结果/)
})

test('全站发放通知只展示说明和到账金额，不把图片 URL 放进正文', () => {
  assert.equal(buildGlobalPointsGrantNotificationContent('感谢支持', 74), '感谢支持\n\n+74 挂号费')
  assert.equal(getGlobalPointsGrantPointBusinessKey('batch-1', 'user-1'), 'global-points-grant:batch-1:user-1')
  assert.equal(getGlobalPointsGrantNotificationKey('batch-1', 'user-1'), 'global-points-grant:batch-1:user-1')
  assert.doesNotMatch(buildGlobalPointsGrantNotificationContent('感谢支持', 74), /https?:\/\//)
})

test('收件人由服务端按有效 User 语义筛选，并包含管理员角色', () => {
  assert.deepEqual(getGlobalPointsGrantRecipientWhere(), {
    uid: { gt: 0 },
    status: 'ACTIVE',
    isDeleted: false,
  })
})

test('批次状态由收件人积分阶段决定，HTTP 超时不会把处理中误报为失败', () => {
  assert.equal(getGlobalPointsGrantBatchStatus({ successCount: 0, failedCount: 0, pendingCount: 13062, processingCount: 0 }), 'PROCESSING')
  assert.equal(getGlobalPointsGrantBatchStatus({ successCount: 5321, failedCount: 0, pendingCount: 7741, processingCount: 0 }), 'PROCESSING')
  assert.equal(getGlobalPointsGrantBatchStatus({ successCount: 13062, failedCount: 0, pendingCount: 0, processingCount: 0 }), 'COMPLETED')
  assert.equal(getGlobalPointsGrantBatchStatus({ successCount: 12900, failedCount: 162, pendingCount: 0, processingCount: 0 }), 'PARTIAL_FAILED')
  assert.equal(getGlobalPointsGrantBatchStatus({ successCount: 0, failedCount: 13062, pendingCount: 0, processingCount: 0 }), 'FAILED')
})

test('批次、收件人幂等、流水和通知阶段边界存在', () => {
  const service = read('lib/global-points-grant.ts')
  const route = read('app/api/admin/global-points-grants/route.ts')
  const worker = read('lib/global-points-grant-worker.ts')
  const server = read('server.ts')
  const schema = read('prisma/schema.prisma')
  const migration = read('prisma/migrations/20260910100000_add_global_points_grants/migration.sql')
  const workerMigration = read('prisma/migrations/20260910180000_harden_global_points_grant_workers/migration.sql')
  assert.match(service, /tx\.globalPointsGrantRecipient\.updateMany/)
  assert.match(service, /awardRegistrationFee\(tx/)
  assert.match(service, /action: 'GLOBAL_POINTS_GRANT'/)
  assert.match(service, /sourceEventId: batch\.id/)
  assert.match(service, /upsertNotificationWithDb\(tx/)
  assert.match(service, /prisma\.\$transaction\(async \(tx\)/)
  assert.match(service, /GLOBAL_POINTS_GRANT_BATCH_SIZE/)
  assert.match(service, /pointsStatus/)
  assert.match(service, /notificationStatus/)
  assert.match(service, /processingToken/)
  assert.match(service, /processGlobalPointsGrantBatchChunk/)
  assert.doesNotMatch(service, /processRecipientChunks/)
  assert.doesNotMatch(service, /const batch = await processGlobalPointsGrantBatch\(created\.id/)
  assert.match(route, /requireAdmin\(GLOBAL_POINTS_GRANT_PERMISSION\)/)
  assert.match(route, /RECIPIENTS_SERVER_RESOLVED/)
  assert.match(route, /action === 'retry'/)
  assert.match(route, /action === 'continue'/)
  assert.match(route, /status: 202/)
  assert.match(route, /createGlobalPointsGrant\(/)
  assert.doesNotMatch(route, /processGlobalPointsGrantBatch\([^\n]*send/)
  assert.match(worker, /setInterval/)
  assert.match(worker, /processGlobalPointsGrantBatchChunk/)
  assert.match(server, /startGlobalPointsGrantWorker\(\)/)
  assert.match(server, /stopGlobalPointsGrantWorker\?\.\(\)/)
  assert.match(schema, /model GlobalPointsGrantBatch\s*\{[\s\S]*idempotencyKey\s+String\s+@unique[\s\S]*totalAmount/)
  assert.match(schema, /processedCount\s+Int/)
  assert.match(schema, /notificationSuccessCount\s+Int/)
  assert.match(schema, /model GlobalPointsGrantRecipient\s*\{[\s\S]*@@unique\(\[batchId, userId\]\)/)
  assert.match(schema, /pointsStatus\s+String/)
  assert.match(schema, /notificationStatus\s+String/)
  assert.match(migration, /CREATE TABLE `GlobalPointsGrantBatch`/)
  assert.match(migration, /CREATE TABLE `GlobalPointsGrantRecipient`/)
  assert.match(migration, /GlobalPointsGrantRecipient_batchId_userId_key/)
  assert.doesNotMatch(migration, /DROP TABLE|TRUNCATE|DELETE FROM/i)
  assert.match(workerMigration, /ALTER TABLE `GlobalPointsGrantBatch`/)
  assert.match(workerMigration, /UPDATE `GlobalPointsGrantRecipient`/)
  assert.match(workerMigration, /CREATE INDEX `GlobalPointsGrantRecipient_batchId_pointsStatus_id_idx`/)
  assert.match(workerMigration, /GlobalPointsGrantRecipient_processing_claim_idx/)
  assert.doesNotMatch(workerMigration, /DROP TABLE|TRUNCATE|DELETE FROM/i)
})

test('后台入口和通知中心保留图片渲染、金额文案与查看挂号费入口', () => {
  const navigation = read('lib/admin-navigation.ts')
  const permissions = read('lib/admin-permission-config.ts')
  const page = read('app/admin/global-points-grants/page.tsx')
  const manager = read('app/admin/global-points-grants/GlobalPointsGrantManager.tsx')
  const notifications = read('lib/notifications.ts')
  const client = read('app/notifications/NotificationsClient.tsx')
  assert.match(navigation, /\/admin\/global-points-grants/)
  assert.match(permissions, /'\/admin\/global-points-grants': 'user_reward_manage'/)
  assert.match(page, /requireAdminPage\([^\n]*GLOBAL_POINTS_GRANT_PERMISSION/)
  assert.match(manager, /ActivityImageUploader/)
  assert.match(manager, /确认全站发放挂号费/)
  assert.match(manager, /成功总额/)
  assert.match(manager, /重试失败用户/)
  assert.match(manager, /后台 worker/)
  assert.match(manager, /已处理/)
  assert.match(notifications, /global-points-grant:/)
  assert.match(client, /查看挂号费/)
  assert.match(client, /ImageViewer src=\{item\.imageUrl\}/)
  assert.doesNotMatch(client, /图片：\$\{item\.imageUrl\}/)
})
