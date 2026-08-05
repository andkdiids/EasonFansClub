import COS from 'cos-nodejs-sdk-v5'

const COS_UPLOAD_TIMEOUT_MS = 120_000

export class SiteMediaStorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SiteMediaStorageError'
  }
}

function getConfig() {
  const secretId = process.env.TENCENT_COS_SECRET_ID?.trim()
  const secretKey = process.env.TENCENT_COS_SECRET_KEY?.trim()
  const bucket = process.env.TENCENT_COS_BUCKET?.trim()
  const region = process.env.TENCENT_COS_REGION?.trim()
  if (!secretId || !secretKey || !bucket || !region) {
    throw new SiteMediaStorageError('腾讯云 COS 图片存储尚未配置完整')
  }
  return { secretId, secretKey, bucket, region }
}

function publicUrl(bucket: string, region: string, key: string) {
  const base = process.env.TENCENT_COS_SITE_PUBLIC_BASE_URL?.trim().replace(/\/+$/, '')
    || process.env.TENCENT_COS_PUBLIC_BASE_URL?.trim().replace(/\/+$/, '')
    || `https://${bucket}.cos.${region}.myqcloud.com`
  return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`
}

export async function uploadSiteImage(params: { key: string; body: Buffer }) {
  const config = getConfig()
  const key = params.key.trim().replace(/^\/+/, '')
  if (!key || key.includes('..')) throw new SiteMediaStorageError('图片对象路径无效')

  const client = new COS({ SecretId: config.secretId, SecretKey: config.secretKey })
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      client.putObject({
        Bucket: config.bucket,
        Region: config.region,
        Key: key,
        Body: params.body,
        ContentLength: params.body.byteLength,
        ContentType: 'image/webp',
        CacheControl: 'public, max-age=31536000, immutable',
        ACL: 'public-read',
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('COS_UPLOAD_TIMEOUT')), COS_UPLOAD_TIMEOUT_MS)
      }),
    ])
  } catch (error) {
    console.error('[site-media.cos]', {
      code: error && typeof error === 'object' && 'code' in error ? error.code : undefined,
      message: error instanceof Error ? error.message.slice(0, 300) : undefined,
    })
    throw new SiteMediaStorageError(error instanceof Error && error.message === 'COS_UPLOAD_TIMEOUT'
      ? '上传腾讯云 COS 超时，请稍后重试'
      : '图片上传至腾讯云 COS 失败，请稍后重试')
  } finally {
    if (timeout) clearTimeout(timeout)
  }

  return publicUrl(config.bucket, config.region, key)
}
