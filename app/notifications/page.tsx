import Link from 'next/link'
import { redirect } from 'next/navigation'
import { SiteHeader } from '@/components/SiteHeader'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function NotificationsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  const notifications = await prisma.notification.findMany({
    where: { recipientId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 50,
    include: { actor: { select: { nickname: true, avatarUrl: true } } },
  })

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-4xl px-5 py-8">
        <section className="rounded-2xl border border-sky-100 bg-white/80 p-7 shadow-sm">
          <p className="text-sm font-black uppercase text-brand-700">Notification Center</p>
          <h1 className="mt-2 text-4xl font-black text-brand-950">通知中心</h1>
        </section>

        <section className="mt-6 space-y-3">
          {notifications.length ? (
            notifications.map((item) => (
              <Link
                key={item.id}
                href={item.link || '/notifications'}
                className="block rounded-2xl border border-sky-100 bg-white/80 p-5 shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-black text-slate-950">{item.title}</p>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{item.content}</p>
                  </div>
                  <span className={`rounded-full px-3 py-1 text-xs font-black ${item.isRead ? 'bg-slate-100 text-slate-500' : 'bg-sky-100 text-brand-700'}`}>
                    {item.isRead ? '已读' : '未读'}
                  </span>
                </div>
              </Link>
            ))
          ) : (
            <div className="rounded-2xl border border-sky-100 bg-white/80 p-8 text-center font-bold text-slate-500">
              暂时没有通知
            </div>
          )}
        </section>
      </main>
    </>
  )
}
