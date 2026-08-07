import COS from 'cos-nodejs-sdk-v5'

type CosConfig = {
  secretId: string
  secretKey: string
  bucket: string
  region: string
}

let cachedConfig: CosConfig | null = null
let cachedClient: COS | null = null

// 支持 TENCENT_COS_*（主）与 COS_*（兼容）两组环境变量名
function readEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return ''
}

// 返回缺失的配置项名称列表；为空表示配置完整
export function missingCosConfig() {
  const missing: string[] = []
  if (!readEnv('TENCENT_COS_SECRET_ID', 'COS_SECRET_ID')) missing.push('TENCENT_COS_SECRET_ID')
  if (!readEnv('TENCENT_COS_SECRET_KEY', 'COS_SECRET_KEY')) missing.push('TENCENT_COS_SECRET_KEY')
  if (!readEnv('TENCENT_COS_BUCKET', 'COS_BUCKET')) missing.push('TENCENT_COS_BUCKET')
  if (!readEnv('TENCENT_COS_REGION', 'COS_REGION')) missing.push('TENCENT_COS_REGION')
  return missing
}

function getCosClient() {
  if (cachedClient && cachedConfig) return { cos: cachedClient, config: cachedConfig }

  const missing = missingCosConfig()
  if (missing.length) {
    throw new Error(`腾讯云 COS 配置缺失：${missing.join('、')}`)
  }

  const config: CosConfig = {
    secretId: readEnv('TENCENT_COS_SECRET_ID', 'COS_SECRET_ID'),
    secretKey: readEnv('TENCENT_COS_SECRET_KEY', 'COS_SECRET_KEY'),
    bucket: readEnv('TENCENT_COS_BUCKET', 'COS_BUCKET'),
    region: readEnv('TENCENT_COS_REGION', 'COS_REGION'),
  }

  cachedConfig = config
  cachedClient = new COS({
    SecretId: config.secretId,
    SecretKey: config.secretKey,
  })
  return { cos: cachedClient, config }
}

// 提取 COS SDK 错误中的可读信息，避免静默失败
export function describeCosError(error: unknown) {
  if (!error || typeof error !== 'object') return String(error || '未知错误')
  const err = error as { code?: string; message?: string; statusCode?: number; error?: { Code?: string; Message?: string } }
  const parts = [
    err.error?.Code || err.code,
    err.error?.Message || err.message,
    err.statusCode ? `HTTP ${err.statusCode}` : '',
  ].filter(Boolean)
  return parts.join('：') || '未知错误'
}

export async function uploadToCos(params: {
  key: string
  body: Buffer | Uint8Array
  contentType?: string
}) {
  const { key, body, contentType } = params
  const { cos, config } = getCosClient()

  return new Promise<string>((resolve, reject) => {
    cos.putObject(
      {
        Bucket: config.bucket,
        Region: config.region,
        Key: key,
        Body: Buffer.from(body),
        ContentType: contentType,
        // 头像/背景图/默认头像均为公开展示图片，必须显式设为 public-read，
        // 否则对象默认私有，公开 URL 会被 403/404，前台加载不出图片。
        ACL: 'public-read',
        CacheControl: 'public, max-age=31536000, immutable',
      },
      (err) => {
        if (err) {
          reject(err)
          return
        }

        resolve(getCosUrl(key))
      },
    )
  })
}

export async function deleteFromCos(key: string) {
  const { cos, config } = getCosClient()

  return new Promise<void>((resolve, reject) => {
    cos.deleteObject(
      {
        Bucket: config.bucket,
        Region: config.region,
        Key: key,
      },
      (err) => {
        if (err) {
          reject(err)
          return
        }

        resolve()
      },
    )
  })
}

export function getCosUrl(key: string) {
  const { config } = getCosClient()
  return `https://${config.bucket}.cos.${config.region}.myqcloud.com/${key}`
}
