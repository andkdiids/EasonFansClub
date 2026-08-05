import { NextResponse } from 'next/server'
import { authCookieName, getSessionCookieDeletionOptions } from '@/lib/auth-cookie'

const noStoreHeaders = {
  'Cache-Control': 'no-store, max-age=0',
}

// 退出时要清理的除了当前 Domain=.ecfc.fans 的正常会话 Cookie，还要清理两类历史残留的同名 Cookie，
// 否则并存的老 Cookie 会让用户「退出后依然处于登录态」：
//  - host-only 变体（早期未带 Domain 写入的版本，Domain 留空）
//  - www.ecfc.fans 变体（曾用 www 子域写入的版本）
// 注意：Next 的 response.cookies.set 同名多次调用会相互覆盖，必须用 response.headers.append 才能
// 在同一次响应里下发多条 Set-Cookie，由浏览器按 name + domain + path 分别匹配清除。
type ClearCookieOptions = {
  domain?: string
  path?: string
  expires?: Date
  maxAge?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'lax' | 'strict' | 'none'
}

// 内联序列化（避免引入 Next 的间接依赖 cookie 包），格式与 cookie.serialize 对齐：
// SameSite 首字母大写（none→None / lax→Lax / strict→Strict）。
function serializeClearCookie(name: string, options: ClearCookieOptions): string {
  let str = `${name}=`
  if (options.domain) str += `; Domain=${options.domain}`
  if (options.path) str += `; Path=${options.path}`
  if (options.expires) str += `; Expires=${options.expires.toUTCString()}`
  if (typeof options.maxAge === 'number') str += `; Max-Age=${options.maxAge}`
  if (options.httpOnly) str += '; HttpOnly'
  if (options.secure) str += '; Secure'
  if (options.sameSite) {
    const lowered = options.sameSite.toLowerCase()
    const normalized = lowered === 'none' ? 'None' : lowered === 'lax' ? 'Lax' : 'Strict'
    str += `; SameSite=${normalized}`
  }
  return str
}

function buildLegacyDeletionOptions(request: Request, domain?: string): ClearCookieOptions {
  const options = { ...getSessionCookieDeletionOptions(request) } as Record<string, unknown>
  if (domain === undefined) {
    delete options.domain
  } else {
    options.domain = domain
  }
  return options as ClearCookieOptions
}

function appendClearCookie(response: NextResponse, options: ClearCookieOptions) {
  response.headers.append('Set-Cookie', serializeClearCookie(authCookieName, options))
}

export async function POST(request: Request) {
  const accept = request.headers.get('accept') || ''
  const response = accept.includes('text/html')
    ? NextResponse.redirect(new URL('/login', request.url), { status: 303, headers: noStoreHeaders })
    : NextResponse.json({ ok: true }, { headers: noStoreHeaders })

  // 1) 正常 Cookie（Domain=.ecfc.fans）
  appendClearCookie(response, getSessionCookieDeletionOptions(request))
  // 2) 历史 host-only Cookie（不带 Domain）
  appendClearCookie(response, buildLegacyDeletionOptions(request))
  // 3) 历史 www.ecfc.fans Cookie
  appendClearCookie(response, buildLegacyDeletionOptions(request, 'www.ecfc.fans'))

  return response
}
