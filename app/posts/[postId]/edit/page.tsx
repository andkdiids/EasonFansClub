import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { BackButton } from '@/components/BackButton'
import { PostEditForm, type ExistingMedia } from '@/components/PostEditForm'
import { getCurrentUser } from '@/lib/auth'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { publicContentImageMarkers } from '@/lib/content-images'
import { isSupabaseStorageUrl, publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export default async function EditPostPage({ params }: Readonly<{ params: Promise<{ postId: string }> }>) {
  const { postId } = await params
  const user = await getCurrentUser()
  if (!user) redirect(`/login?redirect=${encodeURIComponent(`/posts/${postId}/edit`)}`)

  const post = await prisma.post.findFirst({
    where: { id: postId, isDeleted: false },
    select: {
      id: true,
      title: true,
      content: true,
      authorId: true,
      boardId: true,
      Board: { select: { id: true, name: true, slug: true } },
      PostMedia: {
        where: { type: 'IMAGE' },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, url: true },
      },
    },
  })

  if (!post) notFound()

  const isOwner = post.authorId === user.id
  const canManagePosts = await hasAdminPermission(user, 'post_manage')
  if (!isOwner && !canManagePosts) {
    return (
      <main className="site-page-main flat-page mx-auto max-w-3xl px-5 py-10">
        <BackButton fallbackHref={`/posts/${postId}`} />
        <section className="mt-6 rounded-2xl border border-sky-100 bg-white/85 p-8 text-center shadow-sm">
          <p className="text-sm font-black uppercase tracking-[0.18em] text-brand-700">Forbidden</p>
          <h1 className="mt-3 text-2xl font-black text-brand-950">无权编辑该帖子</h1>
          <p className="mt-3 text-sm font-bold leading-7 text-slate-500">只有作者或管理员可以编辑这条帖子。</p>
          <Link href={`/posts/${postId}`} className="mt-6 inline-flex min-h-11 items-center rounded-full bg-brand-700 px-5 text-sm font-black text-white">
            返回帖子
          </Link>
        </section>
      </main>
    )
  }

  const initialMedia: ExistingMedia[] = post.PostMedia.map((media) => ({
    id: media.id,
    url: publicImageUrl(media.url) || media.url,
    broken: isSupabaseStorageUrl(media.url),
  }))
  const boards = await prisma.board.findMany({
    where: { OR: [{ isActive: true }, { id: post.boardId }] },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, name: true, slug: true },
  })

  return (
    <main className="site-page-main flat-page mx-auto max-w-3xl px-5 py-10">
      <BackButton fallbackHref={`/posts/${postId}`} />
      <div className="mt-6">
        <PostEditForm
          postId={post.id}
          initialTitle={post.title}
          initialContent={publicContentImageMarkers(post.content)}
          initialBoardId={post.boardId}
          boards={boards}
          initialMedia={initialMedia}
        />
      </div>
    </main>
  )
}
