import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ActivityRegistrationCheckinPage } from '@/components/activities/ActivityRegistrationCheckinPage'
import { ActivityRedemptionError, getActivityRedemptionLookupByToken } from '@/lib/activity-redemption'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { getCurrentUser } from '@/lib/auth'
import { activityVerificationTokenFromInput } from '@/lib/activity-registration'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function Notice({ title, description }: Readonly<{ title: string; description: string }>) {
  return <main className="mx-auto flex min-h-[70vh] w-full max-w-xl items-center px-4 py-8 sm:px-5"><section className="w-full border border-[var(--border)] bg-[var(--surface-elevated)] p-6 text-center text-[var(--foreground)] shadow-sm sm:p-9"><p className="text-xs font-black tracking-[0.18em] text-[var(--primary)]">活动核销</p><h1 className="mt-3 text-2xl font-black">{title}</h1><p className="mt-3 text-sm font-bold leading-7 text-[var(--foreground-muted)]">{description}</p><Link href="/" className="mt-6 inline-flex min-h-11 items-center justify-center border border-[var(--border)] px-5 py-2 text-sm font-black text-[var(--primary)]">返回首页</Link></section></main>
}

function errorNotice(error: ActivityRedemptionError) {
  if (error.code === 'ACTIVITY_CANCELLED') return <Notice title="活动已取消" description="该活动已取消，无法核销。" />
  if (error.code === 'REGISTRATION_CANCELLED') return <Notice title="报名已取消" description="该报名已经取消，无法核销。" />
  if (error.code === 'INVALID_TOKEN' || error.code === 'REGISTRATION_NOT_FOUND') return <Notice title="二维码无效" description="找不到对应的活动报名记录，请让工作人员重新确认二维码。" />
  return <Notice title="扫码查询失败" description="暂时无法读取这条报名记录，请稍后重试或联系活动工作人员。" />
}

export default async function ActivityCheckinPage({ params }: Readonly<{ params: Promise<{ token: string }> }>) {
  const { token: rawToken } = await params
  const token = activityVerificationTokenFromInput(rawToken)
  if (!token) return <Notice title="二维码无效" description="活动核销二维码缺少有效令牌。" />

  const returnPath = `/activities/checkin/${encodeURIComponent(token)}`
  const user = await getCurrentUser()
  if (!user) redirect(`/login?redirect=${encodeURIComponent(returnPath)}`)
  if (!(await hasAdminPermission(user, 'activity_manage'))) {
    return <Notice title="无核销权限" description="该二维码仅供活动工作人员核销使用。当前账号没有活动核销权限。" />
  }

  try {
    const lookup = await getActivityRedemptionLookupByToken(token)
    return <ActivityRegistrationCheckinPage token={token} initialLookup={lookup} />
  } catch (error) {
    if (error instanceof ActivityRedemptionError) return errorNotice(error)
    console.error('[activities.checkin.page]', { error: error instanceof Error ? error.message : error })
    return <Notice title="扫码查询失败" description="暂时无法读取这条报名记录，请稍后重试或联系活动工作人员。" />
  }
}
