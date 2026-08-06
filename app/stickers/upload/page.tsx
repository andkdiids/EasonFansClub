import { redirect } from 'next/navigation'
import { SiteHeader } from '@/components/SiteHeader'
import { getCurrentUser } from '@/lib/auth'
import { StickerPackUploader } from './StickerPackUploader'

export const dynamic = 'force-dynamic'

export default async function StickerUploadPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  return (
    <>
      <SiteHeader />
      <main className="site-page-main flat-page mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-5 sm:py-8">
        <header className="rounded-[28px] border border-sky-100 bg-white/90 p-7 shadow-sm sm:p-9">
          <p className="text-sm font-black tracking-[0.2em] text-brand-700">表情包 · 上传</p>
          <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">上传表情包</h1>
          <p className="mt-3 max-w-2xl text-sm font-bold leading-7 text-slate-600">
            提交后进入审核队列，审核通过即可出现在表情商店中供所有用户添加。
          </p>
        </header>
        <StickerPackUploader />
      </main>
    </>
  )
}
