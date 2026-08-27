import { notFound, redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/auth'
import { canAccessAnywhereDoor } from '@/lib/anywhere-door/access'
import { getPublicSocialPostDetail } from '@/lib/social-posts'
import { AnywhereDoorDetail } from '@/components/anywhere-door/AnywhereDoorDetail'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export default async function AnywhereDoorDetailPage({ params }: { params: Promise<{ postId: string }> }) {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=/anywhere-door')
  if (!(await canAccessAnywhereDoor(user))) notFound()
  const { postId } = await params
  const post = await getPublicSocialPostDetail(postId, user.id)
  if (!post) notFound()
  return <main className="mx-auto w-full max-w-2xl px-4 py-5 sm:px-5 sm:py-8"><AnywhereDoorDetail post={post} /></main>
}
