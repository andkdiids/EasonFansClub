import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const source = (path: string) => readFileSync(join(process.cwd(), path), 'utf8')

test('growth overview and actions accept request-scoped Cookie or Mobile Bearer auth', () => {
  const routes = [
    ['app/api/growth/route.ts', /export async function GET\(request: Request\)[\s\S]*?requireRequestUser\(request\)/],
    ['app/api/growth/claim/route.ts', /export async function POST\(request: Request\)[\s\S]*?requireRequestUser\(request\)/],
    ['app/api/growth/refresh/route.ts', /export async function POST\(request: Request\)[\s\S]*?requireRequestUser\(request\)/],
  ] as const

  for (const [path, contract] of routes) {
    const route = source(path)
    assert.match(route, contract, path)
    assert.doesNotMatch(route, /requireUser\(\)/, path)
  }
})

test('Growth remains authenticated; the shared request resolver retains Cookie fallback and Bearer-only failure semantics', () => {
  const security = source('lib/security.ts')
  assert.match(security, /export async function requireRequestUser\(request: Request\)/)
  assert.match(security, /if \(request\.headers\.has\('authorization'\)\)/)
  assert.match(security, /const user = await getCurrentUser\(\)/)
  assert.match(security, /if \(!token\) return \{ user: null, response: unauthenticatedResponse\(\) \}/)
})

test('Mobile conversation list, creation, messages and read cursor use the protected Cookie/Bearer resolver', () => {
  const routes = [
    ['app/api/direct-conversations/route.ts', /export async function GET\(request: Request\)[\s\S]*?requireRequestUser\(request\)[\s\S]*export async function POST\(request: Request\)[\s\S]*?requireRequestUser\(request\)/],
    ['app/api/direct-conversations/[conversationId]/messages/route.ts', /export async function GET\(request: Request[\s\S]*?requireRequestUser\(request\)[\s\S]*export async function POST\(request: Request[\s\S]*?requireRequestUser\(request\)/],
    ['app/api/direct-conversations/[conversationId]/read/route.ts', /export async function POST\(request: Request[\s\S]*?requireRequestUser\(request\)/],
  ] as const

  for (const [path, contract] of routes) {
    const route = source(path)
    assert.match(route, contract, path)
    assert.doesNotMatch(route, /getCurrentUser\(\)|unauthenticatedResponse\(/, path)
  }
})

test('Middleware allowlist covers only Mobile Growth and supported conversation endpoints', () => {
  const middleware = source('middleware.ts')
  assert.match(middleware, /pathname === '\/api\/growth'/)
  assert.match(middleware, /pathname === '\/api\/growth\/claim'/)
  assert.match(middleware, /pathname === '\/api\/growth\/refresh'/)
  assert.match(middleware, /pathname === '\/api\/direct-conversations'/)
  assert.ok(middleware.includes('messages$/.test(pathname)'))
  assert.ok(middleware.includes('(?:messages|read)$/.test(pathname)'))
  assert.equal(middleware.includes("pathname === '/api/direct-conversations/clear'"), false)
})

test('Conversation creation and message sending keep Server-side mutual-follow and participant checks', () => {
  const conversations = source('app/api/direct-conversations/route.ts')
  const messages = source('app/api/direct-conversations/[conversationId]/messages/route.ts')
  assert.match(conversations, /const friendship = await prisma\.friendship\.findUnique/)
  assert.match(conversations, /if \(!friendship\) return NextResponse\.json\(\{ code: 'MUTUAL_FOLLOW_REQUIRED', message: '只能给好友发送私信' \}, \{ status: 403/)
  assert.match(messages, /ConversationParticipant: \{ some: \{ userId, isDeleted: false \} \}/)
  assert.match(messages, /if \(!friendship\) return messageFailure\(403, 'NOT_FRIEND'/)
})
