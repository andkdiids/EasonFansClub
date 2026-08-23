import { requireAdminPage } from '@/components/AdminAccess'
import { getAdminEcenterFeatureSettings } from '@/lib/ecenter-features'
import { EcenterFeatureSettingsManager } from './EcenterFeatureSettingsManager'

export const dynamic = 'force-dynamic'

export default async function EcenterFeatureSettingsPage() {
  await requireAdminPage('/admin/ecenter-features', 'nav_manage')
  const features = await getAdminEcenterFeatureSettings()

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-5 px-4 py-5 sm:gap-6 sm:px-5 sm:py-8">
      <header className="rounded-[28px] border border-sky-100 bg-white/90 p-6 shadow-sm sm:p-8">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-700">E院中心</p>
        <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">E院中心功能排序</h1>
        <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-600 sm:text-base">
          调整 E院中心弹窗、移动端中心菜单和侧栏快捷入口的共同顺序，也可以只隐藏入口。路由、图标和权限由系统固定，后台不能修改。
        </p>
      </header>
      <EcenterFeatureSettingsManager initial={features} />
    </main>
  )
}
