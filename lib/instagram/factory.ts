import { ApifyInstagramProvider } from '@/lib/instagram/apify-provider'
import { AuthenticatedBrowserInstagramProvider } from '@/lib/instagram/authenticated-browser-provider'
import { BrightDataInstagramProvider } from '@/lib/instagram/bright-data-provider'
import { InstagramProviderError, INSTAGRAM_PROVIDER_NAMES, type InstagramProvider, type InstagramProviderName } from '@/lib/instagram/types'
import { MockInstagramProvider } from '@/lib/instagram/mock-provider'

function envPresent(name: string) {
  return Boolean(process.env[name]?.trim())
}

export function resolveInstagramProviderName(value = process.env.IG_PROVIDER): InstagramProviderName {
  const configured = value?.trim().toLowerCase()
  const selected = configured || (process.env.NODE_ENV === 'production' ? '' : 'mock')
  if (!selected) {
    throw new InstagramProviderError('CONFIG_ERROR', '生产环境必须显式配置 IG_PROVIDER=apify')
  }
  if (!(INSTAGRAM_PROVIDER_NAMES as readonly string[]).includes(selected)) {
    throw new InstagramProviderError('CONFIG_ERROR', `未知的 Instagram Provider: ${selected}`)
  }
  if (process.env.NODE_ENV === 'production' && selected !== 'apify') {
    throw new InstagramProviderError('CONFIG_ERROR', '生产环境只允许使用显式配置的 Apify Provider')
  }
  return selected as InstagramProviderName
}

export function createInstagramProvider(options: { provider?: string; proxyUrl?: string | null } = {}): InstagramProvider {
  const name = resolveInstagramProviderName(options.provider)
  const configuredProxy = options.proxyUrl !== undefined
    ? options.proxyUrl
    : name === 'apify' ? process.env.APIFY_PROXY_URL ?? null : process.env.IG_PROXY_URL ?? null
  const providerOptions = { proxyUrl: configuredProxy }
  switch (name) {
    case 'brightdata': return new BrightDataInstagramProvider(providerOptions)
    case 'apify': return new ApifyInstagramProvider(providerOptions)
    case 'browser': return new AuthenticatedBrowserInstagramProvider({ ...providerOptions, enabled: process.env.IG_BROWSER_ENABLED === 'true' })
    case 'mock': return new MockInstagramProvider(providerOptions)
  }
}

export function getInstagramProviderStatus() {
  const provider = resolveInstagramProviderName()
  const proxyUrl = provider === 'apify' ? process.env.APIFY_PROXY_URL : process.env.IG_PROXY_URL
  return {
    provider,
    target: process.env.IG_TARGET_USERNAME?.trim() || 'mreasonchan',
    proxyConfigured: Boolean(proxyUrl?.trim()),
    proxyType: proxyUrl?.trim().split('://', 1)[0]?.toLowerCase() || null,
    directFallback: false,
    browserEnabled: process.env.IG_BROWSER_ENABLED === 'true',
    brightDataConfigured: envPresent('BRIGHT_DATA_API_KEY'),
    apifyConfigured: envPresent('APIFY_API_TOKEN'),
    sessionStateConfigured: envPresent('IG_SESSION_STATE_PATH'),
  } as const
}
