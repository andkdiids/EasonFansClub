'use client'

import { ForumDiscoveryHome } from '@/components/ForumDiscoveryHome'

/**
 * E院广场只有小臣书这一套展示流。
 *
 * previewMode 只供布局编辑器渲染静态预览，不代表另一种前台模式。
 */
export function ForumHome({ previewMode = false }: Readonly<{ previewMode?: boolean }>) {
  return <ForumDiscoveryHome previewMode={previewMode} showDesktopRefresh={!previewMode} />
}
