import { redirect } from 'next/navigation'
import { FeedbackCenter } from '@/app/feedback/FeedbackCenter'
import { getCurrentUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function FeedbackPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Ffeedback')

  return (
    <>
      <FeedbackCenter />
    </>
  )
}
