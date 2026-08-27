import { InstagramProviderError, type InstagramPost, type InstagramProvider, type InstagramProviderOptions } from '@/lib/instagram/types'

/**
 * Phase 3 adapter boundary. It deliberately performs no network request until
 * a reviewed Bright Data contract is configured and enabled in a later phase.
 */
export class BrightDataInstagramProvider implements InstagramProvider {
  readonly name = 'brightdata' as const
  readonly proxyUrl: string | null

  constructor(options: InstagramProviderOptions = {}) {
    this.proxyUrl = options.proxyUrl?.trim() || null
  }

  async getLatestPosts(username: string, limit: number): Promise<InstagramPost[]> {
    void username
    void limit
    throw new InstagramProviderError('PROVIDER_DISABLED_IN_PHASE_3', 'Bright Data Provider 当前仅完成适配器边界，Phase 3 不发起外部请求')
  }
}
