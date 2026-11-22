import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAdminPage } from '@/components/AdminAccess'
import { AnnualMemoirEditor } from '@/components/activities/AnnualMemoirEditor'
import { activitySelect, serializeActivityRow } from '@/lib/activity-data'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function EditAnnualMemoir({ params, searchParams }: {
  params: Promise<{ activityId: string }>
  searchParams: Promise<{ created?: string }>
}) {
  const { activityId } = await params
  await requireAdminPage('/admin/activities/' + encodeURIComponent(activityId) + '/annual-memoir-edit', 'activity_manage')
  const [activity, badges] = await Promise.all([
    prisma.activity.findFirst({ where: { id: activityId, type: 'TOPIC_ACTIVITY', annualMemoirConfig: { isNot: null } }, select: activitySelect }),
    prisma.badge.findMany({ where: { isActive: true, isEnabled: true }, orderBy: { name: 'asc' }, select: { id: true, name: true } }),
  ])
  if (!activity) notFound()
  return <main className="mx-auto max-w-5xl space-y-4 px-4 py-6">
    <Link className="underline" href="/admin/activities?drafts=1#activity-list">返回活动草稿列表</Link>
    <h1 className="text-2xl font-bold">编辑年度活动</h1>
    {(await searchParams).created === '1' && <p role="status" className="rounded bg-emerald-50 p-3 text-emerald-900">年度活动草稿创建成功</p>}
    <AnnualMemoirEditor activity={serializeActivityRow(activity, new Date(), true)} badges={badges} />
  </main>
}
