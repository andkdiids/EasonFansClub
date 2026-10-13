import { TopicActivityV2LotteryClaim } from '@/components/activities/TopicActivityV2LotteryClaim'

export const dynamic = 'force-dynamic'

export default async function TopicActivityV2LotteryClaimPage({ params }: Readonly<{ params: Promise<{ activityId: string; winnerId: string }> }>) {
  const { activityId, winnerId } = await params
  return <TopicActivityV2LotteryClaim activityId={activityId} winnerId={winnerId} />
}
