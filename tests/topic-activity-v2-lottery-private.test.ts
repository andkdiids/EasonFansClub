import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import {
  decryptTopicLotteryPii,
  encryptTopicLotteryPii,
  getTopicLotteryPiiConfigStatus,
  readTopicLotteryPiiKeyRing,
  TopicLotteryPiiError,
  topicLotteryPiiAad,
  topicLotteryPiiSummaryHash,
} from '@/lib/topic-activity-v2-lottery-private'

const root = process.cwd()
const read = (file: string) => readFileSync(join(root, file), 'utf8')
const keyV1 = '11'.repeat(32)
const keyV2 = '22'.repeat(32)
const environment = { TOPIC_LOTTERY_ADDRESS_KEYS: JSON.stringify({ v1: Buffer.from(keyV1, 'hex').toString('base64'), v2: Buffer.from(keyV2, 'hex').toString('base64') }), TOPIC_LOTTERY_ADDRESS_ACTIVE_KEY_ID: 'v2' }
const context = { activityId: 'activity-1', winnerId: 'winner-1' }
const address = { recipient: '陈小明', phone: '+8613800000000', province: '广东省', city: '广州市', district: '越秀区', address: '中山一路 1 号', remark: '' }

test('实物抽奖收件信息使用版本化 AES-256-GCM，密文不包含明文', () => {
  const ciphertext = encryptTopicLotteryPii(address, context, environment)
  assert.doesNotMatch(ciphertext, /陈小明|13800000000|中山一路/)
  const envelope = JSON.parse(ciphertext) as Record<string, unknown>
  assert.equal(envelope.alg, 'A256GCM')
  assert.equal(envelope.keyVersion, 'v2')
  assert.equal(decryptTopicLotteryPii<typeof address>(ciphertext, context, environment).recipient, '陈小明')
  assert.equal(topicLotteryPiiAad(context), 'topic-activity-v2-lottery:activity-1:winner-1')
})

test('密钥轮换保留旧版本解密，活动或中奖者变化会触发认证失败', () => {
  const oldCiphertext = encryptTopicLotteryPii(address, context, { TOPIC_LOTTERY_ADDRESS_KEYS: JSON.stringify({ v1: Buffer.from(keyV1, 'hex').toString('base64') }), TOPIC_LOTTERY_ADDRESS_ACTIVE_KEY_ID: 'v1' })
  assert.deepEqual(decryptTopicLotteryPii<typeof address>(oldCiphertext, context, environment), address)
  assert.throws(() => decryptTopicLotteryPii(oldCiphertext, { ...context, winnerId: 'winner-2' }, environment), (error: unknown) => error instanceof TopicLotteryPiiError && error.code === 'TOPIC_LOTTERY_PII_DECRYPT_FAILED')
})

test('缺失、错误或不存在的密钥配置 fail-closed，不提供明文降级', () => {
  assert.throws(() => readTopicLotteryPiiKeyRing({}), (error: unknown) => error instanceof TopicLotteryPiiError && error.code === 'TOPIC_LOTTERY_PII_KEY_UNAVAILABLE' && error.status === 503)
  assert.throws(() => readTopicLotteryPiiKeyRing({ TOPIC_LOTTERY_ADDRESS_KEYS: '{"v1":"not-a-key"}' }), (error: unknown) => error instanceof TopicLotteryPiiError && error.code === 'TOPIC_LOTTERY_PII_KEY_INVALID' && error.status === 503)
  assert.throws(() => readTopicLotteryPiiKeyRing({ TOPIC_LOTTERY_ADDRESS_KEYS: JSON.stringify({ v1: Buffer.from(keyV1, 'hex').toString('base64') }) }), (error: unknown) => error instanceof TopicLotteryPiiError && error.code === 'TOPIC_LOTTERY_PII_KEY_INVALID' && error.status === 503)
  const ciphertext = encryptTopicLotteryPii(address, context, { TOPIC_LOTTERY_ADDRESS_KEYS: JSON.stringify({ v1: Buffer.from(keyV1, 'hex').toString('base64') }), TOPIC_LOTTERY_ADDRESS_ACTIVE_KEY_ID: 'v1' })
  assert.throws(() => decryptTopicLotteryPii(ciphertext, context, { TOPIC_LOTTERY_ADDRESS_KEYS: JSON.stringify({ v2: Buffer.from(keyV2, 'hex').toString('base64') }), TOPIC_LOTTERY_ADDRESS_ACTIVE_KEY_ID: 'v2' }), (error: unknown) => error instanceof TopicLotteryPiiError && error.code === 'TOPIC_LOTTERY_PII_KEY_VERSION_UNAVAILABLE' && error.status === 503)
  assert.deepEqual(getTopicLotteryPiiConfigStatus({}), { configured: false, usable: false, activeKeyId: null, keyIds: [], errorCode: 'TOPIC_LOTTERY_PII_KEY_UNAVAILABLE' })
  assert.deepEqual(getTopicLotteryPiiConfigStatus(environment), { configured: true, usable: true, activeKeyId: 'v2', keyIds: ['v1', 'v2'], errorCode: null })
})

test('审计摘要是不可逆 hash，fulfillment 契约固定使用锁顺序和幂等通知 key', () => {
  assert.match(topicLotteryPiiSummaryHash(address), /^[0-9a-f]{64}$/)
  const source = read('lib/topic-activity-v2-lottery-fulfillment.ts')
  assert.match(source, /export async function getTopicLotteryAddress/)
  assert.match(source, /export async function saveTopicLotteryAddress/)
  assert.match(source, /export async function getAdminTopicLotteryAddress/)
  assert.match(source, /export async function updateTopicLotteryShipment/)
  assert.match(source, /export async function deliverTopicLotteryNotices/)
  assert.match(source, /export async function purgeExpiredTopicLotteryPII/)
  assert.match(source, /lockTopicLottery\(tx, activityId\)/)
  assert.match(source, /const notificationKey = `topic-v2-lottery-win:\$\{candidate\.winnerId\}`/)
  assert.match(source, /upsertNotificationWithDb\(tx/)
  assert.match(source, /recipientId_key: \{ recipientId: context\.winner\.userId, key: notificationKey \}/)
  assert.doesNotMatch(source, /createManyNotificationsWithDb\(tx/)
  assert.match(source, /staleSending/)
  assert.match(source, /action: 'PII_PURGED'/)
  assert.doesNotMatch(source, /console\.(log|error).*address|console\.(log|error).*phone|console\.(log|error).*ciphertext/)
})

test('权限与环境样例保持最小授权且不写入真实 secret', () => {
  const permissions = read('lib/admin-permission-config.ts')
  const env = read('.env.example')
  assert.match(permissions, /key: 'activity_lottery_shipping'/)
  assert.match(env, /TOPIC_LOTTERY_ADDRESS_KEYS=""/)
  assert.match(env, /TOPIC_LOTTERY_ADDRESS_ACTIVE_KEY_ID="v1"/)
  assert.doesNotMatch(env, /TOPIC_LOTTERY_ADDRESS_KEYS="[^"\n]+"/)
  const activityRoute = read('app/api/admin/activities/[activityId]/route.ts')
  assert.match(activityRoute, /FOR UPDATE`[\s\S]*await assertTopicLotteryActivityWindow\(tx, activityId, \{ \.\.\.normalized\.value, \.\.\.topicConfig\.value \}\)[\s\S]*tx\.activity\.update\(/)
  assert.match(activityRoute, /error instanceof TopicLotteryError[\s\S]*code: error\.code/)
})
