import { redirect } from 'next/navigation'
import { activityVerificationTokenFromInput } from '@/lib/activity-registration'

export const dynamic = 'force-dynamic'
export const revalidate = 0

/** Compatibility entry for QR codes generated before the public scan page existed. */
export default async function LegacyActivityVerifyPage({ searchParams }: Readonly<{ searchParams: Promise<{ token?: string }> }>) {
  const params = await searchParams
  const token = activityVerificationTokenFromInput(params.token || '')
  if (!token) redirect('/activities/checkin/invalid')
  redirect(`/activities/checkin/${encodeURIComponent(token)}`)
}
