import assert from 'node:assert/strict'
import test from 'node:test'
import { NextRequest } from 'next/server'
import { middleware } from '../middleware'
import {
  buildPublicAbsoluteUrl,
  getPublicOrigin,
  legacyLocalhostUrlToInternalPath,
  normalizeActionUrl,
  normalizeStoredInternalPath,
  safeInternalPath,
} from '../lib/url-safety'

async function withEnvironment(values: Record<string, string | undefined>, callback: () => void | Promise<void>) {
  const previous = new Map<string, string | undefined>()
  for (const [name, value] of Object.entries(values)) {
    previous.set(name, process.env[name])
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }

  try {
    await callback()
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
  }
}

test('URL safety rejects external redirects, migrates old local links, and protects production origins', async () => {
  await withEnvironment({ NODE_ENV: 'production', APP_URL: undefined, NEXT_PUBLIC_APP_URL: undefined }, async () => {
    assert.equal(safeInternalPath('/posts/123?tab=latest'), '/posts/123?tab=latest')
    assert.equal(safeInternalPath('https://evil.example/posts/1', '/'), '/')
    assert.equal(safeInternalPath('//evil.example/posts/1', '/'), '/')
    assert.equal(safeInternalPath('javascript:alert(1)', '/'), '/')
    assert.equal(safeInternalPath('/%2F%2Fevil.example', '/'), '/')

    const legacy = 'https://localhost:3000/posts/1?focus=reply-1'
    assert.equal(legacyLocalhostUrlToInternalPath(legacy), '/posts/1?focus=reply-1')
    assert.equal(normalizeStoredInternalPath(legacy), '/posts/1?focus=reply-1')
    assert.equal(normalizeStoredInternalPath('https://evil.example/posts/1'), null)
    assert.equal(normalizeActionUrl(legacy), '/posts/1?focus=reply-1')
    assert.equal(normalizeActionUrl('https://evil.example/posts/1'), 'https://evil.example/posts/1')
    assert.equal(normalizeActionUrl('javascript:alert(1)'), null)

    const forwardedRequest = new Request('http://127.0.0.1:3000/profile', {
      headers: {
        host: 'ecfc.fans',
        'x-forwarded-host': 'ecfc.fans',
        'x-forwarded-proto': 'https',
      },
    })
    assert.equal(getPublicOrigin(forwardedRequest), 'https://ecfc.fans')
    assert.equal(buildPublicAbsoluteUrl('/share', forwardedRequest), 'https://ecfc.fans/share')

    // A bad production URL variable is fail-closed to the canonical public origin.
    process.env.APP_URL = 'http://localhost:3000'
    assert.equal(buildPublicAbsoluteUrl('/login'), 'https://ecfc.fans/login')
    assert.doesNotMatch(buildPublicAbsoluteUrl('/login'), /localhost|127\.0\.0\.1|::1/i)

    const internalOnlyRequest = new NextRequest('http://localhost:3000/profile', {
      headers: { host: 'localhost:3000' },
    })
    const internalOnlyResponse = await middleware(internalOnlyRequest)
    assert.equal(internalOnlyResponse.headers.get('location'), 'https://ecfc.fans/login?next=%2Fprofile')
    assert.doesNotMatch(internalOnlyResponse.headers.get('location') || '', /localhost|127\.0\.0\.1|::1/i)

    const request = new NextRequest('http://localhost:3000/profile?tab=latest', {
      headers: {
        host: 'ecfc.fans',
        'x-forwarded-host': 'ecfc.fans',
        'x-forwarded-proto': 'https',
      },
    })
    const response = await middleware(request)
    assert.equal(response.status, 307)
    assert.equal(response.headers.get('location'), 'https://ecfc.fans/login?next=%2Fprofile%3Ftab%3Dlatest')
    assert.doesNotMatch(response.headers.get('location') || '', /localhost|127\.0\.0\.1|::1/i)
  })

  await withEnvironment({ NODE_ENV: 'development', APP_URL: undefined, NEXT_PUBLIC_APP_URL: undefined }, async () => {
    const developmentOrigin = getPublicOrigin()
    assert.equal(developmentOrigin, 'http://localhost:3000')
  })
})
