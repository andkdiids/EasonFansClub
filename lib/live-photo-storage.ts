import COS from 'cos-nodejs-sdk-v5'
import { deleteFromCos, readCosEnv } from '@/lib/tencent-cos'

const STORAGE_TIMEOUT_MS = 120_000

function storageConfig() {
  const secretId = readCosEnv('TENCENT_COS_SECRET_ID', 'COS_SECRET_ID')
  const secretKey = readCosEnv('TENCENT_COS_SECRET_KEY', 'COS_SECRET_KEY')
  const bucket = readCosEnv('TENCENT_COS_BUCKET', 'COS_BUCKET')
  const region = readCosEnv('TENCENT_COS_REGION', 'COS_REGION')
  if (!secretId || !secretKey || !bucket || !region) throw new Error('LIVE_PHOTO_STORAGE_NOT_CONFIGURED')
  return {
    secretId,
    secretKey,
    sessionToken: readCosEnv('TENCENT_COS_SESSION_TOKEN', 'COS_SESSION_TOKEN') || undefined,
    bucket,
    region,
  }
}

let cachedClient: COS | null = null
function client() {
  if (cachedClient) return cachedClient
  const config = storageConfig()
  cachedClient = new COS({
    SecretId: config.secretId,
    SecretKey: config.secretKey,
    ...(config.sessionToken ? { SecurityToken: config.sessionToken } : {}),
  })
  return cachedClient
}

function normalizeKey(key: string) {
  const value = key.trim().replace(/^\/+/, '')
  if (!value || value.includes('..')) throw new Error('LIVE_PHOTO_KEY_INVALID')
  return value
}

/** Unapproved originals and transcoded results stay private; only the
 * controlled API can read them after checking ownership/review status. */
export async function uploadPrivateLivePhotoObject(params: { key: string; body: Buffer; contentType: string }) {
  const config = storageConfig()
  const key = normalizeKey(params.key)
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      client().putObject({
        Bucket: config.bucket,
        Region: config.region,
        Key: key,
        Body: params.body,
        ContentLength: params.body.byteLength,
        ContentType: params.contentType,
        CacheControl: 'private, no-store, max-age=0',
        ACL: 'private',
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('LIVE_PHOTO_UPLOAD_TIMEOUT')), STORAGE_TIMEOUT_MS)
      }),
    ])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
  return key
}

export async function deleteLivePhotoObjects(keys: readonly (string | null | undefined)[]) {
  for (const raw of keys) {
    if (!raw) continue
    try {
      await deleteFromCos(normalizeKey(raw))
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      if (code !== 'NoSuchKey' && code !== 'NOSUCHKEY') console.warn('[live-photo.cleanup]', { code })
    }
  }
}

export type PrivateObjectRangeResult = {
  body: Buffer
  status: number
  contentLength: number
  total: number
  contentRange: string | null
  contentType: string
}

export async function readPrivateLivePhotoObject(params: {
  key: string
  range: { start: number; end: number; total: number } | null
}): Promise<PrivateObjectRangeResult> {
  const config = storageConfig()
  const key = normalizeKey(params.key)
  const range = params.range
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    const result = await Promise.race([
      new Promise<{ body: Buffer; headers: Record<string, string> }>((resolve, reject) => {
        client().getObject({
          Bucket: config.bucket,
          Region: config.region,
          Key: key,
          ...(range ? { Range: `bytes=${range.start}-${range.end}` } : {}),
        }, (error, data) => {
          if (error) {
            reject(error)
            return
          }
          const response = data as { Body?: Buffer | string; headers?: Record<string, string> }
          if (!response?.Body) {
            reject(new Error('LIVE_PHOTO_OBJECT_EMPTY'))
            return
          }
          resolve({
            body: Buffer.isBuffer(response.Body) ? response.Body : Buffer.from(response.Body),
            headers: response.headers || {},
          })
        })
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('LIVE_PHOTO_READ_TIMEOUT')), STORAGE_TIMEOUT_MS)
      }),
    ])
    const total = range?.total ?? result.body.byteLength
    const contentType = result.headers['content-type'] || (key.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg')
    return {
      body: result.body,
      status: range ? 206 : 200,
      contentLength: result.body.byteLength,
      total,
      contentRange: range ? `bytes ${range.start}-${range.end}/${range.total}` : null,
      contentType,
    }
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}

export async function headPrivateLivePhotoObject(key: string) {
  const config = storageConfig()
  return new Promise<number>((resolve, reject) => {
    client().headObject({ Bucket: config.bucket, Region: config.region, Key: normalizeKey(key) }, (error, data) => {
      if (error) {
        reject(error)
        return
      }
      resolve(Number((data as { headers?: Record<string, string> })?.headers?.['content-length'] || 0))
    })
  })
}
