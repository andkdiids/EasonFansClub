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
const genericMessage = '如果该邮箱存在且尚未验证，我们会发送一封新的验证邮件。'

export async function POST(request: Request) {
  const limited = await rateLimit(`ip:${getClientIp(request)}`, 'resend-email-verification', 10, 60 * 60)
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

  if (!user || user.emailVerifiedAt) {
    return NextResponse.json({ message: genericMessage }, { headers: noStoreHeaders })
  }

  if (!(await canSendEmailVerification(email))) {
    return NextResponse.json({ message: '验证邮件发送过于频繁，请 60 秒后再试' }, {
      status: 429,
      headers: { ...noStoreHeaders, 'Retry-After': '60' },
    })
  }

  const verification = await createVerificationForUser(user.id, email)
  const emailResult = await sendVerificationEmail(email, verification.verificationUrl, 'resend')

  return NextResponse.json(
    {
      message: genericMessage,
      emailSent: emailResult.sent,
      devVerificationUrl: process.env.NODE_ENV === 'production' ? undefined : verification.verificationUrl,
    },
    { headers: noStoreHeaders },
  )
}
