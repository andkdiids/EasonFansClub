import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { WantListenHome } from './WantListenHome'

export const dynamic = 'force-dynamic'

export default async function WantListenPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fgames%2Fwant-listen')
  return <WantListenHome />
}
