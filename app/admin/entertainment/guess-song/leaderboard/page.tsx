import Link from 'next/link'
import { requireAdminPage } from '@/components/AdminAccess'

import { GuessSongLeaderboardManager } from '../GuessSongLeaderboardManager'

export const dynamic = 'force-dynamic'

export default async function AdminGuessSongLeaderboardPage() {
  await requireAdminPage('/admin/entertainment/guess-song/leaderboard', 'entertainment_manage')

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">听听后台</p>
          <h1 className="mt-2 text-3xl font-black text-brand-950">听听排行榜管理</h1>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">管理周榜、月榜、年榜的成绩补分、删除和操作记录。</p>
        </div>
        <Link href="/admin/entertainment/guess-song" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:border-brand-200 hover:text-brand-700">
          返回听听题库
        </Link>
      </div>
      <GuessSongLeaderboardManager />
    </main>
  )
}
