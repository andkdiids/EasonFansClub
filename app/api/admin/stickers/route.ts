import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'
import { getAdminStickers, getHotStickers, createOfficialSticker, type AdminStickerFilter } from '@/lib/sticker-center'
import {
  uploadStickerImage,
  sanitizeStickerName,
  STICKER_MAX_FILE_SIZE,
  STICKER_STATIC_MIME_TYPES,
  STICKER_GIF_MIME_TYPE,
} from '@/lib/sticker-upload'
import type { StickerPackStatus, StickerType } from '@prisma/client'

export const dynamic = 'force-dynamic'

const VALID_STATUS: StickerPackStatus[] = ['PENDING', 'APPROVED', 'REJECTED']
const VALID_FILTERS: AdminStickerFilter[] = ['ALL', 'USER', 'OFFICIAL', 'REPORTED', 'HIDDEN']

/**
 * 后台表情数据入口。
 * - 默认（无 view）：返回用户提交的表情包合集（审核用，向后兼容）。
 * - ?view=stickers&filter=：返回单个表情列表（官方/用户/被举报/已隐藏）。
 * - ?view=hot&range=total|week：返回热门表情排行。
 */
export async function GET(request: Request) {
  const guard = await requireAdmin('sticker_manage')
  if (!guard.user) return guard.response

  const url = new URL(request.url)
  const view = url.searchParams.get('view')

  if (view === 'hot') {
    const range = url.searchParams.get('range') === 'week' ? 'week' : 'total'
    const stickers = await getHotStickers(range)
    return NextResponse.json({ range, stickers })
  }

  if (view === 'stickers') {
    const filterParam = url.searchParams.get('filter')
    const filter = VALID_FILTERS.includes(filterParam as AdminStickerFilter)
      ? (filterParam as AdminStickerFilter)
      : 'ALL'
    const stickers = await getAdminStickers(filter)
    return NextResponse.json({ filter, stickers })
  }

  const statusParam = url.searchParams.get('status')
  const status = VALID_STATUS.includes(statusParam as StickerPackStatus)
    ? (statusParam as StickerPackStatus)
    : undefined

  const where = status ? { status } : {}
  const orderBy: { status?: 'asc' | 'desc'; createdAt: 'desc' } = status
    ? { createdAt: 'desc' }
    : { status: 'asc', createdAt: 'desc' }

  const packs = await prisma.stickerPack.findMany({
    where,
    orderBy,
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
      creator: { select: { id: true, nickname: true, uid: true } },
      stickers: {
        orderBy: { sort: 'asc' },
        select: { id: true, name: true, url: true, type: true, sort: true },
      },
    },
  })

  return NextResponse.json({ packs })
}

/**
 * 后台上传官方表情：接收图片文件 + 名称/分类/类型，上传至存储并创建官方合集与表情。
 */
export async function POST(request: Request) {
  const guard = await requireAdmin('sticker_manage')
  if (!guard.user) return guard.response

  const formData = await request.formData().catch(() => null)
  if (!formData) return NextResponse.json({ message: '请求无效' }, { status: 400 })

  const file = formData.get('file')
  if (!(file instanceof File)) return NextResponse.json({ message: '请选择表情图片' }, { status: 400 })
  if (file.size === 0) return NextResponse.json({ message: '表情文件不能为空' }, { status: 400 })
  if (file.size > STICKER_MAX_FILE_SIZE) return NextResponse.json({ message: '表情文件不能超过 5MB' }, { status: 400 })

  const typeRaw = String(formData.get('type') || 'STATIC')
  const type: StickerType = typeRaw === 'GIF' ? 'GIF' : 'STATIC'
  const allowedStatic = (STICKER_STATIC_MIME_TYPES as readonly string[])
  const allowed = type === 'GIF' ? file.type === STICKER_GIF_MIME_TYPE : allowedStatic.includes(file.type)
  if (!allowed) {
    return NextResponse.json(
      { message: type === 'GIF' ? '动态表情只能上传 GIF 动图' : '静态表情只能上传 JPG / PNG / WebP' },
      { status: 400 },
    )
  }

  let name: string | null = null
  try {
    name = sanitizeStickerName(formData.get('name'))
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : '表情名称无效' }, { status: 400 })
  }
  const category = sanitizeText(String(formData.get('category') || ''), 40) || null

  const buffer = Buffer.from(await file.arrayBuffer())
  try {
    const { url } = await uploadStickerImage({ ownerId: guard.user.id, type, mime: file.type, buffer })
    const sticker = await createOfficialSticker({
      creatorId: guard.user.id,
      name,
      url,
      category,
      type,
    })
    return NextResponse.json({ sticker }, { status: 201 })
  } catch (error) {
    console.error('[admin.sticker.create]', error)
    return NextResponse.json({ message: error instanceof Error ? error.message : '上传官方表情失败' }, { status: 400 })
  }
}
