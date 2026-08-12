import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'

import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/security'
import {
  getStickerUploadErrorResponse,
  sanitizeStickerName,
  uploadStickerImage,
  STICKER_FILE_TOO_LARGE_MESSAGE,
  STICKER_MAX_FILE_SIZE,
} from '@/lib/sticker-upload'
import { toPublicMediaUrl } from '@/lib/media-url'

export const runtime = 'nodejs'
export const maxDuration = 120

export async function POST(
  request: Request,
  { params }: { params: Promise<{ packId: string }> },
) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { packId } = await params
  if (!packId) return NextResponse.json({ message: '缺少合集标识' }, { status: 400 })

  const pack = await prisma.stickerPack.findUnique({
    where: { id: packId },
    select: { id: true, creatorId: true, status: true, isOfficial: true },
  })
  if (!pack) return NextResponse.json({ message: '表情包不存在' }, { status: 404 })
  if (pack.creatorId !== guard.user.id) return NextResponse.json({ message: '无权编辑该表情包' }, { status: 403 })
  if (pack.isOfficial) return NextResponse.json({ message: '官方表情包不能通过用户草稿流程编辑' }, { status: 403 })
  if (pack.status === 'PENDING') return NextResponse.json({ message: '该表情包正在审核中，暂不能新增表情' }, { status: 409 })
  if (pack.status !== 'REJECTED') return NextResponse.json({ message: '该表情包当前不可编辑' }, { status: 403 })

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ message: '请求格式无效' }, { status: 400 })
  }

  const file = formData.get('file')
  if (!(file instanceof File)) return NextResponse.json({ message: '请选择表情图片' }, { status: 400 })
  if (file.size === 0) return NextResponse.json({ message: '表情文件不能为空' }, { status: 400 })
  if (file.size > STICKER_MAX_FILE_SIZE) {
    return NextResponse.json({ message: STICKER_FILE_TOO_LARGE_MESSAGE }, { status: 413 })
  }

  let name: string | null = null
  try {
    name = sanitizeStickerName(formData.get('name'))
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : '表情名称无效' }, { status: 400 })
  }

  const typeRaw = String(formData.get('type') || 'STATIC').toUpperCase()
  const type = typeRaw === 'GIF' ? 'GIF' : 'STATIC'

  try {
    const result = await uploadStickerImage({
      ownerId: guard.user.id,
      type,
      buffer: Buffer.from(await file.arrayBuffer()),
    })

    const sticker = await prisma.$transaction(async (tx) => {
      // The status check is repeated inside the write transaction. The file
      // may have been uploaded while another tab submitted the pack.
      const current = await tx.stickerPack.findFirst({
        where: { id: packId, creatorId: guard.user.id, status: 'REJECTED', isOfficial: false },
        select: { id: true, type: true },
      })
      if (!current) throw new Error('STICKER_PACK_NOT_EDITABLE')

      const count = await tx.sticker.count({ where: { packId } })
      if (count >= 60) throw new Error('STICKER_PACK_LIMIT_REACHED')
      const maxSort = await tx.sticker.aggregate({ where: { packId }, _max: { sort: true } })
      if (result.type === 'GIF' && current.type !== 'GIF') {
        await tx.stickerPack.update({ where: { id: packId }, data: { type: 'GIF' } })
      }
      return tx.sticker.create({
        data: {
          packId,
          name,
          url: result.url,
          type: result.type,
          sort: (maxSort._max.sort ?? -1) + 1,
          enabled: true,
        },
        select: { id: true, name: true, url: true, type: true, sort: true },
      })
    })

    revalidatePath('/profile/stickers')
    revalidatePath(`/profile/stickers/${packId}/edit`)
    revalidatePath('/admin/stickers')
    return NextResponse.json({
      success: true,
      sticker: { ...sticker, url: toPublicMediaUrl(sticker.url) || sticker.url },
    }, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'STICKER_PACK_LIMIT_REACHED') {
      return NextResponse.json({ message: '一个表情包最多 60 张表情' }, { status: 400 })
    }
    if (error instanceof Error && error.message === 'STICKER_PACK_NOT_EDITABLE') {
      return NextResponse.json({ message: '表情包状态已变化，请刷新后重试' }, { status: 409 })
    }
    console.error('[sticker.pack.add]', error)
    const failure = getStickerUploadErrorResponse(error)
    return NextResponse.json({ message: failure.status === 500 ? '上传失败，请稍后重试' : failure.message }, { status: failure.status })
  }
}
