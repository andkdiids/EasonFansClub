import { InstagramProviderError, type InstagramPost, type InstagramProvider, type InstagramProviderOptions } from '@/lib/instagram/types'

/**
 * Browser is retained as a documented fallback only. The old authenticated
 * session remains a manual PoC artifact and is never silently reused by jobs.
 */
export class AuthenticatedBrowserInstagramProvider implements InstagramProvider {
  readonly name = 'browser' as const
  readonly proxyUrl: string | null
  readonly enabled: boolean

  constructor(options: InstagramProviderOptions = {}) {
    this.proxyUrl = options.proxyUrl?.trim() || null
    this.enabled = options.enabled === true || process.env.IG_BROWSER_ENABLED === 'true'
  }

  async getLatestPosts(username: string, limit: number): Promise<InstagramPost[]> {
    void username
    void limit
    throw new InstagramProviderError(
      'PROVIDER_DISABLED_IN_PHASE_3',
      this.enabled
        ? 'Browser Provider 仅作为人工登录 PoC 记录，当前版本不自动访问 Instagram'
        : 'Browser Provider 已禁用，避免将登录态作为生产默认方案',
    )
  }
}
