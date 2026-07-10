import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { formatUid } from '@/lib/uid'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ userId: string }> }

export default async function LegacyUserPage({ params }: PageProps) {
  const { userId } = await params
  const user = await prisma.user.findFirst({
    where: {
      id: userId,
      status: 'ACTIVE',
      isDeleted: false,
      profile: { isNot: null },
    },
    select: { uid: true },
  })

  if (!user) notFound()
  redirect(`/user/${formatUid(user.uid)}`)
}
