import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'

import { requireUser, sanitizeText } from '@/lib/security'
import { prisma } from '@/lib/prisma'
import {
  getStickerUploadErrorResponse,
  uploadStickerPackCover,
  STICKER_MAX_DESCRIPTION_LENGTH,
  STICKER_MAX_PACK_NAME_LENGTH,
} from '@/lib/sticker-upload'
import { toPublicMediaUrl } from '@/lib/media-url'
import { isUserEditableStickerPackStatus } from '@/lib/sticker-pack-editing'
import { BANNED_WORD_MESSAGE, CONTENT_CONTAINS_BANNED_WORD, checkBannedWords } from '@/lib/content-moderation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type PackForEdit = Awaited<ReturnType<typeof findPack>>

async function findPack(packId: string) {
  return prisma.stickerPack.findUnique({
    where: { id: packId },
    select: {
      id: true,
      name: true,
      description: true,
      coverUrl: true,
      type: true,
      status: true,
      rejectionReason: true,
      reviewedAt: true,
      createdAt: true,
      updatedAt: true,
      category: true,
      isOfficial: true,
      creatorId: true,
      stickers: {
        orderBy: { sort: 'asc' },
        select: { id: true, name: true, url: true, type: true, sort: true },
      },
    },
  })
}

function serializePack(pack: NonNullable<PackForEdit>) {
  return {
    id: pack.id,
    name: pack.name,
    description: pack.description,
    coverUrl: toPublicMediaUrl(pack.coverUrl),
    type: pack.type,
    status: pack.status,
    rejectionReason: pack.rejectionReason,
    reviewedAt: pack.reviewedAt?.toISOString() ?? null,
    createdAt: pack.createdAt.toISOString(),
    updatedAt: pack.updatedAt.toISOString(),
    category: pack.category,
    isOfficial: pack.isOfficial,
    stickers: pack.stickers.map((sticker) => ({
      ...sticker,
      url: toPublicMediaUrl(sticker.url) || sticker.url,
    })),
  }
}

function assertOwner(pack: NonNullable<PackForEdit>, userId: string) {
  if (pack.creatorId !== userId) {
    return NextResponse.json({ message: '无权查看或编辑该表情包' }, { status: 403 })
  }
  if (pack.isOfficial) {
    return NextResponse.json({ message: '官方表情包不能通过用户草稿流程编辑' }, { status: 403 })
  }
  return null
}

function assertEditable(pack: NonNullable<PackForEdit>) {
  if (isUserEditableStickerPackStatus(pack.status)) return null
  if (pack.status === 'PENDING') {
    return NextResponse.json({ message: '该表情包正在审核中，暂不能修改' }, { status: 409 })
  }
  return NextResponse.json({ message: '该表情包当前不可编辑' }, { status: 403 })
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ packId: string }> },
) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { packId } = await params
  if (!packId) return NextResponse.json({ message: '缺少合集标识' }, { status: 400 })

  const pack = await findPack(packId)
  if (!pack) return NextResponse.json({ message: '表情包不存在' }, { status: 404 })
  const ownerError = assertOwner(pack, guard.user.id)
  if (ownerError) return ownerError

  return NextResponse.json({ success: true, pack: serializePack(pack) })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ packId: string }> },
) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const { packId } = await params
  if (!packId) return NextResponse.json({ message: '缺少合集标识' }, { status: 400 })

  const pack = await findPack(packId)
  if (!pack) return NextResponse.json({ message: '表情包不存在' }, { status: 404 })
  const ownerError = assertOwner(pack, guard.user.id)
  if (ownerError) return ownerError
  const editableError = assertEditable(pack)
  if (editableError) return editableError

  let formData: FormData
  try {
    formData = await request.formData()
  } catch {
    return NextResponse.json({ message: '请求格式无效' }, { status: 400 })
  }

  const name = sanitizeText(formData.get('name'), STICKER_MAX_PACK_NAME_LENGTH)
  if (!name) return NextResponse.json({ message: '请填写表情包名称' }, { status: 400 })
  const description = sanitizeText(formData.get('description'), STICKER_MAX_DESCRIPTION_LENGTH) || null
  if ((await checkBannedWords(`${name}\n${description || ''}`)).blocked) {
    return NextResponse.json({ error: CONTENT_CONTAINS_BANNED_WORD, message: BANNED_WORD_MESSAGE }, { status: 400 })
  }
  const category = sanitizeText(formData.get('category'), 40) || null
  const coverFile = formData.get('cover')

  let coverUrl = pack.coverUrl
  try {
    if (coverFile instanceof File && coverFile.size > 0) {
      coverUrl = await uploadStickerPackCover({
        ownerId: guard.user.id,
        buffer: Buffer.from(await coverFile.arrayBuffer()),
        source: { field: 'cover', originalName: coverFile.name, mimeType: coverFile.type },
      })
    }
    if (!coverUrl) return NextResponse.json({ message: '请选择表情包封面' }, { status: 400 })

    // Re-check the owner and status in the write condition so an old edit tab
    // cannot mutate a pack after another tab has submitted it for review.
    const updatedCount = await prisma.stickerPack.updateMany({
      where: { id: packId, creatorId: guard.user.id, status: 'REJECTED', isOfficial: false },
      data: { name, description, category, coverUrl },
    })
    if (updatedCount.count === 0) {
      const current = await findPack(packId)
      if (!current) return NextResponse.json({ message: '表情包不存在' }, { status: 404 })
      const currentError = assertEditable(current)
      return currentError || NextResponse.json({ message: '表情包状态已变化，请刷新后重试' }, { status: 409 })
    }

    const updated = await findPack(packId)
    if (!updated) return NextResponse.json({ message: '表情包不存在' }, { status: 404 })
    revalidatePath('/profile/stickers')
    revalidatePath(`/profile/stickers/${packId}/edit`)
    revalidatePath('/admin/stickers')
    return NextResponse.json({ success: true, pack: serializePack(updated) })
  } catch (error) {
    console.error('[sticker.pack.edit]', error)
    const failure = getStickerUploadErrorResponse(error)
    return NextResponse.json({ message: failure.status === 500 ? '保存失败，请稍后重试' : failure.message }, { status: failure.status })
  }
}
