import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/security'
import type { StickerPackStatus } from '@prisma/client'

export const dynamic = 'force-dynamic'

const VALID_STATUS: StickerPackStatus[] = ['PENDING', 'APPROVED', 'REJECTED']

/**
 * 列出表情包合集供后台审核。支持 ?status= 过滤；
 * 默认按「待审优先、创建时间倒序」返回，包含表情列表与创作者昵称。
 */
export async function GET(request: Request) {
  const guard = await requireAdmin('sticker_manage')
  if (!guard.user) return guard.response

  const url = new URL(request.url)
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
