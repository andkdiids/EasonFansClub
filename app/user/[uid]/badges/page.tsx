import { notFound } from 'next/navigation'
import { BadgeCollectionPanel } from '@/components/BadgeCollectionPanel'
import { UserDisplayName } from '@/components/UserDisplayName'
import { getCurrentUser } from '@/lib/auth'
import { getEquippedBadgeForUser } from '@/lib/badge-service'
import { getPublicUserDisplayName } from '@/lib/friend-remarks'
import { parseUidParam } from '@/lib/uid'
import { prisma } from '@/lib/prisma'
import { getProfileVisibility } from '@/lib/user-privacy'

export const dynamic = 'force-dynamic'

type PageProps = { params: Promise<{ uid: string }> }

export default async function UserBadgesPage({ params }: PageProps) {
  const { uid: rawUid } = await params
  const uid = parseUidParam(rawUid)
  if (uid === null || uid <= 0) notFound()
  const [viewer, target] = await Promise.all([
    getCurrentUser(),
    prisma.user.findFirst({ where: { uid, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } }, select: { id: true, uid: true, nickname: true, nicknameModerationStatus: true, nicknameViolationDisplay: true, Profile: { select: { displayName: true } } } }),
  ])
  if (!target) notFound()
  const visibility = await getProfileVisibility(target.id, viewer?.id)
  if (!visibility.isSelf && !visibility.settings.showBadgeHistory) notFound()
  const equippedBadge = await getEquippedBadgeForUser(target.id)

  return (
    <main className="site-page-main flat-page mx-auto max-w-5xl space-y-4 px-4 py-5 sm:px-5 sm:py-7">
      <header className="rounded-2xl border border-sky-100 bg-white/85 p-5 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-700">E院荣誉档案</p>
        <h1 className="mt-2 text-2xl font-black text-brand-950"><UserDisplayName name={getPublicUserDisplayName(target)} uid={target.uid} badge={equippedBadge} showBadgeName /> 的勋章</h1>
        <p className="mt-2 text-sm font-bold leading-6 text-slate-500">记录每一段值得纪念的 E院足迹。</p>
      </header>
      <BadgeCollectionPanel uid={String(target.uid).padStart(5, '0')} isSelf={viewer?.id === target.id} previewOnly={false} />
    </main>
  )
}
