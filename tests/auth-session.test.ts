import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

// 全站登录失效审计回归测试（需求 17：Case 1~10）。
// 源码结构校验 + 纯函数，不连真实数据库。

const root = join(process.cwd())

function source(relativePath: string) {
  return readFileSync(join(root, relativePath), 'utf8')
}

const auth = source('lib/auth.ts')
const middleware = source('middleware.ts')
const security = source('lib/security.ts')
const clientAuth = source('lib/client-auth.ts')
const meRoute = source('app/api/auth/me/route.ts')
const authSessionRestore = source('components/AuthSessionRestore.tsx')
const ratingsMePage = source('app/ratings/me/page.tsx')
const birthdayCardPage = source('app/birthday-card/page.tsx')
const loginRoute = source('app/api/auth/login/route.ts')
const schema = source('prisma/schema.prisma')

test('Case 1/有效 Session + 正常数据库 → authenticated', () => {
  // getCurrentUser 返回完整用户对象（含 uid/role/Profile 校验后）
  assert.match(auth, /export async function getCurrentUser\(\)/)
  assert.match(auth, /isCompleteActiveUser\(user\)/)
  // DB 查询失败走 AuthServiceUnavailableError（throw），不返回 null
  assert.match(auth, /throw new AuthServiceUnavailableError/)
  assert.match(auth, /isAuthServiceUnavailableError\(/)
})

test('Case 2/Session 已过期 → 401（明确区分 SESSION_EXPIRED）', () => {
  assert.match(middleware, /joseErrors\.JWTExpired \? 'SESSION_EXPIRED' : 'INVALID_SIGNATURE'/)
  assert.match(middleware, /SESSION_EXPIRED/)
})

test('Case 3/Session 不存在 → 401（NO_COOKIE，仅 API 记录诊断）', () => {
  assert.match(middleware, /reason: 'NO_COOKIE'/)
  assert.match(middleware, /isApiPath\(request\.nextUrl\.pathname\)/)
  // 无 cookie → unauthorizedApiResponse 401（API）/ loginRedirect 302（页面）
  assert.match(middleware, /if \(!session\) return isApiPath\(pathname\) \? unauthorizedApiResponse\(\) : loginRedirect\(request\)/)
})

test('Case 4/数据库异常 → 500/503，绝不 401', () => {
  // requireUser：DB 异常 → 503「登录服务暂时不可用」；用户 null 才 401
  assert.match(security, /登录服务暂时不可用，请稍后再试/)
  assert.match(security, /code: 'UNAUTHORIZED', message: '请先登录'/)
  // /api/auth/me：503/500 明确 code，不伪装成 user:null 的 200
  assert.match(meRoute, /status: 503/)
  assert.match(meRoute, /AUTH_SERVICE_UNAVAILABLE/)
  assert.match(meRoute, /status: 500/)
  // 页面守卫不再把 DB 异常 catch 成 null → 跳登录
  assert.doesNotMatch(ratingsMePage, /getCurrentUser\(\)\.catch\(\(\) => null\)/)
  assert.doesNotMatch(birthdayCardPage, /\.catch\(\(\) => null\)\s*\n\s*if \(!fresh\) redirect/)
  assert.match(ratingsMePage, /const user = await getCurrentUser\(\)\s*\n  if \(!user\) redirect/)
})

test('Case 5/普通 API 返回 500/503 → 前端保持登录（不 logout）', () => {
  assert.match(clientAuth, /response\.status === 503 \|\| response\.status === 500 \|\| response\.status >= 502\) return false/)
  assert.match(clientAuth, /fetch 网络错误/)
  assert.match(clientAuth, /保持登录/)
  // AuthSessionRestore：!response.ok 忽略（不 refresh、不登出）
  assert.match(authSessionRestore, /if \(cancelled \|\| !response\.ok\) return/)
})

test('Case 6/普通 API 返回 401 但权威 Session 仍有效 → 不 logout（二次确认）', () => {
  // 401 组件改为先向权威接口二次确认
  assert.match(clientAuth, /export async function isSessionDefinitivelyInvalid\(\)/)
  assert.match(clientAuth, /typeof body\.user\?\.id === 'string'\) return false/)
  assert.match(clientAuth, /body\.user === null\) return true/)
  const checkin = source('components/CheckInHistoryDialog.tsx')
  assert.match(checkin, /isSessionDefinitivelyInvalid\(\)/)
  assert.match(checkin, /if \(!invalid\) \{/)
  assert.match(checkin, /请求失败，请稍后重试。/)
})

test('Case 7/权威 Session 确认失效 → 明确 logout（AUTH_FORCE_LOGOUT 诊断）', () => {
  assert.match(clientAuth, /recordForceLogout\(/)
  assert.match(clientAuth, /AUTH_FORCE_LOGOUT/)
  assert.match(clientAuth, /reason,\s*\n\s*source,/)
  assert.match(clientAuth, /pathname/)
  // 组件确认失效后才跳登录
  const checkin = source('components/CheckInHistoryDialog.tsx')
  assert.match(checkin, /recordForceLogout\('SESSION_INVALID'/)
  assert.match(checkin, /window\.location\.href = '\/login'/)
})

test('Case 8/Node 进程重启 → 登录态仍可恢复（JWT 无状态，无内存权威 Session）', () => {
  // 登录只签发 JWT cookie，不写内存/数据库 Session；无 sessionCache 权威
  assert.match(loginRoute, /createSessionToken\(/)
  assert.doesNotMatch(loginRoute, /session\.create|Session\.create|onlineSession\.create/)
  // 无全局内存 session 容器
  assert.doesNotMatch(auth, /globalThis\.sessionCache|global\.sessionCache/)
  // 唯一内存缓存 currentUserCache 只辅助用户查询，缓存丢失只触发重查，不会登出
  assert.match(auth, /currentUserCache/)
})

test('Case 9/两个 Tab，其中一个普通请求失败 → 不退出另一个', () => {
  // 跨 Tab 同步仅发生在「主动 logout」广播（BroadcastChannel eason-private-sync），
  // 且发送方是用户主动点退出，不是接口 401
  const notificationProvider = source('components/NotificationProvider.tsx')
  assert.match(notificationProvider, /\.type === 'logout'/)
  // 普通请求 401 的二次确认是本组件内 fetch 权威接口，不广播
  assert.match(clientAuth, /fetch\('\/api\/auth\/me'/)
})

test('Case 10/多设备登录：一个设备重新登录不撤销其他设备', () => {
  // 登录 API 只发 Set-Cookie，不 deleteMany 任何 Session/LoginDevice
  assert.doesNotMatch(loginRoute, /deleteMany/)
  assert.doesNotMatch(loginRoute, /logout|revoke/i)
  // 数据库模型无服务端 Session 表用于登录（OnlineSession 仅 WebSocket 记录）
  assert.match(schema, /model OnlineSession/)
})
