import { requireAdminPage } from '@/components/AdminAccess'
import { BadgeAdminManager, type AdminBadge } from './BadgeAdminManager'
import { listBadgesForAdmin } from '@/lib/badge-service'
import { toPublicMediaUrl } from '@/lib/media-url'
import { getBadgeAvailability, getBadgeOwnershipStats } from '@/lib/badge-phase2'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function AdminBadgesPage() {
  await requireAdminPage('/admin/badges', 'achievement_manage')
  const badges = await listBadgesForAdmin()
  const ownershipStats = await getBadgeOwnershipStats(badges.map((badge) => badge.id))
  const initialBadges: AdminBadge[] = badges.map((badge) => ({
    id: badge.id,
    name: badge.name,
    code: badge.code,
    slug: badge.slug,
    description: badge.description,
    acquisitionDescription: badge.acquisitionDescription,
    acquisitionDescriptionCustomized: badge.acquisitionDescriptionCustomized,
    rule: badge.BadgeRule ? {
      id: badge.BadgeRule.id,
      ruleType: badge.BadgeRule.ruleType,
      operator: badge.BadgeRule.operator,
      threshold: badge.BadgeRule.threshold,
      secondaryThreshold: badge.BadgeRule.secondaryThreshold,
      configJson: badge.BadgeRule.configJson,
      isEnabled: badge.BadgeRule.isEnabled,
    } : null,
    iconUrl: toPublicMediaUrl(badge.iconUrl),
    category: badge.category,
    visibility: badge.visibility,
    rarity: badge.rarity,
    grantType: badge.grantType,
    isWearable: badge.isWearable,
    isEnabled: badge.isEnabled && badge.isActive,
    effectType: badge.effectType,
    nicknameEffect: badge.nicknameEffect,
    nicknameColor: badge.nicknameColor,
    nicknameGradientStart: badge.nicknameGradientStart,
    nicknameGradientEnd: badge.nicknameGradientEnd,
    sortOrder: badge.sortOrder,
    ownerCount: badge._count.UserBadge,
    ownershipStats: ownershipStats.get(badge.id) || null,
    announceOnGrant: badge.announceOnGrant,
    countsTowardSeriesCompletion: badge.countsTowardSeriesCompletion,
    seriesId: badge.seriesId,
    series: badge.Series ? { ...badge.Series } : null,
    tierGroupCode: badge.tierGroupCode,
    tierLevel: badge.tierLevel,
    availableFrom: badge.availableFrom?.toISOString() || null,
    availableUntil: badge.availableUntil?.toISOString() || null,
    availabilityStatus: getBadgeAvailability(badge),
    createdAt: badge.createdAt.toISOString(),
  }))
  return (
    <main className="mx-auto max-w-7xl space-y-5 px-4 py-6 sm:px-5 sm:py-8">
      <header className="rounded-[28px] border border-sky-100 bg-white/85 p-6 shadow-sm sm:p-8">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-700">Badge / Honor</p>
        <h1 className="mt-2 text-3xl font-black text-brand-950">E院勋章管理</h1>
        <p className="mt-3 max-w-3xl text-sm font-bold leading-7 text-slate-600">维护勋章图鉴、PNG 资源、可见性、昵称效果、发放记录和佩戴规则。已有用户获得的勋章不会被硬删除。</p>
        <Link href="/admin/badges/analytics" className="mt-4 inline-flex rounded-full bg-sky-50 px-4 py-2 text-xs font-black text-brand-700">查看勋章数据看板</Link>
      </header>
      <BadgeAdminManager initialBadges={initialBadges} />
    </main>
  )
}
