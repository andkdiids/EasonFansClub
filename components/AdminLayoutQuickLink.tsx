'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { pageLayoutPages } from '@/lib/page-layout/registry'
import type { PageLayoutPageKey } from '@/lib/page-layout/types'

const editablePageMap = Object.fromEntries(
  Object.entries(pageLayoutPages)
    .filter(([, page]) => !page.path.includes('?') && !page.path.includes('#'))
    .map(([key, page]) => [page.path, key as PageLayoutPageKey]),
) as Record<string, PageLayoutPageKey>

export function AdminLayoutQuickLink({ enabled }: { enabled: boolean }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  if (!enabled) return null

  const isAnnouncementBoard = pathname === '/forum' && searchParams.get('board') === 'announcements'
  const pageKey = isAnnouncementBoard ? 'announcement' : editablePageMap[pathname || '']
  if (!pageKey) return null

  return (
    <details className="app-layout-tools">
      <summary>布局</summary>
      <div><Link href={`/admin/layout-editor?page=${pageKey}`}>打开页面布局编辑器</Link></div>
    </details>
  )
}
