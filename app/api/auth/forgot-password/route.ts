import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createPlainToken, hashToken } from '@/lib/tokens'
import { normalizeText } from '@/lib/validators'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

export async function POST(request: Request) {
  const body = await request.json().catch(() => null)
  const identifier = normalizeText(body?.identifier).toLowerCase()

  if (!identifier) {
    return NextResponse.json({ message: '请输入邮箱、手机号或用户名' }, { status: 400, headers: noStoreHeaders })
  }

  const user = await prisma.user.findFirst({
    where: {
      isDeleted: false,
      status: 'ACTIVE',
      OR: [{ username: identifier }, { email: identifier }, { phone: identifier }],
    },
    select: { id: true },
  })

  if (!user) {
    return NextResponse.json({ message: '如果账号存在，系统会发送重置方式' }, { headers: noStoreHeaders })
  }

  const token = createPlainToken()
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 1000 * 60 * 30),
    },
  })

  return NextResponse.json(
    {
      message: '重置密码记录已创建，邮件/短信发送接口已预留',
      devResetToken: process.env.NODE_ENV === 'production' ? undefined : token,
    },
    { headers: noStoreHeaders },
  )
}
