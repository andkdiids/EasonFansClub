import type { ReactNode } from 'react'
import { AdminBackButton } from '@/components/AdminBackButton'

export default function AdminLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <>
      <AdminBackButton />
      {children}
    </>
  )
}
