'use client'

import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

function SubmittedContent() {
  const router = useRouter()
  const params = useSearchParams()
  const postId = params.get('postId') || ''
  const status = params.get('status') || ''
  const [count, setCount] = useState(5)

  // 审核通过（已公开）且存在 postId → 返回帖子详情；否则返回 E院广场。
  const target = status === 'APPROVED' && postId ? `/posts/${postId}` : '/forum'

  useEffect(() => {
    if (count <= 0) {
      router.push(target)
      return
    }
    const timer = window.setTimeout(() => setCount((value) => value - 1), 1000)
    return () => window.clearTimeout(timer)
  }, [count, target, router])

  function goBack() {
    router.push(target)
  }

  return (
    <main className="site-page-main flat-page mx-auto max-w-2xl space-y-6 px-4 py-10 sm:px-5 sm:py-14">
      <section className="rounded-[30px] border border-sky-100 bg-white/90 p-8 text-center shadow-sm sm:p-10">
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-emerald-50 text-3xl">✓</div>
        <h1 className="mt-5 text-3xl font-black text-brand-950 sm:text-4xl">帖子已提交审核</h1>
        <p className="mt-4 text-base font-bold leading-7 text-slate-600">
          您的帖子已经提交审核。<br />
          审核通过后，帖子将在 E院广场 正常显示。<br />
          感谢您的分享。
        </p>
        <div className="mt-7 flex flex-col items-center gap-4">
          <button
            type="button"
            onClick={goBack}
            className="rounded-full bg-brand-700 px-7 py-3 text-sm font-black text-white transition hover:bg-brand-800"
          >
            返回帖子
          </button>
          <p className="text-sm font-bold text-slate-400">{count} 秒后自动返回帖子页面</p>
        </div>
      </section>
    </main>
  )
}

export default function PostSubmittedPage() {
  return (
    <Suspense
      fallback={
        <main className="site-page-main flat-page mx-auto max-w-2xl px-4 py-10 sm:px-5 sm:py-14" />
      }
    >
      <SubmittedContent />
    </Suspense>
  )
}
