'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { AdminInlineLayoutEditor } from '@/components/AdminInlineLayoutEditor'
import { pageLayoutPages } from '@/lib/page-layout/registry'
import type { PageLayoutPageKey } from '@/lib/page-layout/types'

const editablePageMap = Object.fromEntries(
  Object.entries(pageLayoutPages).map(([key, page]) => [page.path, key as PageLayoutPageKey]),
) as Record<string, PageLayoutPageKey>

export function AdminLayoutQuickLink({ enabled }: { enabled: boolean }) {
  const pathname = usePathname()
  const [inlineEdit, setInlineEdit] = useState(false)

  useEffect(() => {
    setInlineEdit(new URLSearchParams(window.location.search).get('layoutEdit') === '1')
  }, [pathname])

  if (!enabled) return null

  const pageKey = editablePageMap[pathname || '']
  if (!pageKey) return null
  const inlineHref = `${pathname || '/'}?layoutEdit=1`

  return (
    <>
      {inlineEdit ? <AdminInlineLayoutEditor pageKey={pageKey} /> : null}
      {!inlineEdit ? (
        <details className="app-layout-tools">
          <summary>布局</summary>
          <div>
            <Link href={inlineHref}>前台编辑布局</Link>
            <Link href={`/admin/layout-editor?page=${pageKey}`}>完整布局编辑器</Link>
          </div>
        </details>
      ) : null}
    </>
  )
}
