import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'

import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/security'

export const dynamic = 'force-dynamic'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ packId: string }> },
) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { packId } = await params
  if (!packId) return NextResponse.json({ message: '缺少合集标识' }, { status: 400 })

  const pack = await prisma.stickerPack.findUnique({
    where: { id: packId },
    select: { id: true, name: true, creatorId: true, status: true, isOfficial: true },
  })
  if (!pack) return NextResponse.json({ message: '表情包不存在' }, { status: 404 })
  if (pack.creatorId !== guard.user.id) return NextResponse.json({ message: '无权提交该表情包' }, { status: 403 })
  if (pack.isOfficial) return NextResponse.json({ message: '官方表情包不能通过用户审核流程提交' }, { status: 403 })
  if (pack.status === 'PENDING') return NextResponse.json({ message: '该表情包已经在审核中' }, { status: 409 })
  if (pack.status !== 'REJECTED') return NextResponse.json({ message: '只有被退回的表情包可以重新提交审核' }, { status: 403 })

  try {
    await prisma.$transaction(async (tx) => {
      const current = await tx.stickerPack.findFirst({
        where: { id: packId, creatorId: guard.user.id, status: 'REJECTED', isOfficial: false },
        select: { id: true, name: true, creatorId: true },
      })
      if (!current) throw new Error('STICKER_PACK_NOT_REJECTED')

      const stickerCount = await tx.sticker.count({ where: { packId } })
      if (stickerCount < 6) throw new Error('STICKER_PACK_TOO_FEW')
      if (stickerCount > 60) throw new Error('STICKER_PACK_TOO_MANY')

      const updated = await tx.stickerPack.updateMany({
        where: { id: packId, creatorId: guard.user.id, status: 'REJECTED', isOfficial: false },
        // Keep rejectionReason as the latest review feedback history. The
        // client only renders it while status is REJECTED.
        data: { status: 'PENDING', reviewedAt: null },
      })
      if (updated.count === 0) throw new Error('STICKER_PACK_NOT_REJECTED')

      const administrators = await tx.user.findMany({
        where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] }, status: 'ACTIVE', isDeleted: false },
        select: { id: true },
      })
      if (administrators.length) {
        await tx.notification.createMany({
          data: administrators.map((administrator) => ({
            recipientId: administrator.id,
            actorId: guard.user.id,
            type: 'ADMIN' as const,
            title: '表情包重新提交审核',
            content: `用户重新提交了表情包《${current.name}》，请前往审核中心处理。`,
            link: '/admin/stickers',
            key: `sticker-pack-resubmit:${packId}:${randomUUID()}`,
          })),
          skipDuplicates: true,
        })
      }
    })

    revalidatePath('/profile/stickers')
    revalidatePath(`/profile/stickers/${packId}/edit`)
    revalidatePath('/admin/stickers')
    return NextResponse.json({ success: true, packId, status: 'PENDING' })
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'STICKER_PACK_TOO_FEW') {
        return NextResponse.json({ message: '一个表情包合集至少需要 6 张表情，请补充后再提交审核' }, { status: 400 })
      }
      if (error.message === 'STICKER_PACK_TOO_MANY') {
        return NextResponse.json({ message: '一个表情包合集最多 60 张表情' }, { status: 400 })
      }
      if (error.message === 'STICKER_PACK_NOT_REJECTED') {
        return NextResponse.json({ message: '表情包状态已变化，请刷新后重试' }, { status: 409 })
      }
    }
    console.error('[sticker.pack.resubmit]', error)
    return NextResponse.json({ message: '重新提交失败，请稍后重试' }, { status: 500 })
  }
}
