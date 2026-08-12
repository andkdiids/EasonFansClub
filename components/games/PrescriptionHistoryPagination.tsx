'use client'

import { usePathname, useRouter } from 'next/navigation'
import { Pagination } from '@/components/ui/Pagination'

export function PrescriptionHistoryPagination({ currentPage, totalPages }: Readonly<{ currentPage: number; totalPages: number }>) {
  const router = useRouter()
  const pathname = usePathname()

  return (
    <Pagination
      currentPage={currentPage}
      totalPages={totalPages}
      onPageChange={(page) => router.push(`${pathname}?page=${page}`, { scroll: true })}
      ariaLabel="历史处方分页"
    />
  )
}
