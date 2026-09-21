import { requireAdminPage } from '@/components/AdminAccess'
import { BetaAccessAdminManager } from './BetaAccessAdminManager'

export const dynamic = 'force-dynamic'

export default async function AdminBetaAccessPage() {
  await requireAdminPage('/admin/beta-access', 'beta_access_manage')
  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-7 sm:px-5 sm:py-9">
      <section className="rounded-[28px] border border-sky-100 bg-white/90 p-6 shadow-sm sm:p-8">
        <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Android Beta Access</p>
        <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">内测准入管理</h1>
        <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-600">
          通过动态内测码控制 Android 内测资格。完整内测码只在生成成功后显示一次，刷新页面后仅保留安全掩码。
        </p>
      </section>
      <BetaAccessAdminManager />
    </main>
  )
}
