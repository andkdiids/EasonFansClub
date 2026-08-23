import { BadgeCenterTabs } from '@/components/BadgeCenterTabs'

export default function BadgeMuseumLoading() {
  return <main className="mx-auto w-full max-w-6xl px-3 py-5 sm:px-5 sm:py-8"><div className="badge-center-page" aria-label="正在打开勋章展览馆"><div className="badge-center-heading"><div><div className="h-8 w-40 animate-pulse rounded bg-slate-200" /><div className="mt-3 h-4 w-72 max-w-full animate-pulse rounded bg-slate-200" /></div><div className="h-12 w-28 animate-pulse rounded bg-slate-200" /></div><BadgeCenterTabs active="all" /><div className="badge-museum-cabinet mt-5 h-64 animate-pulse" /></div></main>
}
