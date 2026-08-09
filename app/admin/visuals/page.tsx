import Link from 'next/link'
import { requireAdminPage } from '@/components/AdminAccess'
import { pageVisualKeys, type PageVisualKey } from '@/lib/hero-visuals'

export const dynamic = 'force-dynamic'

const pageVisualLabels: Record<PageVisualKey, { title: string; description: string }> = {
  login: { title: '登录页', description: '设置登录页背景与桌面、移动端构图。' },
  register: { title: '注册页', description: '设置注册页背景与桌面、移动端构图。' },
  welcome: { title: '欢迎页', description: '设置欢迎页背景与桌面、移动端构图。' },
  home: { title: '首页 Hero', description: '设置首页 Hero 媒体、构图与响应式显示。' },
}

export default async function AdminVisualsPage() {
  await requireAdminPage('/admin/visuals', 'site_config_manage')

  return <main className="mx-auto max-w-6xl px-4 py-8 sm:px-5">
    <header className="border-b border-slate-200 pb-6">
      <p className="text-xs font-black uppercase tracking-[0.24em] text-sky-700">Page Visual Settings</p>
      <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">页面视觉设置</h1>
      <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-500">登录页、注册页、欢迎页和首页 Hero 分开保存。每个页面都可以独立设置媒体、桌面构图和移动构图。</p>
    </header>
    <section className="mt-6 grid gap-4 sm:grid-cols-2">
      {pageVisualKeys.map((key) => {
        const item = pageVisualLabels[key]
        return <Link key={key} href={`/admin/visuals/${key}`} className="border border-slate-200 bg-white p-5 shadow-[0_8px_26px_rgba(15,23,42,.04)] transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md">
          <h2 className="text-xl font-black text-brand-950">{item.title}</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-500">{item.description}</p>
          <span className="mt-5 inline-flex text-sm font-black text-sky-700">进入设置 →</span>
        </Link>
      })}
    </section>
  </main>
}
