const SAFE_SYNC_ERRORS: Record<string, string> = {
  MEDIA_REQUEST_FAILED: '媒体获取失败',
  MEDIA_CONTENT_TYPE_INVALID: '媒体格式异常',
  MEDIA_TOO_LARGE: '媒体超过大小限制',
  PROVIDER_AUTH_ERROR: '来源服务鉴权失败',
  PROVIDER_RATE_LIMITED: '来源服务暂时限流',
  RATE_LIMITED: '来源服务暂时限流',
  PROVIDER_CONTRACT_FAILED: '来源数据格式异常',
  COS_ERROR: '媒体归档失败',
  DB_ERROR: '数据库同步失败',
  SYNC_TIMEOUT: '同步超时',
  SYNC_DISABLED: '同步已关闭',
  BASELINE_REQUIRED: '等待首次基线同步',
  CONFIG_ERROR: '同步配置异常',
  INVALID_DATA: '来源数据校验失败',
}

export function safeSyncErrorCode(value: string | null | undefined) {
  return value && Object.hasOwn(SAFE_SYNC_ERRORS, value) ? value : value ? 'SYNC_FAILED' : null
}

export function safeSyncErrorMessage(value: string | null | undefined) {
  const code = safeSyncErrorCode(value)
  if (!code) return null
  return SAFE_SYNC_ERRORS[code] || '同步失败'
}
