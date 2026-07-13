import { NextResponse } from 'next/server'
import {
  canSendEmailVerification,
  createVerificationForUser,
  isValidEmail,
  normalizeEmail,
  sendVerificationEmail,
} from '@/lib/email-verification'
import { prisma } from '@/lib/prisma'
import { getClientIp, rateLimit } from '@/lib/security'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

export async function POST(request: Request) {
  const limited = await rateLimit(`ip:${getClientIp(request)}`, 'resend-email-verification', 5, 60 * 60)
  if (limited) return limited

  const body = await request.json().catch(() => null)
  const email = normalizeEmail(body?.email)
  if (!email || !isValidEmail(email)) {
    return NextResponse.json({ message: '请输入有效邮箱' }, { status: 400, headers: noStoreHeaders })
  }

  const user = await prisma.user.findFirst({
    where: { email, isDeleted: false, status: 'ACTIVE' },
    select: { id: true, emailVerifiedAt: true },
  })

  if (!user) {
    return NextResponse.json({ message: '邮箱未注册' }, { status: 404, headers: noStoreHeaders })
  }

  if (user.emailVerifiedAt) {
    return NextResponse.json({ message: '该邮箱已经验证，可以直接登录' }, { headers: noStoreHeaders })
  }

  if (!(await canSendEmailVerification(email))) {
    return NextResponse.json({ message: '验证邮件发送过于频繁，请 10 分钟后再试' }, { status: 429, headers: noStoreHeaders })
  }

  const verification = await createVerificationForUser(user.id, email)
  const emailResult = await sendVerificationEmail(email, verification.verificationUrl)

  return NextResponse.json(
    {
      message: '验证邮件已发送，请查收',
      emailSent: emailResult.sent,
      devVerificationUrl: process.env.NODE_ENV === 'production' ? undefined : verification.verificationUrl,
    },
    { headers: noStoreHeaders },
  )
}
