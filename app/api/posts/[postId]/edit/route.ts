import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { publicContentImageMarkers } from '@/lib/content-images'
import { requireUser } from '@/lib/security'
import { hasAdminPermission } from '@/lib/admin-permissions'
import { isSupabaseStorageUrl, publicImageUrl } from '@/lib/images'

type Params = { params: Promise<{ postId: string }> }

// 返回帖子可编辑字段 + 媒体（含「是否已失效」标记）+ 当前用户是否可编辑。
export async function GET(_request: Request, { params }: Params) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { postId } = await params
  const post = await prisma.post.findFirst({
    where: { id: postId, isDeleted: false },
    select: {
      id: true,
      title: true,
      content: true,
      boardId: true,
      authorId: true,
      moderationStatus: true,
      status: true,
      PostMedia: {
        where: { type: 'IMAGE' },
        orderBy: { sortOrder: 'asc' },
        select: { id: true, url: true, sortOrder: true },
      },
    },
  })

  if (!post) {
    return NextResponse.json({ message: '帖子不存在' }, { status: 404 })
  }

  const isOwner = post.authorId === guard.user.id
  const canEdit = isOwner || await hasAdminPermission(guard.user, 'post_manage')
  if (!canEdit) {
    return NextResponse.json({ message: '只有作者或管理员可以编辑该帖子', canEdit: false }, { status: 403 })
  }

  return NextResponse.json({
    canEdit: true,
    post: {
      id: post.id,
      title: post.title,
      content: publicContentImageMarkers(post.content),
      richContent: null,
      boardId: post.boardId,
      moderationStatus: post.moderationStatus,
      status: post.status,
      media: post.PostMedia.map((media) => ({
        id: media.id,
        url: publicImageUrl(media.url) || media.url,
        sortOrder: media.sortOrder,
        broken: isSupabaseStorageUrl(media.url),
      })),
    },
  })
}
