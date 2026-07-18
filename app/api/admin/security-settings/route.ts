import { NextResponse } from 'next/server'
import { getAccountSecuritySettings, parseAccountSecuritySettings, setAccountSecuritySettings } from '@/lib/account-security'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'

export async function GET() {
  const guard = await requireAdmin('account_security_manage')
  if (!guard.user) return guard.response
  return NextResponse.json(await getAccountSecuritySettings(), { headers: { 'Cache-Control': 'no-store, max-age=0' } })
}

export async function PUT(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('account_security_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  const settings = parseAccountSecuritySettings(body)
  if (!settings) return NextResponse.json({ message: '账户安全设置格式不正确' }, { status: 400 })
  const before = await getAccountSecuritySettings()
  await prisma.$transaction(async (tx) => {
    await setAccountSecuritySettings(settings, tx)
    await tx.adminAction.create({ data: { adminId: guard.user.id, action: 'UPDATE_SETTING', reason: '更新账户安全设置', metadata: { before, after: settings } } })
  })
  return NextResponse.json({ message: '账户安全设置已保存并立即生效', settings })
}
