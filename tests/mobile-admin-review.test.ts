import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')
const middleware = read('middleware.ts')
const security = read('lib/security.ts')
const center = read('app/api/admin/review/route.ts')
const post = read('app/api/admin/posts/review/route.ts')

test('only GET and PATCH unified review paths pass Mobile Bearer middleware', () => {
  assert.match(middleware, /request\.method === 'GET'[\s\S]*pathname === '\/api\/admin\/review'/)
  assert.match(middleware, /request\.method === 'PATCH' && pathname === '\/api\/admin\/review'/)
  assert.match(middleware, /if \(!\/\^Bearer\\s\+\/i\.test\(request\.headers\.get\('authorization'\)/)
})

test('anonymous and invalid Bearer cannot fall back to a browser cookie or read reviews', () => {
  assert.match(security, /if \(request\.headers\.has\('authorization'\)\)/)
  assert.match(security, /if \(!token\) return \{ user: null, response: unauthenticatedResponse\(\) \}/)
  assert.match(center, /export async function GET\(request: Request\) \{\s*const guard = await requireRequestAdmin\(request\)/)
  assert.match(center, /export async function PATCH\(request: Request\) \{\s*const guard = await requireRequestAdmin\(request\)/)
})

test('normal users and partial admins need post_manage, including delegated POST decision', () => {
  assert.match(security, /export async function requireRequestAdmin\(request: Request, permissionKey\?/)
  assert.match(security, /if \(!isAdminRole\(result\.user\.role\)\) return \{ user: null, response: forbiddenResponse/)
  assert.match(security, /hasAdminPermission\(result\.user, permissionKey\)/)
  assert.match(center, /accessibleDefinitions\(guard\.user\)/)
  assert.match(center, /hasAdminPermission\(guard\.user, definition\.permission\)/)
  assert.match(post, /requireRequestAdmin\(request, 'post_manage'\)/)
  assert.match(center, /\['authorization', 'cookie'/)
})

test('native review payload keeps pagination, pending count, full post body and author image', () => {
  assert.match(center, /const PAGE_SIZE = 40/)
  assert.match(center, /hasMore: start \+ PAGE_SIZE < total/)
  assert.match(center, /targetItem,/)
  assert.match(center, /avatarUrl: row\.User\.Profile\?\.avatarUrl/)
  assert.match(center, /body: postContentPlainText\(row\.content, row\.richContent\)/)
  assert.match(center, /status = parseReviewStatus\(statusParam\)/)
})

test('approve and reject retain the canonical moderation logic and mandatory reason', () => {
  assert.match(center, /REJECTION_REASON_REQUIRED/)
  assert.match(center, /sourceType === 'POST'\) return delegate\(request/)
  assert.match(post, /updateMany/)
  assert.match(post, /writeReviewHistory/)
  assert.match(post, /writeReviewNotification/)
  assert.match(post, /POST_NOT_FOUND/)
  assert.match(post, /ALREADY_REVIEWED/)
})
