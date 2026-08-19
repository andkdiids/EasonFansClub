/**
 * 客户端 Session 权威确认工具。
 *
 * 背景：普通业务接口偶发 401（JWT 校验失败 / 服务异常 / 网络波动）不能直接
 * 触发全局登出。只有「权威 Session 校验接口」明确确认 Session 已失效，才允许
 * 清除登录状态并跳转登录页。
 *
 * 权威接口：GET /api/auth/me
 *  - 200 { user: {...} }          → 已登录（保持）
 *  - 200 { user: null }           → JWT 有效但用户被删/禁用/不完整 → 确认失效
 *  - 401 (UNAUTHORIZED)           → middleware 判定 JWT 失效 → 确认失效
 *  - 503 (AUTH_SERVICE_UNAVAILABLE) / 500 → 服务异常 → 保持登录
 *  - fetch 网络错误 / timeout     → 保持登录
 */

async function fetchSessionAuthority() {
  try {
    const response = await fetch('/api/auth/me', {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    return response
  } catch {
    return null
  }
}

/**
 * 二次确认：普通接口收到 401 后调用。返回 true 表示权威接口确认 Session 已失效，
 * 应执行登出；返回 false 表示仍应保持登录（服务异常 / 网络波动 / Session 仍有效）。
 */
export async function isSessionDefinitivelyInvalid(): Promise<boolean> {
  const response = await fetchSessionAuthority()
  if (!response) return false
  // 服务异常：不得登出
  if (response.status === 503 || response.status === 500 || response.status >= 502) return false
  // middleware 判定 JWT 失效 → 确认失效
  if (response.status === 401) return true
  // 权威接口成功但用户为 null（用户被删/禁用/不完整）→ 确认失效
  if (response.ok) {
    const body = await response.json().catch(() => null) as { user?: { id?: unknown } | null } | null
    if (body && typeof body.user?.id === 'string') return false
    if (body && body.user === null) return true
  }
  return false
}

/**
 * 真正执行全局登出前的诊断记录（AUTH_FORCE_LOGOUT）。
 * 之后必须明确是「哪个接口、什么原因」把用户踢下线。
 */
export function recordForceLogout(reason: string, source: string, httpStatus?: number, errorCode?: string) {
  console.warn('[AUTH_FORCE_LOGOUT]', JSON.stringify({
    reason,
    source,
    httpStatus,
    errorCode,
    pathname: typeof window !== 'undefined' ? window.location.pathname + window.location.search : '',
    at: new Date().toISOString(),
  }))
}
