export type MusicUploadStage = 'idle' | 'selected' | 'processing' | 'uploading' | 'converting' | 'complete' | 'error'

type UploadErrorBody = {
  success?: boolean
  code?: string
  error?: string
  message?: string
}

export const MUSIC_UPLOAD_TIMEOUT_MS = 190_000

export async function readMusicUploadResponse(response: Response) {
  const text = await response.text()
  if (!text) throw new Error(`服务器返回空响应（HTTP ${response.status}）`)
  try {
    return JSON.parse(text) as UploadErrorBody & Record<string, unknown>
  } catch {
    throw new Error(`服务器返回格式异常（HTTP ${response.status}）`)
  }
}

export function musicUploadError(response: Response, data: UploadErrorBody) {
  const serverError = typeof data.error === 'string'
    ? data.error
    : typeof data.message === 'string' ? data.message : ''
  if (serverError) return serverError
  if (response.status === 400) return '上传内容无效，请重新选择文件'
  if (response.status === 401) return '登录状态已失效，请重新登录'
  if (response.status === 403) return '当前账号没有音乐管理权限'
  if (response.status === 413) return '文件超过服务器上传限制'
  if (response.status >= 500) return `服务器处理失败（HTTP ${response.status}）`
  return `上传失败（HTTP ${response.status}）`
}

export function musicUploadNetworkError(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return '上传处理超时，请检查网络或服务器转码状态后重试'
  }
  if (error instanceof TypeError) {
    return '网络请求失败，请检查网络、Nginx 上传限制或服务器进程状态'
  }
  return error instanceof Error ? error.message : '上传失败，请稍后重试'
}
