import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

export const TOPIC_LOTTERY_ADDRESS_KEYS_ENV = 'TOPIC_LOTTERY_ADDRESS_KEYS'
export const TOPIC_LOTTERY_ADDRESS_ACTIVE_KEY_ID_ENV = 'TOPIC_LOTTERY_ADDRESS_ACTIVE_KEY_ID'

const ENVELOPE_VERSION = 1
const ALGORITHM = 'A256GCM'
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16
const KEY_LENGTH = 32
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/

export type TopicLotteryPiiContext = {
  activityId: string
  winnerId: string
}

export type TopicLotteryPiiEnvelope = {
  v: 1
  alg: typeof ALGORITHM
  keyVersion: string
  iv: string
  tag: string
  ciphertext: string
}

export type TopicLotteryPiiKeyRing = {
  activeKeyId: string
  keys: ReadonlyMap<string, Buffer>
}

export type TopicLotteryPiiEnvironment = Record<string, string | undefined>

export class TopicLotteryPiiError extends Error {
  constructor(
    readonly code:
      | 'TOPIC_LOTTERY_PII_KEY_UNAVAILABLE'
      | 'TOPIC_LOTTERY_PII_KEY_INVALID'
      | 'TOPIC_LOTTERY_PII_KEY_VERSION_UNAVAILABLE'
      | 'TOPIC_LOTTERY_PII_ENVELOPE_INVALID'
      | 'TOPIC_LOTTERY_PII_CONTEXT_INVALID'
      | 'TOPIC_LOTTERY_PII_ENCRYPT_FAILED'
      | 'TOPIC_LOTTERY_PII_DECRYPT_FAILED',
    message: string,
    readonly status = 503,
  ) {
    super(message)
    this.name = 'TopicLotteryPiiError'
  }
}

function asEnvironment(environment: TopicLotteryPiiEnvironment | NodeJS.ProcessEnv = process.env) {
  return environment as TopicLotteryPiiEnvironment
}

function requireContext(context: TopicLotteryPiiContext) {
  if (!context || typeof context.activityId !== 'string' || typeof context.winnerId !== 'string') {
    throw new TopicLotteryPiiError('TOPIC_LOTTERY_PII_CONTEXT_INVALID', '抽奖收件信息加密上下文无效', 400)
  }
  if (!context.activityId.trim() || !context.winnerId.trim()) {
    throw new TopicLotteryPiiError('TOPIC_LOTTERY_PII_CONTEXT_INVALID', '抽奖收件信息加密上下文无效', 400)
  }
  return { activityId: context.activityId.trim(), winnerId: context.winnerId.trim() }
}

/**
 * The authenticated activity and winner IDs are part of the AEAD associated
 * data. Ciphertext copied to another winner or another activity therefore
 * fails authentication even if the same key is available there.
 */
export function topicLotteryPiiAad(context: TopicLotteryPiiContext) {
  const value = requireContext(context)
  return `topic-activity-v2-lottery:${value.activityId}:${value.winnerId}`
}

function invalidKey(message: string): never {
  throw new TopicLotteryPiiError('TOPIC_LOTTERY_PII_KEY_INVALID', message)
}

/**
 * Read a versioned key ring from environment variables without ever providing
 * a development fallback. JSON keeps key IDs independent from key material:
 *   TOPIC_LOTTERY_ADDRESS_KEYS={"v1":"<base64 32-byte key>"}
 */
export function readTopicLotteryPiiKeyRing(environment: TopicLotteryPiiEnvironment | NodeJS.ProcessEnv = process.env): TopicLotteryPiiKeyRing {
  const env = asEnvironment(environment)
  const raw = env[TOPIC_LOTTERY_ADDRESS_KEYS_ENV]?.trim()
  if (!raw) throw new TopicLotteryPiiError('TOPIC_LOTTERY_PII_KEY_UNAVAILABLE', '抽奖收件加密密钥未配置')

  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { invalidKey('抽奖收件加密密钥配置无效') }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) invalidKey('抽奖收件加密密钥配置无效')
  const keys = new Map<string, Buffer>()
  for (const [keyId, encodedValue] of Object.entries(parsed as Record<string, unknown>)) {
    if (!VERSION_PATTERN.test(keyId) || typeof encodedValue !== 'string' || !encodedValue || !/^[A-Za-z0-9+/]+={0,2}$/.test(encodedValue)) invalidKey('抽奖收件加密密钥配置无效')
    let key: Buffer
    try { key = Buffer.from(encodedValue, 'base64') } catch { invalidKey('抽奖收件加密密钥配置无效') }
    if (key.length !== KEY_LENGTH || key.toString('base64') !== encodedValue) invalidKey('抽奖收件加密密钥长度无效')
    keys.set(keyId, key)
  }
  if (!keys.size) throw new TopicLotteryPiiError('TOPIC_LOTTERY_PII_KEY_UNAVAILABLE', '抽奖收件加密密钥未配置')

  const activeKeyId = env[TOPIC_LOTTERY_ADDRESS_ACTIVE_KEY_ID_ENV]?.trim()
  if (!activeKeyId || !keys.has(activeKeyId)) invalidKey('抽奖收件加密当前版本不存在')
  return { activeKeyId, keys }
}

export type TopicLotteryPiiConfigStatus = {
  configured: boolean
  usable: boolean
  activeKeyId: string | null
  keyIds: string[]
  errorCode: TopicLotteryPiiError['code'] | null
}

