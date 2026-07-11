import bcrypt from 'bcryptjs'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireUser } from '@/lib/security'
import { normalizeText } from '@/lib/validators'

export async function POST(request: Request) {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  const oldPassword = normalizeText(body?.oldPassword)
  const newPassword = normalizeText(body?.newPassword)

  if (!oldPassword || newPassword.length < 8) {
    return NextResponse.json({ message: '旧密码不能为空，新密码至少需要 8 位' }, { status: 400 })
  }

  const user = await prisma.user.findUnique({
    where: { id: guard.user.id },
    select: { passwordHash: true },
  })

  if (!user || !(await bcrypt.compare(oldPassword, user.passwordHash))) {
    return NextResponse.json({ message: '旧密码不正确' }, { status: 400 })
  }

  await prisma.user.update({
    where: { id: guard.user.id },
    data: { passwordHash: await bcrypt.hash(newPassword, 12) },
  })

  return NextResponse.json({ message: '密码已修改' })
}
