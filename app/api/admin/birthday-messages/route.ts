import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'

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

export async function GET() {
  const guard = await requireAdmin('birthday_messages_manage')
  if (!guard.user) return guard.response

  const messages = await prisma.birthdayMessage.findMany({
    orderBy: [{ createdAt: 'desc' }, { updatedAt: 'desc' }],
    take: 500,
    select: messageSelect,
  })
  return NextResponse.json({ messages: messages.map(serializeMessage) })
}

export async function POST(request: Request) {
  const guard = await requireAdmin('birthday_messages_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)

  const title = sanitizeText(body?.title, 160)
  const content = sanitizeText(body?.content, 10_000)
  const isActive = typeof body?.isActive === 'boolean' ? body.isActive : true

  if (!content) {
    return NextResponse.json({ message: '请填写生日祝福内容' }, { status: 400 })
  }

  const message = await prisma.birthdayMessage.create({
    data: {
      content,
      isActive,
      ...(title ? { title } : {}),
    },
    select: messageSelect,
  })
  revalidatePath('/admin/birthday-messages')
  return NextResponse.json({ message: serializeMessage(message) }, { status: 201 })
}
