import COS from 'cos-nodejs-sdk-v5'

const DEFAULT_AUDIO_PREFIX = 'guess-song'
const DEFAULT_SIGNED_URL_EXPIRES = 90

type CosConfig = {
  bucket: string
  region: string
  prefix: string
  signedUrlExpires: number
}

export type GuessSongCosClient = {
  putObject(params: {
    Bucket: string
    Region: string
    Key: string
    Body: Buffer
    ContentLength: number
    ContentType: string
    CacheControl: string
    ACL: 'private'
  }): Promise<unknown>
  getObject(params: { Bucket: string; Region: string; Key: string }): Promise<{ Body: Buffer }>
  headObject(params: { Bucket: string; Region: string; Key: string }): Promise<{
    ETag?: string
    headers?: Record<string, string | string[] | undefined>
  }>
  deleteObject(params: { Bucket: string; Region: string; Key: string }): Promise<unknown>
  deleteMultipleObject(params: {
    Bucket: string
    Region: string
    Objects: Array<{ Key: string }>
    Quiet: boolean
  }): Promise<{ Error?: Array<{ Key?: string; Code?: string }> }>
  getObjectUrl(params: {
    Bucket: string
    Region: string
    Key: string
    Sign: true
    Method: 'GET'
    Protocol: 'https:'
    Expires: number
  }): string
}

export class GuessSongStorageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GuessSongStorageError'
  }
}

let cosClient: GuessSongCosClient | null = null

function normalizePrefix(value: string | undefined) {
  return (value || DEFAULT_AUDIO_PREFIX).trim().replace(/^\/+|\/+$/g, '') || DEFAULT_AUDIO_PREFIX
}

function parseSignedUrlExpires(value: string | undefined) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 10 && parsed <= 3600
    ? parsed
    : DEFAULT_SIGNED_URL_EXPIRES
}

function getCosConfig(): CosConfig {
  const secretId = process.env.TENCENT_COS_SECRET_ID?.trim()
  const secretKey = process.env.TENCENT_COS_SECRET_KEY?.trim()
  const bucket = process.env.TENCENT_COS_BUCKET?.trim()
  const region = process.env.TENCENT_COS_REGION?.trim()
  if (!secretId || !secretKey || !bucket || !region) {
    throw new GuessSongStorageError('腾讯云 COS 音频存储尚未配置')
  }
  return {
    bucket,
    region,
    prefix: normalizePrefix(process.env.TENCENT_COS_AUDIO_PREFIX),
    signedUrlExpires: parseSignedUrlExpires(process.env.TENCENT_COS_SIGNED_URL_EXPIRES),
  }
}

function getCosClient() {
  if (cosClient) return cosClient
  const secretId = process.env.TENCENT_COS_SECRET_ID?.trim()
  const secretKey = process.env.TENCENT_COS_SECRET_KEY?.trim()
  if (!secretId || !secretKey) {
    throw new GuessSongStorageError('腾讯云 COS 音频存储尚未配置')
  }
  cosClient = new COS({ SecretId: secretId, SecretKey: secretKey })
  return cosClient
}

function errorStatus(error: unknown) {
  if (!error || typeof error !== 'object') return null
  const value = error as { statusCode?: unknown; code?: unknown }
  return {
    statusCode: typeof value.statusCode === 'number' ? value.statusCode : null,
    code: typeof value.code === 'string' ? value.code : null,
  }
}

function isMissingObject(error: unknown) {
  const detail = errorStatus(error)
  return detail?.statusCode === 404 || detail?.code === 'NoSuchKey' || detail?.code === 'NotFound'
}

function storageFailure(operation: string, error: unknown): never {
  const detail = errorStatus(error)
  console.error('[guess-song.cos]', {
    operation,
    statusCode: detail?.statusCode,
    code: detail?.code,
  })
  throw new GuessSongStorageError(`腾讯云 COS 音频${operation}失败，请稍后重试`)
}

export function buildGuessSongObjectKey(relativeKey: string) {
  const clean = relativeKey.trim().replace(/^\/+/, '')
  if (!clean || clean.includes('..')) throw new GuessSongStorageError('音频对象 Key 无效')
  const prefix = normalizePrefix(process.env.TENCENT_COS_AUDIO_PREFIX)
  return clean === prefix || clean.startsWith(`${prefix}/`) ? clean : `${prefix}/${clean}`
}

