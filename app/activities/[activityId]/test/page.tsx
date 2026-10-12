import { TopicActivityV2TestRunner } from '@/components/activities/TopicActivityV2Interactive'
import { getCurrentUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function ActivityTestPage({ params }: Readonly<{ params: Promise<{ activityId: string }> }>) {
  const { activityId } = await params
  const viewer = await getCurrentUser()
  return <TopicActivityV2TestRunner activityId={activityId} isAuthenticated={Boolean(viewer)} />
}
