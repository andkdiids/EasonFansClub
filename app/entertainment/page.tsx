import { redirect } from 'next/navigation'
import { PageContainer } from '@/components/PageContainer'
import { getCurrentUser } from '@/lib/auth'
import { EntertainmentCenter } from './EntertainmentCenter'

export const dynamic = 'force-dynamic'

export default async function EntertainmentPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fentertainment')

  return (
    <PageContainer className="entertainment-page">
      <EntertainmentCenter />
    </PageContainer>
  )
}