/** Safe for server boot/admin status: it returns metadata only, never key material. */
export function getTopicLotteryPiiConfigStatus(environment: TopicLotteryPiiEnvironment | NodeJS.ProcessEnv = process.env): TopicLotteryPiiConfigStatus {
  try {
    const ring = readTopicLotteryPiiKeyRing(environment)
    return { configured: true, usable: true, activeKeyId: ring.activeKeyId, keyIds: [...ring.keys.keys()], errorCode: null }
  } catch (error) {
    const piiError = error instanceof TopicLotteryPiiError ? error : null
    const raw = asEnvironment(environment)[TOPIC_LOTTERY_ADDRESS_KEYS_ENV]?.trim()
    return { configured: Boolean(raw), usable: false, activeKeyId: null, keyIds: [], errorCode: piiError?.code || 'TOPIC_LOTTERY_PII_KEY_INVALID' }
  }
}

export const getTopicLotteryAddressKeyStatus = getTopicLotteryPiiConfigStatus

function encode(value: Buffer) {
  return value.toString('base64url')
}

function decode(value: unknown) {
  if (typeof value !== 'string' || !value || !BASE64URL_PATTERN.test(value)) return null
  try {
    return Buffer.from(value, 'base64url')
  } catch {
    return null
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stableValue(item)]))
  }
  return value
}

function serialize(value: unknown) {
  try {
    const result = JSON.stringify(stableValue(value))
    if (!result || result === undefined) throw new Error('not serializable')
    return result
  } catch {
    throw new TopicLotteryPiiError('TOPIC_LOTTERY_PII_ENCRYPT_FAILED', '抽奖收件信息无法安全序列化')
  }
}

export function encryptTopicLotteryPii(value: unknown, context: TopicLotteryPiiContext, environment: TopicLotteryPiiEnvironment | NodeJS.ProcessEnv = process.env) {
  const keyRing = readTopicLotteryPiiKeyRing(environment)
  const key = keyRing.keys.get(keyRing.activeKeyId)
  if (!key) throw new TopicLotteryPiiError('TOPIC_LOTTERY_PII_KEY_UNAVAILABLE', '抽奖收件加密当前版本不存在')
  const iv = randomBytes(IV_LENGTH)
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv)
    cipher.setAAD(Buffer.from(topicLotteryPiiAad(context), 'utf8'))
    const ciphertext = Buffer.concat([cipher.update(serialize(value), 'utf8'), cipher.final()])
    return JSON.stringify({
      v: ENVELOPE_VERSION,
      alg: ALGORITHM,
      keyVersion: keyRing.activeKeyId,
      iv: encode(iv),
      tag: encode(cipher.getAuthTag()),
      ciphertext: encode(ciphertext),
    } satisfies TopicLotteryPiiEnvelope)
  } catch (error) {
    if (error instanceof TopicLotteryPiiError) throw error
    throw new TopicLotteryPiiError('TOPIC_LOTTERY_PII_ENCRYPT_FAILED', '抽奖收件信息加密失败')
  }
}

function parseEnvelope(value: string): TopicLotteryPiiEnvelope {
  let parsed: unknown
  try { parsed = JSON.parse(value) } catch { throw new TopicLotteryPiiError('TOPIC_LOTTERY_PII_ENVELOPE_INVALID', '抽奖收件信息密文格式无效', 400) }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TopicLotteryPiiError('TOPIC_LOTTERY_PII_ENVELOPE_INVALID', '抽奖收件信息密文格式无效', 400)
  const input = parsed as Record<string, unknown>
  if (input.v !== ENVELOPE_VERSION || input.alg !== ALGORITHM || typeof input.keyVersion !== 'string' || !VERSION_PATTERN.test(input.keyVersion)) {
    throw new TopicLotteryPiiError('TOPIC_LOTTERY_PII_ENVELOPE_INVALID', '抽奖收件信息密文格式无效', 400)
  }
  const iv = decode(input.iv)
  const tag = decode(input.tag)
  const ciphertext = decode(input.ciphertext)
  if (!iv || iv.length !== IV_LENGTH || !tag || tag.length !== AUTH_TAG_LENGTH || !ciphertext || !ciphertext.length) {
    throw new TopicLotteryPiiError('TOPIC_LOTTERY_PII_ENVELOPE_INVALID', '抽奖收件信息密文格式无效', 400)
  }
  return { v: ENVELOPE_VERSION, alg: ALGORITHM, keyVersion: input.keyVersion, iv: input.iv as string, tag: input.tag as string, ciphertext: input.ciphertext as string }
}

export function decryptTopicLotteryPii<T = unknown>(value: string, context: TopicLotteryPiiContext, environment: TopicLotteryPiiEnvironment | NodeJS.ProcessEnv = process.env): T {
  const envelope = parseEnvelope(value)
  const keyRing = readTopicLotteryPiiKeyRing(environment)
  const key = keyRing.keys.get(envelope.keyVersion)
  if (!key) throw new TopicLotteryPiiError('TOPIC_LOTTERY_PII_KEY_VERSION_UNAVAILABLE', '抽奖收件历史加密密钥版本不可用')
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, decode(envelope.iv) as Buffer)
    decipher.setAAD(Buffer.from(topicLotteryPiiAad(context), 'utf8'))
    decipher.setAuthTag(decode(envelope.tag) as Buffer)
    const plaintext = Buffer.concat([decipher.update(decode(envelope.ciphertext) as Buffer), decipher.final()]).toString('utf8')
    return JSON.parse(plaintext) as T
  } catch {
    throw new TopicLotteryPiiError('TOPIC_LOTTERY_PII_DECRYPT_FAILED', '抽奖收件信息无法解密')
  }
}

/** A non-reversible audit summary; plaintext address fields never enter Audit.detail. */
export function topicLotteryPiiSummaryHash(value: unknown) {
  return createHash('sha256').update(serialize(value), 'utf8').digest('hex')
}
