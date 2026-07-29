import COS from 'cos-nodejs-sdk-v5'

type MusicMediaKind = 'cover' | 'preview'

export class MusicMediaStorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MusicMediaStorageError'
  }
}

function getConfig() {
  const secretId = process.env.TENCENT_COS_SECRET_ID?.trim()
  const secretKey = process.env.TENCENT_COS_SECRET_KEY?.trim()
  const bucket = (process.env.TENCENT_COS_MUSIC_BUCKET || process.env.TENCENT_COS_BUCKET)?.trim()
  const region = (process.env.TENCENT_COS_MUSIC_REGION || process.env.TENCENT_COS_REGION)?.trim()
  if (!secretId || !secretKey || !bucket || !region) {
    throw new MusicMediaStorageError('腾讯云 COS 音乐媒体存储尚未配置')
  }
  return { secretId, secretKey, bucket, region }
}

function publicUrl(bucket: string, region: string, key: string) {
  const base = process.env.TENCENT_COS_MUSIC_PUBLIC_BASE_URL?.trim().replace(/\/+$/, '')
    || `https://${bucket}.cos.${region}.myqcloud.com`
  return `${base}/${key.split('/').map(encodeURIComponent).join('/')}`
}

function logStorageFailure(kind: MusicMediaKind, error: unknown) {
  const detail = error && typeof error === 'object'
    ? error as { code?: unknown; statusCode?: unknown }
    : null
  console.error('[music-media.cos]', {
    kind,
    code: typeof detail?.code === 'string' ? detail.code : undefined,
    statusCode: typeof detail?.statusCode === 'number' ? detail.statusCode : undefined,
  })
}

export async function uploadMusicMedia(params: {
  kind: MusicMediaKind
  key: string
  body: Buffer
  contentType: 'image/webp' | 'audio/mpeg'
}) {
  const config = getConfig()
  const key = params.key.trim().replace(/^\/+/, '')
  if (!key || key.includes('..')) throw new MusicMediaStorageError('音乐媒体对象路径无效')
  const client = new COS({ SecretId: config.secretId, SecretKey: config.secretKey })
  try {
    await client.putObject({
      Bucket: config.bucket,
      Region: config.region,
      Key: key,
      Body: params.body,
      ContentLength: params.body.byteLength,
      ContentType: params.contentType,
      CacheControl: 'public, max-age=31536000, immutable',
      ACL: 'public-read',
    })
  } catch (error) {
    logStorageFailure(params.kind, error)
    throw new MusicMediaStorageError(params.kind === 'cover'
      ? '封面上传至腾讯云 COS 失败，请稍后重试'
      : '试听片段上传至腾讯云 COS 失败，请稍后重试')
  }
  return publicUrl(config.bucket, config.region, key)
}
