import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { canAccessAnywhereDoor } from '@/lib/anywhere-door/access'
import { getPublicSocialPostDetail, getPublicSocialPostFeed } from '@/lib/social-posts'
import { AnywhereDoorDetail } from '@/components/anywhere-door/AnywhereDoorDetail'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function AnywhereDoorDetailPage({ params }: { params: Promise<{ postId: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=/anywhere-door')
  if (!(await canAccessAnywhereDoor(user))) notFound()
  const { postId } = await params
  const [post, related] = await Promise.all([
    getPublicSocialPostDetail(postId, user.id),
    getPublicSocialPostFeed({ viewerId: user.id, limit: 21 }),
  ])
  if (!post) notFound()
  const morePosts = related.items.filter((item) => item.id !== post.id)
  return <main className="mx-auto w-full max-w-[1280px] px-3 py-4 sm:px-5 sm:py-8 lg:px-6"><AnywhereDoorDetail post={post} morePosts={morePosts} /></main>
}
