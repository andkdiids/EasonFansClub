import Link from 'next/link'

export type AdminNavigationItem = {
  href: string
  title: string
  desc: string
}

export type AdminNavigationGroup = {
  title: string
  desc: string
  items: readonly AdminNavigationItem[]
}

export function AdminHomeSurface({
  groups,
  title = '管理后台',
  subtitle = '管理用户、内容、站点视觉、EasMusic、成就系统和 Eason 文化馆。',
}: Readonly<{
  groups: readonly AdminNavigationGroup[]
  title?: string
  subtitle?: string
}>) {
  return (
    <div className="admin-home-surface space-y-5">
      <section className="layout-card rounded-[28px] border border-sky-100 bg-white/85 p-6 shadow-sm sm:p-8">
        <p className="text-sm font-black tracking-[0.18em] text-brand-700">管理后台</p>
        <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">{title}</h1>
        <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-600 sm:text-base">{subtitle}</p>
      </section>

      <section className="layout-card rounded-[28px] border border-sky-100 bg-white/85 p-4 shadow-sm sm:p-6">
        <div className="mb-5">
          <h2 className="text-2xl font-black text-brand-950">功能入口导航</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">按业务模块进入后台管理页面，统计数据不在首页重复展示。</p>
        </div>
        <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <details key={group.title} className="group min-w-0 rounded-2xl border border-sky-100 bg-white/80 transition-colors open:bg-white">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-4 outline-none marker:hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-sky-400 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">
                  <span className="block text-lg font-black text-brand-950">{group.title}</span>
                  <span className="mt-1 block text-xs font-bold leading-5 text-slate-500">{group.desc}</span>
                </span>
                <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-lg font-black leading-none text-brand-700 transition-transform group-open:rotate-180">⌄</span>
              </summary>
              <nav className="grid min-w-0 gap-2 border-t border-sky-100 px-3 pb-3 pt-3" aria-label={`${group.title}子菜单`}>
                {group.items.map((item) => (
                  <Link
                    key={`${group.title}-${item.href}-${item.title}`}
                    href={item.href}
                    className="min-w-0 rounded-xl border border-sky-100 bg-sky-50/55 px-3 py-3 transition hover:border-sky-300 hover:bg-sky-50"
                  >
                    <span className="block break-words text-sm font-black text-brand-950">{item.title}</span>
                    <span className="mt-1 block break-words text-xs font-bold leading-5 text-slate-500">{item.desc}</span>
                  </Link>
                ))}
              </nav>
            </details>
          ))}
        </div>
      </section>
    </div>
  )
}
