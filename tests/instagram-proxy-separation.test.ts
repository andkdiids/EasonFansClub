import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { createInstagramProvider, getInstagramProviderStatus } from '@/lib/instagram/factory'
import { createInstagramMediaLocalizer, resolveInstagramMediaProxyUrl } from '@/lib/instagram/localizer'
import { SafeExternalInstagramMediaLocalizer } from '@/lib/instagram/media'

const root = process.cwd()

function localizerProxyUrl() {
  const localizer = createInstagramMediaLocalizer('mreasonchan')
  assert.ok(localizer instanceof SafeExternalInstagramMediaLocalizer)
  return (localizer as unknown as { options: { proxyUrl?: string | null } }).options.proxyUrl ?? null
}

test('Apify and media proxies stay independent across all environment combinations', () => {
  const env = process.env as Record<string, string | undefined>
  const previous = {
    NODE_ENV: env.NODE_ENV,
    IG_PROVIDER: env.IG_PROVIDER,
    ANYWHERE_DOOR_STORAGE_MODE: env.ANYWHERE_DOOR_STORAGE_MODE,
    APIFY_PROXY_URL: env.APIFY_PROXY_URL,
    IG_MEDIA_PROXY_URL: env.IG_MEDIA_PROXY_URL,
  }
  env.NODE_ENV = 'test'
  env.IG_PROVIDER = 'apify'
  env.ANYWHERE_DOOR_STORAGE_MODE = 'production'

  try {
    const cases = [
      { apify: undefined, media: 'http://media-proxy', expectedApify: null, expectedMedia: 'http://media-proxy' },
      { apify: 'http://apify-proxy', media: undefined, expectedApify: 'http://apify-proxy/', expectedMedia: null },
      { apify: 'http://apify-proxy', media: 'http://media-proxy', expectedApify: 'http://apify-proxy/', expectedMedia: 'http://media-proxy' },
      { apify: undefined, media: undefined, expectedApify: null, expectedMedia: null },
    ]

    for (const entry of cases) {
      if (entry.apify === undefined) delete env.APIFY_PROXY_URL
      else env.APIFY_PROXY_URL = entry.apify
      if (entry.media === undefined) delete env.IG_MEDIA_PROXY_URL
      else env.IG_MEDIA_PROXY_URL = entry.media

      const provider = createInstagramProvider({ provider: 'apify' })
      assert.equal(provider.proxyUrl, entry.expectedApify)
      assert.equal(resolveInstagramMediaProxyUrl(), entry.expectedMedia)
      assert.equal(localizerProxyUrl(), entry.expectedMedia)
    }
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete env[key]
      else env[key] = value
    }
  }
})

test('provider status reports Apify and media proxy state separately', () => {
  const env = process.env as Record<string, string | undefined>
  const previous = {
    NODE_ENV: env.NODE_ENV,
    IG_PROVIDER: env.IG_PROVIDER,
    APIFY_PROXY_URL: env.APIFY_PROXY_URL,
    IG_MEDIA_PROXY_URL: env.IG_MEDIA_PROXY_URL,
  }
  env.NODE_ENV = 'test'
  env.IG_PROVIDER = 'apify'
  env.APIFY_PROXY_URL = 'http://apify-proxy'
  env.IG_MEDIA_PROXY_URL = 'http://media-proxy'

  try {
    const status = getInstagramProviderStatus()
    assert.equal(status.proxyConfigured, true)
    assert.equal(status.proxyType, 'http')
    assert.equal(status.mediaProxyConfigured, true)
    assert.equal(status.mediaProxyType, 'http')
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete env[key]
      else env[key] = value
    }
  }
})

test('default sync construction does not inherit provider.proxyUrl', () => {
  const source = readFileSync(resolve(root, 'lib/instagram/sync-service.ts'), 'utf8')
  assert.match(source, /createInstagramMediaLocalizer\(target\)/)
  assert.doesNotMatch(source, /createInstagramMediaLocalizer\(target,\s*provider\.proxyUrl\)/)
  assert.doesNotMatch(source, /createInstagramMediaLocalizer\([^)]*provider\.proxyUrl/)
})
