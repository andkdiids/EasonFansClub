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
export function readCosEnv(...names: string[]) {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return ''
}

// 返回缺失的配置项名称列表；为空表示配置完整
export function missingCosConfig() {
  const missing: string[] = []
  if (!readCosEnv('TENCENT_COS_SECRET_ID', 'COS_SECRET_ID')) missing.push('TENCENT_COS_SECRET_ID')
  if (!readCosEnv('TENCENT_COS_SECRET_KEY', 'COS_SECRET_KEY')) missing.push('TENCENT_COS_SECRET_KEY')
  if (!readCosEnv('TENCENT_COS_BUCKET', 'COS_BUCKET')) missing.push('TENCENT_COS_BUCKET')
  if (!readCosEnv('TENCENT_COS_REGION', 'COS_REGION')) missing.push('TENCENT_COS_REGION')
  return missing
}

function getCosClient() {
  if (cachedClient && cachedConfig) return { cos: cachedClient, config: cachedConfig }

  const missing = missingCosConfig()
  if (missing.length) {
    throw new Error(`腾讯云 COS 配置缺失：${missing.join('、')}`)
  }

  const config: CosConfig = {
    secretId: readCosEnv('TENCENT_COS_SECRET_ID', 'COS_SECRET_ID'),
    secretKey: readCosEnv('TENCENT_COS_SECRET_KEY', 'COS_SECRET_KEY'),
    bucket: readCosEnv('TENCENT_COS_BUCKET', 'COS_BUCKET'),
    region: readCosEnv('TENCENT_COS_REGION', 'COS_REGION'),
  }

  cachedConfig = config
  cachedClient = new COS({
    SecretId: config.secretId,
    SecretKey: config.secretKey,
  })
  return { cos: cachedClient, config }
}

// 提取 COS SDK 错误中的可读信息，避免静默失败
function isCosAclPermissionError(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const details = error as { statusCode?: number | string }
  return Number(details.statusCode) === 403
}

export async function putCosObjectWithAclFallback(
  cos: COS,
  params: Parameters<COS['putObject']>[0],
) {
  try {
    await cos.putObject(params)
  } catch (error) {
    if (params.ACL !== 'public-read' || !isCosAclPermissionError(error)) throw error

    const paramsWithoutAcl = { ...params }
    delete paramsWithoutAcl.ACL
    console.warn('[cos.upload] public-read ACL denied; retrying with bucket permissions', {
      bucket: params.Bucket,
      region: params.Region,
      key: params.Key,
      statusCode: 403,
    })
    await cos.putObject(paramsWithoutAcl)
  }
}

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

  await putCosObjectWithAclFallback(cos, {
    Bucket: config.bucket,
    Region: config.region,
    Key: key,
    Body: Buffer.from(body),
    ContentType: contentType,
    // The ACL is retained when the credential has object-ACL permission.
    // If it does not, putCosObjectWithAclFallback retries using bucket policy.
    ACL: 'public-read',
    CacheControl: 'public, max-age=31536000, immutable',
  })
  return getCosUrl(key)
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
