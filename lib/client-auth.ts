/**
 * 客户端 Session 权威确认工具。
 *
 * 普通业务接口偶发 401（业务鉴权、代理异常、网络波动或旧请求）不能直接
 * 触发全局登出。只有 GET /api/auth/me 明确确认当前 Session 已失效，才允许
 * 跳转登录页。权威检查本身失败、fetch 网络错误、超时或返回 5xx 时，必须保持登录、
 * 保留当前页面和表单状态。
 */

export type SessionAuthorityState = 'valid' | 'invalid' | 'unknown'

type SessionAuthorityBody = {
  user?: { id?: unknown } | null
  code?: unknown
}

type SessionAuthorityResult = {
  state: SessionAuthorityState
  status: number | null
  code?: string
}

/** Pure classification so the 401/5xx contract can be regression-tested. */
export function classifySessionAuthority(status: number, body: unknown): SessionAuthorityState {
  if (status === 401) return 'invalid'
  if (status === 500 || status === 503 || status >= 502) return 'unknown'
  if (status < 200 || status >= 300 || !body || typeof body !== 'object') return 'unknown'

  const candidate = body as SessionAuthorityBody
  if (candidate.user === null) return 'invalid'
  if (candidate.user && typeof candidate.user.id === 'string' && candidate.user.id.trim()) return 'valid'
  return 'unknown'
}

function responseCode(body: unknown) {
  if (!body || typeof body !== 'object') return undefined
  const code = (body as SessionAuthorityBody).code
  return typeof code === 'string' ? code.slice(0, 80) : undefined
}

async function fetchSessionAuthority(): Promise<SessionAuthorityResult> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)
  try {
    const response = await fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    const body = await response.json().catch(() => null) as SessionAuthorityBody | null
    // 服务异常：不得登出。保留这条显式分支，避免未来把 5xx 改成 invalid。
    if (response.status === 503 || response.status === 500 || response.status >= 502) {
      return { state: 'unknown', status: response.status, code: responseCode(body) }
    }
    return { state: classifySessionAuthority(response.status, body), status: response.status, code: responseCode(body) }
  } catch {
    // 网络错误、AbortError/timeout 都属于“无法确认”，不是 Session 失效。
    return { state: 'unknown', status: null }
  } finally {
    clearTimeout(timeoutId)
  }
}

// 多个组件可能同时收到 401；共用一次权威查询，避免竞态下重复判断/重复跳转。
let authorityCheckInFlight: Promise<SessionAuthorityResult> | null = null
let forceLogoutStarted = false

function resolveSessionAuthority() {
  if (!authorityCheckInFlight) {
    authorityCheckInFlight = fetchSessionAuthority().finally(() => {
      authorityCheckInFlight = null
    })
  }
  return authorityCheckInFlight
}

/**
 * 二次确认：普通接口收到 401 后调用。仅返回“权威确认无效”这一种可登出结果；
 * 服务异常、网络波动、超时和 Session 仍有效全部返回 false。
 */
export async function isSessionDefinitivelyInvalid(): Promise<boolean> {
  const result = await resolveSessionAuthority()
  return result.state === 'invalid'
}

/**
 * 统一处理普通接口的 401。返回 true 表示已经确认失效并开始跳转，false 表示
 * 调用方必须留在当前页面并按普通请求失败处理。
 */
export async function redirectToLoginAfterConfirmedSessionInvalid(response: Response, source: string) {
  if (response.status !== 401) return false

  const result = await resolveSessionAuthority()
  if (result.state !== 'invalid') return false
  if (forceLogoutStarted) return true

  forceLogoutStarted = true
  recordForceLogout('SESSION_INVALID', source, response.status, result.code)
  if (typeof window !== 'undefined') {
    const nextPath = `${window.location.pathname}${window.location.search}` || '/'
    window.location.replace(`/login?next=${encodeURIComponent(nextPath)}`)
  }
  return true
}

/**
 * 真正执行全局登出前的诊断记录（AUTH_FORCE_LOGOUT）。
 * 之后必须明确是「哪个接口、什么原因」把用户踢下线。
 */
export function recordForceLogout(reason: string, source: string, httpStatus?: number, errorCode?: string) {
  const pathname = typeof window !== 'undefined' ? window.location.pathname + window.location.search : ''
  console.error('[auth] redirect to login', {
    event: 'AUTH_REDIRECT_LOGIN',
    source,
    pathname,
    reason,
    status: httpStatus,
  })
  console.warn('[AUTH_FORCE_LOGOUT]', JSON.stringify({
    event: 'AUTH_REDIRECT_LOGIN',
    reason,
    source,
    httpStatus,
    errorCode,
    pathname,
    at: new Date().toISOString(),
  }))
}
