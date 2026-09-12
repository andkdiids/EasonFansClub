import Link from 'next/link'
import { redirect } from 'next/navigation'
import { DraftBox, type DraftBoxItem } from '@/components/DraftBox'
import { BackButton } from '@/components/BackButton'
import { getCurrentUser } from '@/lib/auth'
import { getForumBoardDisplayName } from '@/lib/boards'
import { parseContentImageUrls } from '@/lib/content-images'
import { formatDate } from '@/lib/format'
import { publicImageUrl } from '@/lib/images'
import { prisma } from '@/lib/prisma'
import { postContentPlainText, summarizePlainText } from '@/lib/share-metadata'

export const dynamic = 'force-dynamic'

export default async function DraftsPage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login?redirect=%2Fdrafts')

  const row = await prisma.postDraft.findUnique({
    where: { userId: user.id },
    select: {
      id: true,
      boardId: true,
      title: true,
      content: true,
      richContent: true,
      imageUrls: true,
      version: true,
      updatedAt: true,
    },
  })
  const board = row?.boardId
    ? await prisma.board.findUnique({ where: { id: row.boardId }, select: { name: true, slug: true, isActive: true } })
    : null
  const imageUrls = row ? parseContentImageUrls(row.imageUrls) : []
  const firstImage = imageUrls.map(publicImageUrl).find((value): value is string => Boolean(value)) || null
  const draft: DraftBoxItem | null = row ? {
    id: row.id,
    title: row.title,
    summary: summarizePlainText(postContentPlainText(row.content, row.richContent), 180),
    boardName: board ? `${getForumBoardDisplayName(board)}${board.isActive ? '' : '（分区已下架）'}` : '未选择分区',
    updatedAt: row.updatedAt.toISOString(),
    updatedAtLabel: formatDate(row.updatedAt),
    imageCount: imageUrls.length,
    imageUrl: firstImage,
    version: row.version,
  } : null

  return (
    <main className="site-page-main flat-page mx-auto w-full max-w-5xl space-y-5 px-4 py-5 sm:px-5 sm:py-8">
      <section className="border border-sky-100 bg-white/85 p-5 shadow-sm sm:p-6">
        <BackButton fallbackHref="/forum" label="返回 E院广场" />
        <div className="mt-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em] text-brand-700">Drafts</p>
            <h1 className="mt-2 text-3xl font-black text-brand-950 sm:text-4xl">草稿箱</h1>
            <p className="mt-2 text-sm font-bold leading-7 text-slate-500">云端保存，登录同一账号即可在其他设备继续编辑。</p>
          </div>
          <Link href="/posts/new?returnTo=%2Fdrafts" className="inline-flex min-h-10 items-center rounded-sm border border-sky-200 px-4 text-sm font-black text-brand-700 transition hover:bg-sky-50">
            新建帖子
          </Link>
        </div>
      </section>
      <DraftBox initialDraft={draft} />
    </main>
  )
}
