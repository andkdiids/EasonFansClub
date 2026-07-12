import Link from 'next/link'
import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'
import { adminModulePermissions } from '@/lib/admin-permissions'

export async function AdminSectionPage({
  path,
  title,
  description,
}: Readonly<{ path: keyof typeof adminModulePermissions; title: string; description: string }>) {
  const user = await requireAdminPage(path, adminModulePermissions[path])

  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-5 sm:py-8">
        <section className="rounded-[28px] border border-sky-100 bg-white/85 p-6 shadow-sm sm:p-8">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Admin Center</p>
          <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">{title}</h1>
          <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-600 sm:text-base">{description}</p>
          <Link href="/admin" className="mt-6 inline-flex min-h-11 items-center rounded-full bg-brand-950 px-5 text-sm font-black text-white">
            返回后台首页
          </Link>
        </section>

        <section className="rounded-2xl border border-sky-100 bg-white/80 p-5 shadow-sm sm:p-6">
          <h2 className="text-xl font-black text-brand-950">模块已接入权限校验</h2>
          <p className="mt-2 text-sm font-bold leading-7 text-slate-500">
            当前页面已经通过统一权限方法校验。后续可以在这里继续补充具体数据表、筛选项和操作按钮。
          </p>
        </section>
      </main>
    </>
  )
}
