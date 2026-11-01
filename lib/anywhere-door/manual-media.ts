import { createHmac, timingSafeEqual } from 'node:crypto'
import { ANYWHERE_DOOR_TARGET, buildInstagramStoragePrefix } from '@/lib/anywhere-door/config'
import {
  MANUAL_POST_ABSOLUTE_IMAGE_MAX_BYTES,
  MANUAL_POST_UPLOAD_TTL_SECONDS,
  type ManualPostMediaKind,
} from '@/lib/anywhere-door/manual-media-policy'
export { isManualPostImageMimeType } from '@/lib/anywhere-door/manual-media-policy'

export function getManualPostImageLimitBytes() {
  const configuredMb = Number(process.env.IG_MAX_IMAGE_MB)
  const mb = Number.isFinite(configuredMb) && configuredMb > 0
    ? Math.min(configuredMb, MANUAL_POST_ABSOLUTE_IMAGE_MAX_BYTES / (1024 * 1024))
    : 20
  return Math.floor(mb * 1024 * 1024)
}

const RECEIPT_VERSION = 1
const DEFAULT_JWT_SECRET = 'dev-secret-change-before-production'

export type ManualPostMediaReceiptPayload = {
  version: typeof RECEIPT_VERSION
  uploadId: string
  userId: string
  key: string
  type: ManualPostMediaKind
  sha256: string
  size: number
  issuedAt: number
  expiresAt: number
}

export type VerifiedManualPostMediaReceipt = ManualPostMediaReceiptPayload & { token: string }

export function buildManualPostMediaRecords<TReceipt extends Pick<VerifiedManualPostMediaReceipt, 'type' | 'key'>>(
  receipts: readonly TReceipt[],
  storageUrlForKey: (key: string) => string,
) {
  return receipts.map((receipt, sortOrder) => ({
    type: receipt.type,
    storageUrl: storageUrlForKey(receipt.key),
    thumbnailUrl: null,
    sortOrder,
  }))
}

function receiptSecret() {
  const secret = process.env.JWT_SECRET?.trim() || ''
  return secret.length >= 32 && secret !== DEFAULT_JWT_SECRET ? `${secret}:anywhere-door-manual-media` : ''
}

function sign(encoded: string, secret: string) {
  return createHmac('sha256', secret).update(encoded).digest('base64url')
}

function equalSignature(left: string, right: string) {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

function isReceiptPayload(value: unknown): value is ManualPostMediaReceiptPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  if (row.version !== RECEIPT_VERSION
    || typeof row.uploadId !== 'string' || !/^[0-9a-f-]{36}$/.test(row.uploadId)
    || typeof row.userId !== 'string' || !row.userId || row.userId.length > 191
    || typeof row.key !== 'string'
    || (row.type !== 'IMAGE' && row.type !== 'VIDEO')
    || typeof row.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(row.sha256)
    || typeof row.size !== 'number' || !Number.isSafeInteger(row.size) || row.size < 1
    || typeof row.issuedAt !== 'number' || !Number.isSafeInteger(row.issuedAt)
    || typeof row.expiresAt !== 'number' || !Number.isSafeInteger(row.expiresAt)) return false

  const prefix = buildInstagramStoragePrefix(ANYWHERE_DOOR_TARGET, 'production').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const suffix = row.type === 'IMAGE' ? 'image-01\\.webp' : 'video-01\\.mp4'
  return new RegExp(`^${prefix}/manual:${row.uploadId}/${suffix}$`).test(row.key)
}

export function createManualPostMediaReceipt(input: {
  uploadId: string
  userId: string
  key: string
  type: ManualPostMediaKind
  sha256: string
  size: number
}, now = Date.now()) {
  const secret = receiptSecret()
  if (!secret) throw new Error('MANUAL_MEDIA_SIGNING_UNAVAILABLE')
  const issuedAt = Math.floor(now / 1000)
  const payload: ManualPostMediaReceiptPayload = {
    version: RECEIPT_VERSION,
    ...input,
    issuedAt,
    expiresAt: issuedAt + MANUAL_POST_UPLOAD_TTL_SECONDS,
  }
  if (!isReceiptPayload(payload)) throw new Error('MANUAL_MEDIA_RECEIPT_INVALID')
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return { token: `${encoded}.${sign(encoded, secret)}`, uploadId: payload.uploadId }
}

export function verifyManualPostMediaReceipt(
  value: unknown,
  userId: string,
  now = Date.now(),
  options: { allowExpiredForCleanup?: boolean } = {},
): VerifiedManualPostMediaReceipt | null {
  const secret = receiptSecret()
  if (!secret || typeof value !== 'string' || value.length > 4096) return null
  const [encoded, signature, extra] = value.split('.')
  if (!encoded || !signature || extra !== undefined || !equalSignature(sign(encoded, secret), signature)) return null
  try {
    const payload: unknown = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
    if (!isReceiptPayload(payload) || payload.userId !== userId) return null
    const nowSeconds = Math.floor(now / 1000)
    if (payload.issuedAt > nowSeconds + 60 || (!options.allowExpiredForCleanup && payload.expiresAt <= nowSeconds)
      || payload.expiresAt - payload.issuedAt > MANUAL_POST_UPLOAD_TTL_SECONDS) return null
    return { ...payload, token: value }
  } catch {
    return null
  }
}
