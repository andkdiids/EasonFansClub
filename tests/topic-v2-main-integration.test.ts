import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { before, test } from 'node:test'
import { NextRequest } from 'next/server'
import { SignJWT } from 'jose'
import { authCookieName } from '../lib/auth-cookie'

process.env.JWT_SECRET = 'topic-v2-main-integration-test-only-secret'
let middleware: typeof import('../middleware').middleware
before(async () => { ({ middleware } = await import('../middleware')) })
const source = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n')
const baseSource = (path: string) => execFileSync('git', ['show', `8f3c92cb1229c492ee0ed188bbef7c3d38d640b2:${path}`], { encoding: 'utf8' }).replace(/\r\n/g, '\n')
const request = (path: string, method: string, extra: Record<string, string> = {}, bearer = true) => new NextRequest(`https://ecfc.fans${path}`, {
  method, headers: { ...(bearer ? { authorization: 'Bearer synthetic-test-token' } : {}), ...extra },
})

test('main integration retains Home/Growth, V2 and Cantonese Bearer route families', async () => {
  for (const [path, method] of [
    ['/api/home', 'GET'], ['/api/growth', 'GET'], ['/api/growth/actions/share', 'POST'],
    ['/api/activities/test/v2/tasks', 'POST'], ['/api/admin/activities/test/v2', 'PATCH'],
    ['/api/admin/activities/test/v2/lottery/draw', 'POST'],
    ['/api/learning/cantonese/course', 'GET'], ['/api/learning/cantonese/progress', 'GET'],
    ['/api/learning/cantonese/progress/lesson-05', 'POST'],
    ['/api/admin/cantonese/review/teaching/test', 'PATCH'],
  ]) {
    assert.equal((await middleware(request(path, method))).status, 200, `${method} ${path}`)
    assert.equal((await middleware(request(path, method, {}, false))).status, 401, `anonymous ${method} ${path}`)
  }
})

test('lottery winner address PUT reaches its owner guard, without opening unrelated PUT routes', async () => {
  const path = '/api/activities/test/v2/lottery/winners/winner-test/address'
  assert.equal((await middleware(request(path, 'PUT'))).status, 200)
  assert.equal((await middleware(request(path, 'PUT', {}, false))).status, 401)
  for (const other of ['/api/activities/test/v2/lottery', '/api/admin/activities/test/v2/lottery/winners/winner-test/address', '/api/admin/permissions']) {
    assert.equal((await middleware(request(other, 'PUT'))).status, 401, other)
  }
  const route = source('app/api/activities/[activityId]/v2/lottery/winners/[winnerId]/address/route.ts')
  assert.match(route, /export async function PUT[\s\S]*?requireRequestUser\(request\)/)
  assert.match(route, /saveTopicLotteryAddress\(\{ activityId, winnerId, userId: guard\.user\.id/)
})

test('global CSRF executes before merged Bearer bypass for V2, Cantonese and main writes', async () => {
  for (const [path, method] of [
    ['/api/growth/actions/share', 'POST'], ['/api/admin/activities/test/v2', 'PATCH'],
    ['/api/activities/test/v2/lottery/winners/winner-test/address', 'PUT'],
    ['/api/learning/cantonese/progress/lesson-05', 'POST'],
  ]) {
    const response = await middleware(request(path, method, { origin: 'https://hostile.invalid' }))
    assert.equal(response.status, 403)
    assert.equal((await response.json()).code, 'CSRF_BLOCKED')
  }
})

test('Web Cookie winner-address edit remains authenticated and cross-site Cookie writes remain blocked', async () => {
  const cookie = await new SignJWT({ id: 'synthetic-owner', role: 'USER' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m')
    .sign(new TextEncoder().encode(process.env.JWT_SECRET))
  const path = '/api/activities/test/v2/lottery/winners/winner-test/address'
  const headers = { cookie: `${authCookieName}=${cookie}`, origin: 'https://ecfc.fans' }
  assert.equal((await middleware(request(path, 'PUT', headers, false))).status, 200)
  const rejected = await middleware(request(path, 'PUT', { ...headers, origin: 'https://hostile.invalid' }, false))
  assert.equal(rejected.status, 403)
  assert.equal((await rejected.json()).code, 'CSRF_BLOCKED')
})

test('deployment retains main release boundary and candidate exact-SHA safety', () => {
  const workflow = source('.github/workflows/deploy.yml')
  assert.match(workflow, /paths-ignore:\s+- '\.github\/\*\*'/)
  assert.match(workflow, /github\.ref == 'refs\/heads\/main'/)
  assert.match(workflow, /!contains\(github\.event\.head_commit\.message, '\[infra-only\]'\)/)
  assert.match(workflow, /cancel-in-progress: false/)
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/)
  assert.match(workflow, /refusing to copy or create production configuration/)
  assert.match(workflow, /JSON\.parse\(raw\)\.release === process\.argv\[1\]/)
  assert.match(workflow, /Guarded rollback after deploy or public-health failure/)
  assert.doesNotMatch(workflow, /curl --insecure|mkdir -p.*releases|cp -p.*shared\/\.env/)
})

test('main production diagnostic workflows and scripts remain unchanged', () => {
  const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', 'f8b70b994684856d2044ceab962b485c068d7543', '.github'], { encoding: 'utf8' })
    .trim().split('\n').filter(path => path !== '.github/workflows/deploy.yml')
  assert.equal(paths.length, 16, 'all main diagnostic/release-policy files except the separately audited deployment workflow')
  for (const path of paths) assert.equal(source(path), baseSource(path), path)
})

test('Ecenter conflict retains GET/PATCH request-auth plus generic identity regression guard', () => {
  const tests = source('tests/ecenter-features.test.ts')
  assert.ok(tests.includes('assert.match(route, /requireRequestUser\\(request\\)/)'))
  assert.ok(tests.includes('export async function GET\\(request: Request\\)[\\s\\S]*?requireRequestUser'))
  assert.ok(tests.includes('export async function PATCH\\(request: Request\\)[\\s\\S]*?requireRequestUser'))
  assert.ok(tests.includes('assert.doesNotMatch(route, /requireUser\\(/)'))
})
