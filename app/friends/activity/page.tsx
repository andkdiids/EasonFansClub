import Link from 'next/link'
import { redirect } from 'next/navigation'
import { FriendActivityPanel } from '@/components/FriendActivityPanel'
import { getCurrentUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function FriendActivityPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  return (
    <main className="site-page-main flat-page mx-auto max-w-4xl space-y-6 px-5 py-8">
      <section className="border border-sky-100 bg-white/85 p-6 shadow-sm">
        <Link href="/friends" className="text-sm font-black text-brand-700">← 返回好友中心</Link>
        <p className="mt-5 text-sm font-black uppercase tracking-[0.22em] text-brand-700">Friends Activity</p>
        <h1 className="mt-2 text-4xl font-black text-brand-950">全部好友动态</h1>
        <p className="mt-3 text-sm font-bold text-slate-500">按日期与类型筛选好友的挂号和发帖记录，互动请前往原内容页面。</p>
      </section>
      <FriendActivityPanel />
    </main>
  )
}
