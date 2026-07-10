import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

const typeText: Record<string, string> = {
  SONG: '歌曲百科',
  ALBUM: '专辑馆',
  FILM: '电影馆',
  LIVE: 'Live 档案馆',
}

export default async function AdminCulturePage() {
  await requireAdminPage('/admin/culture', 'culture_manage')

  const [items, quotes, templates] = await Promise.all([
    prisma.cultureItem.findMany({
      orderBy: [{ type: 'asc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
      take: 80,
    }),
    prisma.dailyQuote.findMany({
      orderBy: [{ isPinned: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'desc' }],
      take: 20,
    }),
    prisma.lyricCardTemplate.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      take: 20,
    }),
  ])

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-5">
        <section className="rounded-[28px] border border-sky-100 bg-white/85 p-6 shadow-sm">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Culture Admin</p>
          <h1 className="mt-2 text-3xl font-black text-brand-950">Eason 文化馆管理</h1>
          <p className="mt-3 text-sm font-bold leading-7 text-slate-600">
            歌曲百科、专辑馆、电影馆、Live 档案、每日一句和歌词卡片模板均从数据库读取。
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl border border-sky-100 bg-white/85 p-5 shadow-sm">
            <p className="text-sm font-bold text-slate-500">文化内容</p>
            <p className="mt-2 text-3xl font-black text-brand-950">{items.length}</p>
          </div>
          <div className="rounded-2xl border border-sky-100 bg-white/85 p-5 shadow-sm">
            <p className="text-sm font-bold text-slate-500">今日一句</p>
            <p className="mt-2 text-3xl font-black text-brand-950">{quotes.length}</p>
          </div>
          <div className="rounded-2xl border border-sky-100 bg-white/85 p-5 shadow-sm">
            <p className="text-sm font-bold text-slate-500">歌词卡片模板</p>
            <p className="mt-2 text-3xl font-black text-brand-950">{templates.length}</p>
          </div>
        </section>

        <section className="rounded-[24px] border border-sky-100 bg-white/85 p-5 shadow-sm">
          <h2 className="text-2xl font-black text-brand-950">文化馆内容</h2>
          <div className="mt-4 divide-y divide-sky-100">
            {items.map((item) => (
              <div key={item.id} className="grid gap-3 py-4 md:grid-cols-[0.8fr_1.2fr_0.8fr_0.5fr]">
                <p className="font-black text-brand-950">{item.title}</p>
                <p className="text-sm font-bold text-slate-500">{item.summary || item.subtitle || '暂无简介'}</p>
                <p className="text-sm font-bold text-slate-600">{typeText[item.type] || item.type}</p>
                <p className="text-sm font-bold text-slate-600">{item.isVisible ? '显示' : '隐藏'}</p>
              </div>
            ))}
            {!items.length ? <p className="py-6 text-sm font-bold text-slate-500">暂无文化馆内容。</p> : null}
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-[24px] border border-sky-100 bg-white/85 p-5 shadow-sm">
            <h2 className="text-2xl font-black text-brand-950">每日一句</h2>
            <div className="mt-4 space-y-3">
              {quotes.map((quote) => (
                <div key={quote.id} className="rounded-2xl bg-sky-50/80 p-4">
                  <p className="font-black text-brand-950">{quote.content}</p>
                  <p className="mt-2 text-xs font-bold text-slate-500">{quote.songTitle || '未绑定歌曲'} · {quote.isPinned ? '置顶' : '普通'}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[24px] border border-sky-100 bg-white/85 p-5 shadow-sm">
            <h2 className="text-2xl font-black text-brand-950">歌词卡片模板</h2>
            <div className="mt-4 space-y-3">
              {templates.map((template) => (
                <div key={template.id} className="rounded-2xl bg-sky-50/80 p-4">
                  <p className="font-black text-brand-950">{template.name}</p>
                  <p className="mt-2 text-xs font-bold text-slate-500">
                    {template.textColor} · {template.accentColor} · {template.isVisible ? '显示' : '隐藏'}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>
    </>
  )
}
