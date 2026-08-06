import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'
import { getConcertCategories } from '@/lib/music-concert-category'
import { ConcertCategoryManager } from './ConcertCategoryManager'

export const dynamic = 'force-dynamic'

export default async function AdminConcertCategoriesPage() {
  const user = await requireAdminPage('/admin/music/categories', 'music_manage')
  const categories = await getConcertCategories().catch(() => [])
  return (
    <>
      <SiteHeader user={user} />
      <main className="admin-mobile-page mx-auto max-w-6xl space-y-7 px-4 py-7 sm:px-5 sm:py-9">
        <section className="rounded-[32px] border border-sky-100 bg-white/90 p-7 shadow-sm sm:p-9">
          <p className="text-sm font-black tracking-[0.2em] text-brand-700">EasMusic · 演唱会分类</p>
          <h1 className="mt-2 text-4xl font-black text-brand-950">演唱会分类管理</h1>
          <p className="mt-4 max-w-3xl text-sm font-bold leading-7 text-slate-600">
            配置前台「演唱会分类」导航（大型演唱会 / 小型企划 / 嘉宾现场）。可新增、改名、调整顺序与启停；核心分类不可删除，避免巡演失去归类。
          </p>
        </section>
        <ConcertCategoryManager initialCategories={categories} />
      </main>
    </>
  )
}
