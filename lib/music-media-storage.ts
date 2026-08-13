import COS from 'cos-nodejs-sdk-v5'
import { buildPublicMediaUrl } from '@/lib/media-url'
import { putCosObjectWithAclFallback, readCosEnv } from '@/lib/tencent-cos'

type MusicMediaKind = 'cover' | 'preview'

const COS_UPLOAD_TIMEOUT_MS = 120_000

export class MusicMediaStorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MusicMediaStorageError'
  }
}

function getConfig() {
  const secretId = readCosEnv('TENCENT_COS_SECRET_ID', 'COS_SECRET_ID')
  const secretKey = readCosEnv('TENCENT_COS_SECRET_KEY', 'COS_SECRET_KEY')
  const bucket = readCosEnv('TENCENT_COS_MUSIC_BUCKET', 'COS_MUSIC_BUCKET', 'TENCENT_COS_BUCKET', 'COS_BUCKET')
  const region = readCosEnv('TENCENT_COS_MUSIC_REGION', 'COS_MUSIC_REGION', 'TENCENT_COS_REGION', 'COS_REGION')
  if (!secretId || !secretKey || !bucket || !region) {
    throw new MusicMediaStorageError('腾讯云 COS 音乐媒体存储尚未配置完整')
  }
  return { secretId, secretKey, bucket, region }
}

export function buildMusicMediaPublicUrl(key: string) {
  return buildPublicMediaUrl(key)
}

function logStorageFailure(kind: MusicMediaKind, error: unknown) {
  const detail = error && typeof error === 'object'
    ? error as { code?: unknown; statusCode?: unknown; message?: unknown }
    : null
  console.error('[music-media.cos]', {
    kind,
    code: typeof detail?.code === 'string' ? detail.code : undefined,
    statusCode: typeof detail?.statusCode === 'number' ? detail.statusCode : undefined,
    message: typeof detail?.message === 'string' ? detail.message.slice(0, 300) : undefined,
  })
}

export async function uploadMusicMedia(params: {
  kind: MusicMediaKind
  key: string
  body: Buffer
  contentType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp' | 'audio/mpeg'
}) {
  const config = getConfig()
  const key = params.key.trim().replace(/^\/+/, '')
  if (!key || key.includes('..')) throw new MusicMediaStorageError('音乐媒体对象路径无效')
  const client = new COS({ SecretId: config.secretId, SecretKey: config.secretKey })
  const putObject = {
    Bucket: config.bucket,
    Region: config.region,
    Key: key,
    Body: params.body,
    ContentLength: params.body.byteLength,
    ContentType: params.contentType,
    CacheControl: 'public, max-age=31536000, immutable',
    ACL: 'public-read' as const,
  }
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      params.kind === 'cover' ? putCosObjectWithAclFallback(client, putObject) : client.putObject(putObject),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('COS_UPLOAD_TIMEOUT')), COS_UPLOAD_TIMEOUT_MS)
      }),
    ])
  } catch (error) {
    logStorageFailure(params.kind, error)
    const timedOut = error instanceof Error && error.message === 'COS_UPLOAD_TIMEOUT'
    throw new MusicMediaStorageError(timedOut
      ? '上传腾讯云 COS 超时，请检查服务器网络与 COS 配置'
      : params.kind === 'cover'
        ? '封面上传至腾讯云 COS 失败，请稍后重试'
        : '试听片段上传至腾讯云 COS 失败，请稍后重试')
  } finally {
    if (timeout) clearTimeout(timeout)
  }
  return buildMusicMediaPublicUrl(key)
}
