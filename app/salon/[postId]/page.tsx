import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { getCurrentUser } from '@/lib/auth'
import { buildPageMetadata } from '@/lib/share-metadata'
import { getSalonComments, getSalonPostForViewer } from '@/lib/salon'
import { SalonDetail } from '@/components/salon/SalonDetail'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ postId: string }> }): Promise<Metadata> {
  return buildPageMetadata({ title: '沙龙作品', description: '查看沙龙作品与现场记录。', canonical: `/salon/${(await params).postId}` })
}

export default async function SalonDetailPage({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params
  const user = await getCurrentUser()
  const canModerate = Boolean(user && await hasAdminPermission(user, 'post_manage').catch(() => false))
  const post = await getSalonPostForViewer(postId, user?.id, canModerate)
  if (!post) notFound()
  const comments = await getSalonComments(postId)
  return <SalonDetail post={post} initialComments={comments.comments} initialCommentsHasMore={comments.hasMore} initialCommentsNextCursor={comments.nextCursor} currentUserId={user?.id || null} canModerate={canModerate} />
}
