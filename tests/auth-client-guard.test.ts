import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = join(process.cwd())

function source(relativePath: string) {
  return readFileSync(join(root, relativePath), 'utf8')
}

test('同源 API 401 只在权威会话确认失效后跳转', () => {
  const clientAuth = source('lib/client-auth.ts')
  const restore = source('components/AuthSessionRestore.tsx')

  assert.match(clientAuth, /installAuthenticatedFetchGuard/)
  assert.match(clientAuth, /fetchSessionAuthority/)
  assert.match(clientAuth, /authorityCheckInFlight/)
  assert.match(clientAuth, /AUTH_SESSION_UNCERTAIN/)
  assert.match(clientAuth, /\['GET', 'HEAD', 'OPTIONS'\]/)
  assert.match(clientAuth, /startConfirmedLoginRedirect/)
  assert.match(restore, /installAuthenticatedFetchGuard\(\)/)
  assert.match(restore, /Object\.prototype\.hasOwnProperty\.call\(body, 'user'\)/)
})

test('会话异常不会伪装成登录失效或清除 Cookie', () => {
  const security = source('lib/security.ts')
  const middleware = source('middleware.ts')

  assert.match(security, /AUTH_SERVICE_UNAVAILABLE/)
  assert.match(security, /status: 503/)
  assert.match(middleware, /Never clear the old cookie here/)
  assert.doesNotMatch(middleware, /sessionTokenFingerprint[\s\S]*token\.slice/)
})

test('好友搜索使用统一鉴权、保留限流，并避免无效高频请求', () => {
  const route = source('app/api/friends/list/route.ts')
  const dock = source('components/FriendDock.tsx')

  assert.match(route, /const guard = await requireUser\(\)/)
  assert.match(route, /limit: 120, windowSeconds: 60/)
  assert.match(dock, /setDebouncedQuery\(query\.trim\(\)\), 600\)/)
  assert.match(dock, /debouncedQuery\.length < 2/)
  assert.match(dock, /credentials: 'same-origin'/)
})

test('操作型客户端不再自行把陈旧 props 直接变成登录跳转', () => {
  const actionSources = [
    'components/ForumDiscoveryActionBar.tsx',
    'components/ratings/RatingReviews.tsx',
    'components/music/EasMusicLikeButton.tsx',
    'components/clinic/ClinicHomeClient.tsx',
    'components/clinic/ClinicDetailClient.tsx',
    'components/clinic/ClinicComposer.tsx',
  ]

  for (const relativePath of actionSources) {
    const content = source(relativePath)
    assert.doesNotMatch(content, /window\.location\.(assign|replace).*\/login/, relativePath)
    assert.doesNotMatch(content, /router\.push\([^\n]*\/login/, relativePath)
  }

  for (const relativePath of ['components/PostActions.tsx', 'components/DailyMessageActions.tsx', 'components/music/EasMusicLikeButton.tsx']) {
    const content = source(relativePath)
    assert.match(content, /response\.status === 401 \? '登录状态暂时无法确认，请稍后重试'/, relativePath)
  }
})
