import { redirect } from 'next/navigation'
import Link from 'next/link'

import { getCurrentUser } from '@/lib/auth'
import { getStoreCategories, getStorePacks } from '@/lib/sticker-center'
import { StickerStoreGrid } from './StickerStoreGrid'

export const dynamic = 'force-dynamic'

type Search = { sort?: string; category?: string; page?: string }

export default async function StickerStorePage({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const params = await searchParams
  const sort: 'hot' | 'new' | 'official' = params.sort === 'new' || params.sort === 'official' ? params.sort : 'hot'
  const category = params.category || null
  const page = Math.max(1, parseInt(params.page || '1', 10) || 1)

  const [{ packs, total, pageSize }, categories] = await Promise.all([
    getStorePacks({ userId: user.id, sort, category, page, pageSize: 24 }),
    getStoreCategories(),
  ])
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  return (
    <>
      
      <main className="site-page-main flat-page mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-5 sm:py-8">
        <section className="rounded-[28px] border border-sky-100 bg-white/90 p-6 shadow-sm sm:p-8">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-black tracking-[0.2em] text-brand-700">表情包 · 商店</p>
              <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">表情包商店</h1>
              <p className="mt-3 max-w-2xl text-sm font-bold leading-7 text-slate-600">
                点击「添加」即可加入你的表情库，就能在私信与评论中发送。
              </p>
            </div>
            <Link
              href="/stickers/upload"
              className="flat-button-primary hidden shrink-0 sm:inline-flex"
            >
              上传表情包
            </Link>
          </div>
        </section>

        <nav className="flex flex-wrap items-center gap-2 text-sm font-bold">
          <Link href="/stickers?sort=hot" className={sort === 'hot' ? 'pill-active' : 'pill'}>热门表情包</Link>
          <Link href="/stickers?sort=new" className={sort === 'new' ? 'pill-active' : 'pill'}>最新上传</Link>
          <Link href="/stickers?sort=official" className={sort === 'official' ? 'pill-active' : 'pill'}>官方表情</Link>
          {categories.length > 0 ? (
            <>
              <span className="mx-1 text-slate-300">|</span>
              <Link href={`/stickers?sort=${sort}`} className={!category ? 'pill-active' : 'pill'}>全部分类</Link>
              {categories.map((c) => (
                <Link
                  key={c}
                  href={`/stickers?sort=${sort}&category=${encodeURIComponent(c)}`}
                  className={category === c ? 'pill-active' : 'pill'}
                >
                  {c}
                </Link>
              ))}
            </>
          ) : null}
        </nav>

        <StickerStoreGrid packs={packs} total={total} page={page} pageSize={pageSize} totalPages={totalPages} sort={sort} category={category} />

        <Link href="/stickers/upload" className="flat-button-primary sm:hidden">上传表情包</Link>
        <style>{`
          .pill { padding: 7px 14px; border-radius: 9999px; background: #fff; color: #475569; border: 1px solid #cbd5e1; font-weight: 700; }
          .pill:hover { background: #f1f5f9; }
          .pill-active { padding: 7px 14px; border-radius: 9999px; background: #0e58bd; color: #fff; border: 1px solid #0e58bd; font-weight: 800; }
        `}</style>
      </main>
    </>
  )
}
