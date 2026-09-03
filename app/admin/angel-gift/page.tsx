import { requireAdminPage } from '@/components/AdminAccess'
import { AngelGiftAdminManager, type AngelGiftCampaignSummary } from './AngelGiftAdminManager'
import { getAdminPharmacyCampaigns } from '@/lib/pharmacy'

export const dynamic = 'force-dynamic'

export default async function AdminAngelGiftPage() {
  await requireAdminPage('/admin/angel-gift', 'angel_gift_manage')
  const campaigns = await getAdminPharmacyCampaigns()
  const initialCampaigns: AngelGiftCampaignSummary[] = campaigns.map((campaign) => ({
    id: campaign.id,
    title: campaign.title,
    subtitle: campaign.subtitle,
    status: campaign.status,
    displayStatus: campaign.displayStatus,
    startsAt: campaign.startsAt?.toISOString() || null,
    endsAt: campaign.endsAt?.toISOString() || null,
    drawCost: campaign.drawCost,
    duplicateRecycleEnabled: campaign.duplicateRecycleEnabled,
    duplicateRecycleRequired: campaign.duplicateRecycleRequired,
    duplicateRecycleReward: campaign.duplicateRecycleReward,
    probabilityPublic: campaign.probabilityPublic,
    dailyDrawLimit: campaign.dailyDrawLimit,
    totalDrawLimit: campaign.totalDrawLimit,
    prizeCount: campaign._count.PharmacyPrize,
    drawCount: campaign._count.PharmacyDraw,
    participantCount: campaign.participantCount,
    drawCostTotal: campaign.drawCostTotal,
    createdAt: campaign.createdAt.toISOString(),
    updatedAt: campaign.updatedAt.toISOString(),
  }))
  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-5 sm:py-8">
      <header className="rounded-[20px] border border-red-100 bg-white/90 p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900/90 sm:p-8">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-amber-700 dark:text-amber-300">E院药房 / Angel&apos;s Gift</p>
        <h1 className="mt-2 text-3xl font-black text-brand-950 dark:text-slate-100 sm:text-4xl">天使的礼物</h1>
        <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-600 dark:text-slate-300">这里管理长期复用的主题、奖池、执药价格、余药回收和统计。功能名称固定为「天使的礼物」，每一期只配置自己的主题名称。</p>
      </header>
      <AngelGiftAdminManager initialCampaigns={initialCampaigns} />
    </main>
  )
}

