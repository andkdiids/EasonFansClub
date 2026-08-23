'use client'

export default function BadgeMuseumError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="mx-auto w-full max-w-4xl px-4 py-10"><section className="badge-museum-empty"><span className="badge-museum-empty-mark">✦</span><strong>展览馆暂时无法开放</strong><span>藏品数据正在整理，请稍后重试。</span><button type="button" onClick={() => reset()} className="mt-2 rounded-full bg-brand-950 px-4 py-2 text-xs font-black text-white">重试</button></section></main>
}
