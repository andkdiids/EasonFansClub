import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { parseUidParam } from '@/lib/uid'
import { BadgeSeriesDetail } from '@/components/BadgeSeriesDetail'

export const dynamic = 'force-dynamic'
type PageProps = { params: Promise<{ seriesId: string }>; searchParams?: Promise<{ user?: string }> }

export default async function BadgeSeriesPage({ params, searchParams }: PageProps) {
  const { seriesId } = await params
  const query = await searchParams
  const viewer = await getCurrentUser()
  const requestedUid = query?.user
  let targetId = viewer?.id || null
  let targetUid = viewer?.uid || null
  if (requestedUid) {
    const uid = parseUidParam(requestedUid)
    if (uid === null || uid <= 0) notFound()
    const target = await prisma.user.findFirst({ where: { uid, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } }, select: { id: true, uid: true } })
    if (!target) notFound()
    targetId = target.id
    targetUid = target.uid
  }
  if (!targetId) notFound()
  const series = await prisma.badgeSeries.findUnique({ where: { id: seriesId }, select: { id: true, name: true } })
  if (!series) notFound()
  return <main className="site-page-main flat-page mx-auto max-w-5xl space-y-4 px-4 py-5 sm:px-5 sm:py-7"><Link href={targetUid ? `/user/${String(targetUid).padStart(5, '0')}/badges` : '/profile'} className="text-sm font-black text-brand-700">← 返回勋章墙</Link><BadgeSeriesDetail seriesId={seriesId} userUid={targetUid ? String(targetUid).padStart(5, '0') : undefined} isSelf={targetId === viewer?.id} /></main>
}
