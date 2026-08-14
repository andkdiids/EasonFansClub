import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { getRegistrationFeeHistory, REGISTRATION_FEE_HISTORY_PAGE_SIZE } from '@/lib/registration-fee'
import { RegistrationFeeHistoryClient } from './RegistrationFeeHistoryClient'

export const dynamic = 'force-dynamic'

export default async function RegistrationFeeHistoryPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fregistration-fee')
  const data = await getRegistrationFeeHistory(user.id, { page: 1, pageSize: REGISTRATION_FEE_HISTORY_PAGE_SIZE })

  return (
    <main className="site-page-main flat-page mx-auto max-w-4xl px-4 py-6 sm:px-5 sm:py-8">
      <RegistrationFeeHistoryClient initialData={data} />
    </main>
  )
}
