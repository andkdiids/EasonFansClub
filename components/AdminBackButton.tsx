'use client'

import { usePathname } from 'next/navigation'
import { BackButton } from '@/components/BackButton'

export function AdminBackButton() {
  const pathname = usePathname()

  if (!pathname || pathname === '/admin' || pathname === '/admin/no-access') return null

  return (
    <div className="mx-auto w-full max-w-7xl px-4 pt-4 sm:px-5 sm:pt-5">
      <BackButton fallbackHref="/admin" label="返回" />
    </div>
  )
}
