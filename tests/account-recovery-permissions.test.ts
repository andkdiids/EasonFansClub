import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

function source(relativePath: string) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), 'utf8')
}

test('普通用户账号安全接口固定拒绝修改恢复开关', () => {
  const route = source('app/api/account/security/route.ts')
  assert.match(route, /账号恢复方式由系统统一管理，请联系管理员调整/)
  assert.match(route, /status:\s*403/)
  assert.doesNotMatch(route, /data:\s*\{\s*securityQuestionRecoveryEnabled/)
})

test('管理员用户级接口要求 account_security_manage 权限', () => {
  const route = source('app/api/admin/users/[userId]/security-recovery/route.ts')
  assert.match(route, /requireAdmin\('account_security_manage'\)/)
})

test('管理员启用前校验三题完整并保护超级管理员和系统账号', () => {
  const route = source('app/api/admin/users/[userId]/security-recovery/route.ts')
  assert.match(route, /target\._count\.securityQuestions !== 3/)
  assert.match(route, /target\.uid <= 0 \|\| target\.role === 'SUPER_ADMIN'/)
  assert.match(route, /该用户尚未完整设置密保问题，无法启用密保找回/)
})

test('管理员状态变更同时写入安全日志和 AdminAction', () => {
  const route = source('app/api/admin/users/[userId]/security-recovery/route.ts')
  assert.match(route, /tx\.accountSecurityLog\.create/)
  assert.match(route, /tx\.adminAction\.create/)
  assert.match(route, /previousEnabled/)
  assert.match(route, /nextEnabled/)
  assert.match(route, /requestIp/)
})

test('忘记密码查询同时校验全局、用户和题目完整性', () => {
  const questionsRoute = source('app/api/auth/forgot-password/security/questions/route.ts')
  const verifyRoute = source('app/api/auth/forgot-password/security/verify/route.ts')
  assert.match(questionsRoute, /getSecurityQuestionRecoveryAvailability/)
  assert.match(verifyRoute, /getSecurityQuestionRecoveryAvailability/)
  assert.match(verifyRoute, /getAccountSecuritySettings/)
})

test('密保问题查询接口不选择或返回答案哈希', () => {
  const route = source('app/api/auth/forgot-password/security/questions/route.ts')
  assert.doesNotMatch(route, /answerHash/)
  assert.match(route, /select:\s*\{\s*question:\s*true,\s*sortOrder:\s*true\s*\}/)
})

test('用户安全页面是只读状态且不含恢复开关按钮', () => {
  const page = source('app/settings/security/page.tsx')
  assert.doesNotMatch(page, /SecuritySettingsClient/)
  assert.doesNotMatch(page, /关闭密保问题找回|启用密保找回|停用密保找回/)
  assert.match(page, /账号恢复方式由系统统一管理/)
  assert.match(page, /如需调整密保找回方式，请联系管理员/)
})

test('无账号安全权限时后台用户页不会渲染操作按钮', () => {
  const page = source('app/admin/users/page.tsx')
  const manager = source('components/AdminUsersManager.tsx')
  assert.match(page, /hasAdminPermission\(user, 'account_security_manage'\)/)
  assert.match(manager, /canManageAccountSecurity && user\.role !== 'SUPER_ADMIN'/)
})

test('注册请求包含幂等键、卸载取消和登录页账号回填', () => {
  const register = source('app/register/RegisterForm.tsx')
  const registerRoute = source('app/api/auth/register/route.ts')
  const login = source('app/login/LoginForm.tsx')
  assert.match(register, /Idempotency-Key/)
  assert.match(register, /requestControllerRef\.current\?\.abort/)
  assert.match(register, /注册成功，请登录您的账号/)
  assert.match(register, /setTimeout\(\(\) => window\.location\.assign\(nextLoginUrl\), 1000\)/)
  assert.match(registerRoute, /registrationIdempotencyKeyHash/)
  assert.match(login, /defaultValue=\{normalizedInitialAccount\}/)
})
