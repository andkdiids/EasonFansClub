import Link from 'next/link'
import { ConcertDiscussionAdminManager } from '@/app/admin/concerts/discussions/ConcertDiscussionAdminManager'
import { requireAdminPage } from '@/components/AdminAccess'

export const dynamic = 'force-dynamic'

export default async function AdminConcertDiscussionsPage() {
  await requireAdminPage('/admin/concerts/discussions', 'activity_manage')
  return <main className="mx-auto max-w-6xl space-y-6 px-4 py-7 sm:px-5 sm:py-9">
    <section className="border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-7">
      <Link href="/admin/concerts" className="text-sm font-bold text-[var(--primary)]">← 演唱会专题管理</Link>
      <h1 className="mt-3 text-2xl font-black text-[var(--foreground)] sm:text-3xl">Recording Sessions 讨论管理</h1>
      <p className="mt-2 text-sm leading-6 text-[var(--foreground-muted)]">查看专题和单场讨论。移除内容会保留记录并写入管理员操作审计。</p>
    </section>
    <ConcertDiscussionAdminManager />
  </main>
}
