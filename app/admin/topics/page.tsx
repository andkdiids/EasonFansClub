import { requireAdminPage } from '@/components/AdminAccess'
import { TopicAdminManager } from './TopicAdminManager'

export const dynamic = 'force-dynamic'

export default async function AdminTopicsPage() {
  await requireAdminPage('/admin/topics', 'post_manage')
  return (
    <main className="mx-auto max-w-7xl space-y-6 px-4 py-7 sm:px-5 sm:py-9">
      <section className="border border-sky-100 bg-white/90 p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900/90 sm:p-8">
        <h1 className="text-3xl font-black text-brand-950 dark:text-slate-100">话题管理</h1>
        <p className="mt-3 text-sm font-bold leading-7 text-slate-600 dark:text-slate-300">创建和维护官方话题。相同名称会复用已有话题，不会创建重复记录。</p>
      </section>
      <TopicAdminManager />
    </main>
  )
}
