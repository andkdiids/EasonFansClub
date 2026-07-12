'use client'

import Link from 'next/link'

export default function ProfileError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto max-w-4xl px-5 py-10">
      <section className="rounded-[28px] border border-sky-100 bg-white/85 p-8 text-center shadow-sm">
        <h1 className="text-2xl font-black text-brand-950">个人中心暂时无法加载</h1>
        <p className="mt-3 text-sm font-bold text-slate-500">资料模块暂时不可用，稍后重试即可。</p>
        <div className="mt-6 flex justify-center gap-3">
          <button onClick={reset} className="rounded-full bg-brand-950 px-5 py-3 text-sm font-black text-white">
            重试
          </button>
          <Link href="/" className="rounded-full bg-sky-50 px-5 py-3 text-sm font-black text-brand-700">
            返回首页
          </Link>
        </div>
      </section>
    </main>
  )
}
