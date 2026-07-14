'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const editablePageMap: Record<string, string> = {
  '/': 'home',
  '/checkin': 'checkin',
  '/admin': 'admin-home',
}

export function AdminLayoutQuickLink({ enabled }: { enabled: boolean }) {
  const pathname = usePathname()
  if (!enabled) return null

  const pageKey = editablePageMap[pathname || '']
  if (!pageKey) return null

  return (
    <Link
      href={`/admin/layout-editor?page=${pageKey}`}
      className="fixed bottom-24 right-4 z-40 rounded-full border border-sky-100 bg-brand-950 px-4 py-3 text-xs font-black text-white shadow-xl shadow-sky-900/20 md:bottom-5"
    >
      编辑当前页面布局
    </Link>
  )
}
