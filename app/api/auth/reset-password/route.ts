import bcrypt from 'bcryptjs'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashToken } from '@/lib/tokens'
import { normalizeText } from '@/lib/validators'

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const token = normalizeText(body?.token)
  const password = normalizeText(body?.password)

  if (!token || password.length < 8) {
    return NextResponse.json({ message: '重置令牌无效或密码至少需要 8 位' }, { status: 400 })
  }

  const reset = await prisma.passwordResetToken.findFirst({
    where: {
      tokenHash: hashToken(token),
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { id: true, userId: true },
  })

  if (!reset) {
    return NextResponse.json({ message: '重置令牌无效或已过期' }, { status: 400 })
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: reset.userId },
      data: { passwordHash: await bcrypt.hash(password, 12) },
    })

    await tx.passwordResetToken.update({
      where: { id: reset.id },
      data: { usedAt: new Date() },
    })
  })

  return NextResponse.json({ message: '密码已重置，请重新登录' })
}
