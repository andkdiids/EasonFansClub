import { redirect } from 'next/navigation'

import { getCurrentUser } from '@/lib/auth'
import { StickerPackUploader } from './StickerPackUploader'

export const dynamic = 'force-dynamic'

export default async function StickerUploadPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  return (
    <>
      
      <main className="site-page-main flat-page mx-auto max-w-3xl space-y-5 px-4 py-6 sm:px-5 sm:py-8">
        <header className="rounded-[28px] border border-sky-100 bg-white/90 p-7 shadow-sm sm:p-9">
          <h1 className="text-3xl font-black text-brand-950 sm:text-4xl">上传表情包</h1>
          <p className="mt-3 max-w-2xl text-sm font-bold leading-7 text-slate-600">
            请上传与陈奕迅相关的表情包内容。<br />
            与陈奕迅无关、低质量或不符合社区规范的表情包可能无法通过审核。
          </p>
        </header>
        <StickerPackUploader />
      </main>
    </>
  )
}
