import { redirect } from 'next/navigation'
import Link from 'next/link'

import { getCurrentUser } from '@/lib/auth'
import { getStorePackDetail } from '@/lib/sticker-center'
import { StickerPackDetailView } from './StickerPackDetailView'
import { publicImageVariantUrl } from '@/lib/image-variants'

export const dynamic = 'force-dynamic'

export default async function StickerPackDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login')
  const { id } = await params
  const detail = await getStorePackDetail(id, user.id)
  if (!detail) {
    return (
      <>
        
        <main className="site-page-main flat-page mx-auto max-w-3xl px-4 py-12 sm:px-6">
          <div className="rounded-3xl border border-dashed border-slate-200 bg-white/70 p-10 text-center text-sm font-bold text-slate-400">
            表情包不存在或已下架
            <div className="mt-4">
              <Link href="/stickers" className="flat-button-primary">返回商店</Link>
            </div>
          </div>
        </main>
      </>
    )
  }

  return (
    <>
      
      <main className="site-page-main flat-page mx-auto max-w-4xl space-y-5 px-4 py-6 sm:px-5 sm:py-8">
        <div className="flex items-center gap-2 text-sm font-bold text-slate-500">
          <Link href="/stickers" className="hover:text-brand-700">← 返回商店</Link>
        </div>

        <section className="overflow-hidden rounded-[28px] border border-sky-100 bg-white shadow-sm">
          <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-[180px_1fr] sm:p-7">
            <div className="aspect-square w-full overflow-hidden rounded-2xl bg-slate-100 sm:w-[180px]">
              {detail.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={publicImageVariantUrl(detail.coverUrl, 'card') || detail.coverUrl} alt={detail.name} className="h-full w-full object-cover" loading="eager" />
              ) : (
                <div className="flex h-full items-center justify-center text-6xl">😊</div>
              )}
            </div>

            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-black text-brand-950 sm:text-3xl">{detail.name}</h1>
                {detail.isOfficial ? (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-black text-amber-700">官方</span>
                ) : null}
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-600">{detail.type === 'GIF' ? '动态' : '静态'}</span>
                {detail.category ? (
                  <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-bold text-brand-700">{detail.category}</span>
                ) : null}
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <Stat label="作者" value={detail.isOfficial ? 'E院官方' : detail.creator?.nickname || '匿名'} />
                <Stat label="表情数" value={`${detail.stickerCount}`} />
                <Stat label="下载次数" value={detail.downloadCount.toLocaleString('zh-CN')} />
              </div>
              {detail.description ? (
                <p className="rounded-2xl bg-slate-50 px-3 py-2 text-sm font-bold leading-6 text-slate-600">
                  {detail.description}
                </p>
              ) : null}
              <StickerPackDetailView pack={detail} />
            </div>
          </div>
        </section>

        <section className="rounded-[28px] border border-sky-100 bg-white p-5 shadow-sm sm:p-7">
          <h2 className="text-base font-black text-brand-950">表情预览（共 {detail.stickers.length} 张）</h2>
          <div className="mt-4 grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8">
            {detail.stickers.map((s) => (
              <div key={s.id} className="flex aspect-square items-center justify-center rounded-xl bg-slate-50">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={publicImageVariantUrl(s.url, 'thumb-sm') || s.url} alt={s.name || ''} className="h-12 w-12 object-contain" loading="lazy" />
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 px-3 py-2">
      <p className="text-[11px] font-bold text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-black text-brand-950">{value}</p>
    </div>
  )
}
