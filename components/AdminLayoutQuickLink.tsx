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
        <div className="fixed bottom-24 right-4 z-40 flex flex-col gap-2 md:bottom-5">
          <Link href={inlineHref} className="rounded-full border border-sky-100 bg-brand-950 px-4 py-3 text-xs font-black text-white shadow-xl shadow-sky-900/20">
            前台编辑布局
          </Link>
          <Link href={`/admin/layout-editor?page=${pageKey}`} className="rounded-full border border-sky-100 bg-white px-4 py-3 text-xs font-black text-brand-700 shadow-xl shadow-sky-900/10">
            完整布局编辑器
          </Link>
        </div>
      ) : null}
    </>
  )
}
