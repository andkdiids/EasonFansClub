import { requireAdminPage } from '@/components/AdminAccess'
import { SiteHeader } from '@/components/SiteHeader'
import { dailyExpLimit, defaultGrowthLevels, normalizeGrowthLevels } from '@/lib/growth'
import { prisma } from '@/lib/prisma'
import { GrowthSettingsPanel } from './GrowthSettingsPanel'

export const dynamic = 'force-dynamic'

export default async function AdminGrowthPage() {
  const user = await requireAdminPage('/admin/growth', 'growth_manage')
  const [levels, taskCount] = await Promise.all([
    prisma.growthLevelConfig.findMany({
      orderBy: { level: 'asc' },
      select: { level: true, name: true, requiredExp: true },
    }),
    prisma.task.count().catch(() => 0),
  ])

  return (
    <>
      <SiteHeader user={user} />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-5 sm:py-8">
        <GrowthSettingsPanel
          initialLevels={normalizeGrowthLevels(levels.length ? levels : [...defaultGrowthLevels])}
          dailyExpLimit={dailyExpLimit}
          taskCount={taskCount}
        />
      </main>
    </>
  )
}
