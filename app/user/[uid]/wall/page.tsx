import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ProfileWall } from '@/components/ProfileWall'
import { BackButton } from '@/components/BackButton'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { formatUid, parseUidParam } from '@/lib/uid'

export const dynamic = 'force-dynamic'

export default async function ProfileWallPage({ params, searchParams }: { params: Promise<{ uid: string }>; searchParams: Promise<{ focus?: string }> }) {
  const { uid } = await params
  const numericUid = parseUidParam(uid)
  const focusId = (await searchParams).focus?.slice(0, 80)
  if (!numericUid || numericUid <= 0) notFound()
  const [viewer, target] = await Promise.all([
    getCurrentUser(),
    prisma.user.findFirst({
      where: { uid: numericUid, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
      select: { uid: true, nickname: true, Profile: { select: { displayName: true } } },
    }),
  ])
  if (!target) notFound()
  const name = target.Profile?.displayName || target.nickname

  return (
    <>
      <main className="mx-auto max-w-4xl space-y-4 px-4 py-6 sm:px-5">
        <BackButton fallbackHref={viewer?.uid === target.uid ? '/profile' : `/user/${formatUid(target.uid)}`} />
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border border-sky-100 bg-white/85 p-5 shadow-sm">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-brand-700">Profile Wall</p>
            <h1 className="mt-1 text-2xl font-black text-brand-950">给 {name} 留言</h1>
          </div>
          <Link href={viewer?.uid === target.uid ? '/profile' : `/user/${formatUid(target.uid)}`} className="rounded-full bg-sky-50 px-4 py-2 text-sm font-black text-brand-700">返回主页</Link>
        </div>
        <ProfileWall receiverUid={target.uid} focusId={focusId} />
      </main>
    </>
  )
}
