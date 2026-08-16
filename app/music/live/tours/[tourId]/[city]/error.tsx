'use client'

import Link from 'next/link'
import { useParams } from 'next/navigation'

export default function MusicTourCityError({ reset }: Readonly<{ error: Error & { digest?: string }; reset: () => void }>) {
  const params = useParams<{ tourId?: string }>()
  const tourHref = params.tourId ? `/music/live/tours/${encodeURIComponent(params.tourId)}` : '/music/live'

  return (
    <main className="min-h-screen bg-[#06101d] px-4 py-16 text-white sm:px-6">
      <section className="mx-auto max-w-xl border border-white/10 bg-white/[0.05] p-6 text-center sm:p-8" role="alert">
        <h1 className="text-2xl font-black">巡演城市详情暂时无法加载</h1>
        <p className="mt-3 text-sm font-bold leading-6 text-slate-300">这次请求没有成功完成，城市资料没有被修改。请重试，或返回巡演详情。</p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={reset} className="border border-sky-300/40 bg-sky-300/15 px-4 py-3 text-sm font-black text-sky-100">重新加载</button>
          <Link href={tourHref} className="border border-white/15 px-4 py-3 text-sm font-black text-slate-200">返回巡演详情</Link>
        </div>
      </section>
    </main>
  )
}
