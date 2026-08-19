import Link from 'next/link'
import { requireAdminPage } from '@/components/AdminAccess'
import { WantListenLeaderboardManager } from './WantListenLeaderboardManager'

export const dynamic = 'force-dynamic'

export default async function AdminWantListenLeaderboardPage() {
  await requireAdminPage('/admin/entertainment/want-listen/leaderboard', 'entertainment_manage')
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">娱乐天空后台</p>
          <h1 className="mt-2 text-3xl font-black text-brand-950">想听排行榜管理</h1>
          <p className="mt-2 text-sm text-brand-600">查看想听 / 粤语残片 / 防不胜防排行榜，可清除全部、按模式或按用户清除成绩。</p>
        </div>
        <Link
          href="/admin/entertainment/want-listen"
          className="rounded-lg border border-brand-200 bg-white px-3 py-2 text-sm font-bold text-brand-700 shadow-sm transition hover:border-brand-300 hover:bg-brand-50"
        >
          返回想听管理
        </Link>
      </div>
      <WantListenLeaderboardManager />
    </main>
  )
}
