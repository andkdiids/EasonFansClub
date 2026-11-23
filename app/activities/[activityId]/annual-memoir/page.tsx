import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { readMemoir } from '@/lib/annual-memoir-report'
import type { MemoirAlbum } from '@/lib/annual-memoir-art'
import { MemoirReader } from './MemoirReader'

export default async function Page({ params }: { params: Promise<{ activityId: string }> }) {
  const { activityId } = await params
  const activityUrl = '/activities/' + encodeURIComponent(activityId)
  const user = await getCurrentUser()
  if (!user) redirect('/login?next=' + encodeURIComponent(activityUrl))
  const snapshot = await readMemoir(activityId, user.id)
  if (!snapshot) redirect(activityUrl)
  return <MemoirReader activityId={activityId} year={snapshot.year} initialReport={snapshot.payload as unknown as MemoirAlbum} />
}
