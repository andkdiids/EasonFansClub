'use client'

function reloadPage() {
  window.location.reload()
}

function goHome() {
  window.location.href = '/'
}

export default function PublicUserError() {
  return (
    <main className="mx-auto max-w-4xl px-5 py-10">
      <section className="rounded-[28px] border border-sky-100 bg-white/85 p-8 text-center shadow-sm">
        <h1 className="text-2xl font-black text-brand-950">个人主页暂时无法加载</h1>
        <p className="mt-3 text-sm font-bold text-slate-500">帖子、成就、收藏等模块暂时不可用，稍后重试即可。</p>
        <div className="mt-6 flex justify-center gap-3">
          <button onClick={reloadPage} className="rounded-full bg-brand-950 px-5 py-3 text-sm font-black text-white">
            重试
          </button>
          <button onClick={goHome} className="rounded-full bg-sky-50 px-5 py-3 text-sm font-black text-brand-700">
            返回首页
          </button>
        </div>
      </section>
    </main>
  )
}
