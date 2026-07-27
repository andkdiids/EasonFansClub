import { redirect } from 'next/navigation'
import { FeedbackCenter } from '@/app/feedback/FeedbackCenter'
import { getCurrentUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function FeedbackPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Ffeedback')

  return (
    <>
      <FeedbackCenter initialTab={(await searchParams).tab === 'updates' ? 'changelog' : 'feedback'} />
    </>
  )
}
