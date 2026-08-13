import COS from 'cos-nodejs-sdk-v5'
import { buildPublicMediaUrl } from '@/lib/media-url'
import { putCosObjectWithAclFallback, readCosEnv } from '@/lib/tencent-cos'

const COS_UPLOAD_TIMEOUT_MS = 120_000

export class SiteMediaStorageError extends Error {
  detail?: string

  constructor(message: string, detail?: string) {
    super(message)
    this.name = 'SiteMediaStorageError'
    this.detail = detail
  }
}

function getConfig() {
  const secretId = readCosEnv('TENCENT_COS_SECRET_ID', 'COS_SECRET_ID')
  const secretKey = readCosEnv('TENCENT_COS_SECRET_KEY', 'COS_SECRET_KEY')
  const bucket = readCosEnv('TENCENT_COS_BUCKET', 'COS_BUCKET')
  const region = readCosEnv('TENCENT_COS_REGION', 'COS_REGION')
  if (!secretId || !secretKey || !bucket || !region) {
    throw new SiteMediaStorageError('腾讯云 COS 图片存储尚未配置完整')
  }
  return { secretId, secretKey, bucket, region }
}

export async function uploadSiteImage(params: { key: string; body: Buffer; contentType?: string }) {
  const config = getConfig()
  const key = params.key.trim().replace(/^\/+/, '')
  if (!key || key.includes('..')) throw new SiteMediaStorageError('图片对象路径无效')

  const client = new COS({ SecretId: config.secretId, SecretKey: config.secretKey })
  const contentType = params.contentType?.trim() || 'image/webp'
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      putCosObjectWithAclFallback(client, {
        Bucket: config.bucket,
        Region: config.region,
        Key: key,
        Body: params.body,
        ContentLength: params.body.byteLength,
        ContentType: contentType,
        CacheControl: 'public, max-age=31536000, immutable',
        ACL: 'public-read',
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('COS_UPLOAD_TIMEOUT')), COS_UPLOAD_TIMEOUT_MS)
      }),
    ])
  } catch (error) {
    const detail = error instanceof Error ? error.message.slice(0, 300) : String(error || 'UNKNOWN_ERROR').slice(0, 300)
    console.error('[site-media.cos]', {
      code: error && typeof error === 'object' && 'code' in error ? error.code : undefined,
      message: detail,
    })
    throw new SiteMediaStorageError(error instanceof Error && error.message === 'COS_UPLOAD_TIMEOUT'
      ? '上传腾讯云 COS 超时，请稍后重试'
      : '图片上传至腾讯云 COS 失败，请稍后重试', detail)
  } finally {
    if (timeout) clearTimeout(timeout)
  }

  return buildPublicMediaUrl(key)
}
