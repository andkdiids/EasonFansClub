import { NextResponse } from 'next/server'
import { hashEmailToken } from '@/lib/email-verification'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const token = searchParams.get('token') || ''
  const tokenHash = token ? hashEmailToken(token) : ''

  if (!tokenHash) {
    return NextResponse.redirect(new URL('/login?emailVerified=invalid', origin))
  }

  const verification = await prisma.emailVerification.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      email: true,
      expiresAt: true,
      usedAt: true,
      User: { select: { email: true, emailVerifiedAt: true } },
    },
  })

  if (!verification) {
    return NextResponse.redirect(new URL('/login?emailVerified=invalid', origin))
  }

  if (verification.usedAt || verification.User.emailVerifiedAt) {
    return NextResponse.redirect(new URL('/login?emailVerified=used', origin))
  }

  if (verification.expiresAt.getTime() < Date.now()) {
    return NextResponse.redirect(new URL('/login?emailVerified=expired', origin))
  }

  if (verification.User.email !== verification.email) {
    return NextResponse.redirect(new URL('/login?emailVerified=changed', origin))
  }

  await prisma.$transaction([
    prisma.user.update({
      where: { id: verification.userId },
      data: { emailVerifiedAt: new Date(), verificationStatus: 'VERIFIED' },
    }),
    prisma.emailVerification.update({
      where: { id: verification.id },
      data: { usedAt: new Date() },
    }),
  ])

  return NextResponse.redirect(new URL('/login?emailVerified=success', origin))
}
