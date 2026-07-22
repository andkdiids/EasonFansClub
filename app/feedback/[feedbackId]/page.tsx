import { redirect } from 'next/navigation'
import { FeedbackCenter } from '@/app/feedback/FeedbackCenter'
import { getCurrentUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function FeedbackDetailPage({ params }: { params: Promise<{ feedbackId: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Ffeedback')
  const { feedbackId } = await params

  return (
    <>
      <FeedbackCenter initialFeedbackId={feedbackId} />
    </>
  )
}
