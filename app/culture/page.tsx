import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function CulturePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fculture')
  redirect('/music')
}
