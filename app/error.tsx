'use client'

import Link from 'next/link'

export default function RootError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="grid min-h-screen place-items-center bg-gradient-to-br from-sky-50 via-white to-cyan-50 px-5">
      <section className="w-full max-w-lg rounded-[32px] border border-sky-100 bg-white/85 p-8 text-center shadow-xl shadow-sky-900/10">
        <p className="text-sm font-black uppercase tracking-[0.22em] text-sky-700">Eason Fans Club</p>
        <h1 className="mt-3 text-3xl font-black text-brand-950">页面暂时无法加载</h1>
        <p className="mt-4 text-sm font-bold leading-7 text-slate-500">
          可能是某个数据模块暂时超时。你可以重试，或先回到首页。
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <button onClick={reset} className="rounded-full bg-brand-950 px-5 py-3 text-sm font-black text-white">
            重试
          </button>
          <Link href="/" className="rounded-full bg-sky-50 px-5 py-3 text-sm font-black text-brand-700">
            回到首页
          </Link>
        </div>
      </section>
    </main>
  )
}
