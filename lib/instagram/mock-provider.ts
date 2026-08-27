import { MOCK_INSTAGRAM_POSTS } from '@/lib/instagram/fixtures'
import { dedupeAndSortInstagramPosts } from '@/lib/instagram/normalize'
import { normalizeInstagramUsername, normalizeProviderLimit, type InstagramProvider, type InstagramProviderOptions } from '@/lib/instagram/types'

export class MockInstagramProvider implements InstagramProvider {
  readonly name = 'mock' as const
  readonly proxyUrl: string | null

  constructor(options: InstagramProviderOptions = {}) {
    this.proxyUrl = options.proxyUrl?.trim() || null
  }

  async getLatestPosts(username: string, limit: number) {
    const normalizedUsername = normalizeInstagramUsername(username)
    const posts = MOCK_INSTAGRAM_POSTS.filter((post) => post.username === normalizedUsername)
    return dedupeAndSortInstagramPosts(posts, normalizeProviderLimit(limit))
  }
}
