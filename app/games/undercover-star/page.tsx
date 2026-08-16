import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { UndercoverStarClient } from './UndercoverStarClient'

export const dynamic = 'force-dynamic'

export default async function UndercoverStarPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fgames%2Fundercover-star')
  return <UndercoverStarClient />
}
