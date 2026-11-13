import assert from 'node:assert/strict'
import Module, { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'

test('ordinary users receive 403 from both actual redemption POST routes before any data access', async () => {
  const loader = Module as unknown as { _load: (request: string, parent: unknown, isMain: boolean) => unknown }
  const original = loader._load
  const require = createRequire(path.join(process.cwd(), 'package.json'))
  const { NextResponse } = require('next/server') as typeof import('next/server')
  let authCalls = 0
  let dataCalls = 0
  const denied = () => { dataCalls++; throw new Error('redemption data must not be accessed by an ordinary user') }
  class VerificationError extends Error {}
  loader._load = function (request, parent, isMain) {
    const name = request.replace(/\\/g, '/').replace(/\.ts$/, '')
    if (name === '@/lib/security' || name.endsWith('/lib/security')) return {
      rejectInvalidRequestOrigin: () => null,
      requireAdmin: async (permission: string) => {
        assert.equal(permission, 'activity_manage')
        authCalls++
        return { user: null, response: NextResponse.json({ message: '权限不足' }, { status: 403 }) }
      },
      enforceApiRateLimit: denied,
    }
    if (name === '@/lib/activity-redemption' || name.endsWith('/lib/activity-redemption')) return {
      ActivityRedemptionError: VerificationError,
      getActivityRedemptionLookupByToken: denied,
      confirmActivityRedemption: denied,
    }
    if (name === '@/lib/activity-registration' || name.endsWith('/lib/activity-registration')) return {
      ActivityVerificationError: VerificationError,
    }
    return original.call(this, request, parent, isMain)
  }
  try {
    const lookup = require('./app/api/admin/activities/checkin/route.ts') as typeof import('../app/api/admin/activities/checkin/route')
    const confirm = require('./app/api/admin/activities/[activityId]/redemption-confirm/route.ts') as typeof import('../app/api/admin/activities/[activityId]/redemption-confirm/route')
    const request = () => new Request('https://ecfc.fans/api/admin/activities/checkin', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: 'opaque-token', entitlements: [] }),
    })
    for (const response of [await lookup.POST(request()), await confirm.POST(request(), { params: Promise.resolve({ activityId: 'activity' }) })]) {
      assert.equal(response.status, 403)
      assert.equal((await response.json()).message, '权限不足')
    }
    assert.equal(authCalls, 2)
    assert.equal(dataCalls, 0)
  } finally {
    loader._load = original
  }
})
