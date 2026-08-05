import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

const messageSelect = {
  id: true,
  title: true,
  content: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const

function serializeMessage(message: {
  id: string
  title: string
  content: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}) {
  return {
    id: message.id,
    title: message.title,
    content: message.content,
    isActive: message.isActive,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const guard = await requireAdmin('birthday_messages_manage')
  if (!guard.user) return guard.response
  const { id } = await context.params
  const body = await request.json().catch(() => null)

  const title = body?.title === undefined ? undefined : sanitizeText(body.title, 160)
  const content = body?.content === undefined ? undefined : sanitizeText(body.content, 10_000)
  const isActive = typeof body?.isActive === 'boolean' ? body.isActive : undefined

  if (content !== undefined && !content) {
    return NextResponse.json({ message: '生日祝福内容不能为空' }, { status: 400 })
  }
  if (title === undefined && content === undefined && isActive === undefined) {
    return NextResponse.json({ message: '没有提供任何要更新的字段' }, { status: 400 })
  }

  const message = await prisma.birthdayMessage.update({
    where: { id },
    data: {
      ...(title !== undefined ? { title } : {}),
      ...(content !== undefined ? { content } : {}),
      ...(isActive !== undefined ? { isActive } : {}),
    },
    select: messageSelect,
  })
  revalidatePath('/admin/birthday-messages')
  return NextResponse.json({ message: serializeMessage(message) })
}

export async function DELETE(_request: Request, context: RouteContext) {
  const guard = await requireAdmin('birthday_messages_manage')
  if (!guard.user) return guard.response
  const { id } = await context.params
  await prisma.birthdayMessage.delete({ where: { id } })
  revalidatePath('/admin/birthday-messages')
  return NextResponse.json({ ok: true })
}
