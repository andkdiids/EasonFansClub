import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ActivityCheckinScannerPage } from '@/components/activities/ActivityCheckinScannerPage'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { getCurrentUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function Notice({ title, description }: Readonly<{ title: string; description: string }>) {
  return <main className="mx-auto flex min-h-[70vh] w-full max-w-xl items-center px-4 py-8 sm:px-5"><section className="w-full border border-[var(--border)] bg-[var(--surface-elevated)] p-6 text-center text-[var(--foreground)] shadow-sm sm:p-9"><p className="text-xs font-black tracking-[0.18em] text-[var(--primary)]">活动核销</p><h1 className="mt-3 text-2xl font-black">{title}</h1><p className="mt-3 text-sm font-bold leading-7 text-[var(--foreground-muted)]">{description}</p><Link href="/activities" className="mt-6 inline-flex min-h-11 items-center justify-center border border-[var(--border)] px-5 py-2 text-sm font-black text-[var(--primary)]">返回活动中心</Link></section></main>
}

export default async function ActivityCheckinScannerRoute({ searchParams }: Readonly<{ searchParams: Promise<{ scan?: string | string[] }> }>) {
  const user = await getCurrentUser()
  if (!user) redirect(`/login?redirect=${encodeURIComponent('/activities/checkin')}`)
  if (!(await hasAdminPermission(user, 'activity_manage').catch(() => false))) {
    return <Notice title="无核销权限" description="该页面仅供活动工作人员使用。当前账号没有活动核销权限。" />
  }
  const params = await searchParams
  return <ActivityCheckinScannerPage autoStart={params.scan === '1'} />
}
