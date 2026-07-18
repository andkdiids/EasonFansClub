import { NextResponse } from 'next/server'
import { getRegistrationPolicy, isValidRegistrationMode, setStoredRegistrationMode } from '@/lib/registration'
import { requireAdmin } from '@/lib/security'

export async function GET() {
  const guard = await requireAdmin('account_security_manage')
  if (!guard.user) return guard.response

  const policy = await getRegistrationPolicy()
  return NextResponse.json(policy, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
}

export async function PATCH(request: Request) {
  const guard = await requireAdmin('account_security_manage')
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  const mode = body?.registrationMode
  if (!isValidRegistrationMode(mode)) {
    return NextResponse.json({ message: '注册模式不正确' }, { status: 400 })
  }

  await setStoredRegistrationMode(mode)
  const policy = await getRegistrationPolicy()
  return NextResponse.json({ message: '注册模式已保存并立即生效', policy })
}
