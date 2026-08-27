import { requireAdminPage } from '@/components/AdminAccess'
import { AnywhereDoorAdminClient } from './AnywhereDoorAdminClient'

export const dynamic = 'force-dynamic'

export default async function AnywhereDoorAdminPage() {
  await requireAdminPage('/admin/anywhere-door', 'social_manage')
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:gap-6 sm:px-5 sm:py-8">
      <header className="rounded-[28px] border border-sky-100 bg-white/90 p-6 shadow-sm sm:p-8"><p className="text-xs font-black uppercase tracking-[0.2em] text-brand-700">Anywhere Door Admin</p><h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">随意门管理</h1><p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-600">查看 Provider 边界、同步状态和已存储动态。同步请求只交给独立 Worker 执行，所有生产开关默认关闭。</p></header>
      <AnywhereDoorAdminClient />
    </main>
  )
}
