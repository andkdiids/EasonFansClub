import { redirect } from 'next/navigation'
import { FeedbackCenter } from '@/app/feedback/FeedbackCenter'
import { getCurrentUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function FeedbackDetailPage({ params, searchParams }: { params: Promise<{ feedbackId: string }>; searchParams: Promise<{ focus?: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Ffeedback')
  const { feedbackId } = await params
  const focusId = (await searchParams).focus?.slice(0, 80)

  return (
    <>
      <FeedbackCenter initialFeedbackId={feedbackId} initialFocusId={focusId} />
    </>
  )
}
