import { redirect } from 'next/navigation'
import { SiteHeader } from '@/components/SiteHeader'
import { getCurrentUser } from '@/lib/auth'
import { getMyStickers } from '@/lib/sticker-center'
import { MyStickerManager } from './MyStickerManager'

export const dynamic = 'force-dynamic'

export default async function ProfileStickersPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const stickers = await getMyStickers(user.id)

  return (
    <>
      <SiteHeader />
      <main className="site-page-main flat-page mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-5 sm:py-8">
        <section className="rounded-[28px] border border-sky-100 bg-white/90 p-7 shadow-sm sm:p-9">
          <p className="text-sm font-black tracking-[0.2em] text-brand-700">表情包 · 个人中心</p>
          <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">我的表情包</h1>
          <p className="mt-3 max-w-2xl text-sm font-bold leading-7 text-slate-600">
            管理你上传的表情包。删除后将从评论与私信的表情选择器中立即移除。
          </p>
        </section>
        <MyStickerManager initialStickers={stickers} />
      </main>
    </>
  )
}
