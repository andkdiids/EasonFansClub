'use client'

import { ForumDiscoveryHome } from '@/components/ForumDiscoveryHome'

/**
 * E院广场共享一套发现流数据，再由页面选择展示方式。
 */
export function ForumHome() {
  return <ForumDiscoveryHome showDesktopRefresh />
}
