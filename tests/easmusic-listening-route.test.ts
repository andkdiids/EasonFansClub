import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

function routeHarness(userId: string | null) {
  const writes: { userId: string; events: unknown }[] = []
  const routeModule = { exports: {} as { POST(request: Request): Promise<Response> } }
  const compiled = ts.transpileModule(readFileSync('app/api/music/listening/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(compiled, {
    module: routeModule, exports: routeModule.exports, console,
    require: (id: string) => {
      if (id === 'next/server') return { NextResponse: { json: (body: unknown, options?: ResponseInit) => Response.json(body, options) } }
      if (id === '@/lib/security') return {
        requireRequestUser: async () => userId ? { user: { id: userId } } : { response: Response.json({ code: 'UNAUTHENTICATED' }, { status: 401 }) },
        enforceApiRateLimit: async () => null,
      }
      if (id === '@/lib/music-listening') return {
        normalizeMusicListeningEvents: (events: unknown) => events,
        recordMusicListeningEvents: async (owner: string, events: unknown) => { writes.push({ userId: owner, events }); return { acknowledgedEventIds: ['one'] } },
      }
      throw new Error(`Unexpected route dependency: ${id}`)
    },
  })
  return { post: routeModule.exports.POST, writes }
}

function request(expectedOwner?: string) {
  return new Request('https://ecfc.fans/api/music/listening', {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(expectedOwner ? { 'X-ECFC-Listening-Owner': expectedOwner } : {}) },
    body: JSON.stringify({ events: [{ eventId: 'one' }] }),
  })
}

test('listening route never uses the expected owner header as authentication', async () => {
  const route = routeHarness(null)
  assert.equal((await route.post(request('owner-a'))).status, 401)
  assert.equal(route.writes.length, 0)
})

test('listening route refuses missing and stale account context before any write', async () => {
  const route = routeHarness('owner-b')
  assert.equal((await route.post(request())).status, 400)
  const stale = await route.post(request('owner-a'))
  assert.equal(stale.status, 409)
  assert.equal((await stale.json()).code, 'LISTENING_OWNER_MISMATCH')
  assert.equal(route.writes.length, 0)
})

test('matching account context writes only under the authenticated identity', async () => {
  const route = routeHarness('owner-a')
  assert.equal((await route.post(request('owner-a'))).status, 200)
  assert.equal(route.writes.length, 1)
  assert.equal(route.writes[0].userId, 'owner-a')
})
