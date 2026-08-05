import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'
import { prisma } from '@/lib/prisma'
import { RegistrationMessageManager } from './RegistrationMessageManager'

export const dynamic = 'force-dynamic'

export type RegistrationMessageRow = {
  id: string
  content: string
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  isAdminMessage: boolean
  sort: number
  isDeleted: boolean
  createdAt: string
  user: { id: string; nickname: string; uid: number }
}

export default async function AdminRegistrationMessagesPage() {
  await requireAdminPage('/admin/registration-messages', 'daily_message_manage')

  const rawMessages = await prisma.dailyMessage.findMany({
    orderBy: [{ date: 'desc' }, { isAdminMessage: 'desc' }, { sort: 'asc' }, { createdAt: 'desc' }],
    select: {
      id: true,
      content: true,
      moderationStatus: true,
      isAdminMessage: true,
      sort: true,
      isDeleted: true,
      createdAt: true,
      User: { select: { id: true, nickname: true, uid: true } },
    },
  })

  const initialMessages: RegistrationMessageRow[] = rawMessages.map((message) => ({
    id: message.id,
    content: message.content,
    status: message.moderationStatus,
    isAdminMessage: message.isAdminMessage,
    sort: message.sort,
    isDeleted: message.isDeleted,
    createdAt: message.createdAt.toISOString(),
    user: message.User,
  }))

  return (
    <>
      <SiteHeader />
      <main className="admin-mobile-page mx-auto max-w-6xl space-y-7 px-4 py-7 sm:px-5 sm:py-9">
        <section className="rounded-[32px] border border-sky-100 bg-white/90 p-7 shadow-sm sm:p-9">
          <p className="text-sm font-black tracking-[0.2em] text-brand-700">挂号页 · 留言管理</p>
          <h1 className="mt-2 text-4xl font-black text-brand-950">挂号页留言管理</h1>
          <p className="mt-4 max-w-3xl text-sm font-bold leading-7 text-slate-600">
            查看、删除用户挂号页留言，并发布管理员公告与活动提醒。管理员留言会在挂号页优先展示。
          </p>
        </section>
        <RegistrationMessageManager initialMessages={initialMessages} />
      </main>
    </>
  )
}
