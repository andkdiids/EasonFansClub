import Link from 'next/link'
import { MusicArchiveShell } from '@/components/music/MusicArchiveShell'

// 演唱会详情「数据缺失」友好页：替代 Next.js 默认 404。
// 数据缺失（巡演/城市/单场未找到或草稿不可见）时渲染，而非抛出 404。
export function ConcertNotFound({
  backHref = '/music/live',
  backLabel = 'Eason in Concert',
}: {
  backHref?: string
  backLabel?: string
}) {
  return (
    <MusicArchiveShell maxWidth="max-w-6xl" backgroundVisual={null}>
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-6 py-8 text-center">
        <div className="flex h-20 w-20 items-center justify-center rounded-3xl border border-white/10 bg-white/[0.05] text-4xl">🎤</div>
        <div className="space-y-3">
          <h1 className="text-2xl font-black text-white sm:text-3xl">该演唱会资料正在整理中</h1>
          <p className="max-w-md text-sm font-bold leading-7 text-slate-300/65">我们正在努力补全这场演出的资料，请稍后再来看看。</p>
        </div>
        <Link
          href={backHref}
          className="border border-sky-200/20 bg-sky-200/[0.08] px-5 py-3 text-sm font-black text-sky-100 transition hover:border-sky-300/40 hover:bg-sky-200/[0.14]"
        >
          ← 返回 {backLabel}
        </Link>
      </div>
    </MusicArchiveShell>
  )
}
