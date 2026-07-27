import { redirect } from 'next/navigation'
import AchievementList from '@/components/achievements/AchievementList'
import { getCurrentUser } from '@/lib/auth'
import { safeDb } from '@/lib/db-timeout'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function AchievementsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fachievements')

  const records = await safeDb(
    'achievements.read',
    prisma.userAchievement.findMany({
where: {
  userId: user.id,
  Achievement: {
    isVisible: true
  }
}      include: {
  Achievement: true
},
      orderBy: [{ unlockedAt: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    }),
    [],
  )

  return (
    <AchievementList records={records} />
  )
}