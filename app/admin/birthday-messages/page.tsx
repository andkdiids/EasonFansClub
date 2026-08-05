import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'
import { prisma } from '@/lib/prisma'
import { BirthdayMessageManager } from './BirthdayMessageManager'

export const dynamic = 'force-dynamic'

export default async function BirthdayMessagesAdminPage() {
  const user = await requireAdminPage('/admin/birthday-messages', 'birthday_messages_manage')
  const messages = await prisma.birthdayMessage.findMany({
    orderBy: [{ createdAt: 'desc' }, { updatedAt: 'desc' }],
    take: 500,
    select: { id: true, title: true, content: true, isActive: true, createdAt: true, updatedAt: true },
  })
  const initialMessages = messages.map((message) => ({
    id: message.id,
    title: message.title,
    content: message.content,
    isActive: message.isActive,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
  }))
  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto max-w-5xl px-5 py-8">
        <BirthdayMessageManager initialMessages={initialMessages} />
      </main>
    </>
  )
}