export function getGuessSongSignedUrlExpires() {
  return parseSignedUrlExpires(process.env.TENCENT_COS_SIGNED_URL_EXPIRES)
}

export function createGuessSongStorageAdapter(client: GuessSongCosClient, config: CosConfig) {
  const objectParams = (key: string) => ({
    Bucket: config.bucket,
    Region: config.region,
    Key: key,
  })

  return {
    async upload(params: { key: string; body: Buffer; contentType?: string }) {
      try {
        await client.putObject({
          ...objectParams(params.key),
          Body: params.body,
          ContentLength: params.body.byteLength,
          ContentType: params.contentType || 'audio/mpeg',
          CacheControl: 'private, max-age=31536000, immutable',
          ACL: 'private',
        })
      } catch (error) {
        storageFailure('上传', error)
      }
    },

    async download(key: string) {
      try {
        const result = await client.getObject(objectParams(key))
        return Buffer.from(result.Body)
      } catch (error) {
        if (isMissingObject(error)) throw new GuessSongStorageError('音频源文件不存在或无法读取')
        return storageFailure('读取', error)
      }
    },

    async metadata(key: string) {
      try {
        const result = await client.headObject(objectParams(key))
        const headers = result.headers || {}
        const size = Number(headers['content-length'])
        return {
          key,
          etag: result.ETag || null,
          contentType: typeof headers['content-type'] === 'string' ? headers['content-type'] : null,
          contentLength: Number.isFinite(size) ? size : null,
          lastModified: typeof headers['last-modified'] === 'string' ? headers['last-modified'] : null,
        }
      } catch (error) {
        if (isMissingObject(error)) return null
        return storageFailure('检查', error)
      }
    },

    signedUrl(key: string, expiresSeconds = config.signedUrlExpires) {
      try {
        return client.getObjectUrl({
          ...objectParams(key),
          Sign: true,
          Method: 'GET',
          Protocol: 'https:',
          Expires: expiresSeconds,
        })
      } catch (error) {
        return storageFailure('签名地址生成', error)
      }
    },

    async deleteOne(key: string) {
      try {
        await client.deleteObject(objectParams(key))
      } catch (error) {
        storageFailure('删除', error)
      }
    },

    async deleteMany(keys: readonly string[]) {
      const uniqueKeys = [...new Set(keys.filter(Boolean))]
      for (let offset = 0; offset < uniqueKeys.length; offset += 1000) {
        const batch = uniqueKeys.slice(offset, offset + 1000)
        try {
          const result = await client.deleteMultipleObject({
            Bucket: config.bucket,
            Region: config.region,
            Objects: batch.map((Key) => ({ Key })),
            Quiet: false,
          })
          if (result.Error?.length) throw Object.assign(new Error('COS_PARTIAL_DELETE'), { code: 'PartialDelete' })
        } catch (error) {
          storageFailure('批量删除', error)
        }
      }
    },
  }
}

function getStorageAdapter() {
  return createGuessSongStorageAdapter(getCosClient(), getCosConfig())
}

export async function uploadGuessSongObject(params: {
  key: string
  body: Buffer
  contentType?: string
}) {
  return getStorageAdapter().upload(params)
}

export async function downloadGuessSongObject(key: string) {
  return getStorageAdapter().download(key)
}

export async function getGuessSongObjectMetadata(key: string) {
  return getStorageAdapter().metadata(key)
}

export async function guessSongObjectExists(key: string) {
  return (await getGuessSongObjectMetadata(key)) !== null
}

export async function createGuessSongSignedUrl(key: string, expiresSeconds = getGuessSongSignedUrlExpires()) {
  return getStorageAdapter().signedUrl(key, expiresSeconds)
}

export async function deleteGuessSongObject(key: string) {
  return getStorageAdapter().deleteOne(key)
}

export async function deleteGuessSongObjects(keys: readonly string[]) {
  if (keys.length === 0) return
  return getStorageAdapter().deleteMany(keys)
}
