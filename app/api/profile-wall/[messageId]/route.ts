import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function DELETE(_request: Request, { params }: { params: Promise<{ messageId: string }> }) {
  const viewer = await getCurrentUser()
  if (!viewer) return NextResponse.json({ message: '请先登录' }, { status: 401 })

  const { messageId } = await params
  const message = await prisma.profileWallMessage.findUnique({
    where: { id: messageId },
    select: { id: true, senderId: true, deletedAt: true },
  })
  if (!message || message.deletedAt) return NextResponse.json({ message: '留言不存在' }, { status: 404 })

  const canDelete = viewer.id === message.senderId || viewer.role === 'ADMIN' || viewer.role === 'SUPER_ADMIN'
  if (!canDelete) return NextResponse.json({ message: '没有权限删除这条留言' }, { status: 403 })

  await prisma.profileWallMessage.update({
    where: { id: message.id },
    data: { deletedAt: new Date() },
  })

  return NextResponse.json({ message: '留言已删除' })
}
