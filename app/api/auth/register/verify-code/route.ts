import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashRegistrationCode, normalizeRegistrationCode } from '@/lib/registration-draft'
import { rejectInvalidRequestOrigin } from '@/lib/security'
import { hashToken } from '@/lib/tokens'

const noStoreHeaders = { 'Cache-Control': 'no-store, max-age=0' }

export async function POST(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError

  const body = await request.json().catch(() => null)
  const registrationToken = String(body?.registrationToken ?? '').trim()
  const code = normalizeRegistrationCode(body?.code)
  if (!registrationToken || !/^\d{6}$/.test(code)) {
    return NextResponse.json({ message: '邮箱验证码格式不正确', code: 'INVALID_VERIFICATION_CODE' }, { status: 400, headers: noStoreHeaders })
  }

  const draft = await prisma.registrationDraft.findUnique({ where: { tokenHash: hashToken(registrationToken) } })
  if (!draft || draft.completedAt) return NextResponse.json({ message: '注册验证已失效，请重新填写注册资料', code: 'REGISTRATION_DRAFT_NOT_FOUND' }, { status: 410, headers: noStoreHeaders })
  if (draft.expiresAt <= new Date()) return NextResponse.json({ message: '注册验证已过期，请重新填写注册资料', code: 'REGISTRATION_DRAFT_EXPIRED' }, { status: 410, headers: noStoreHeaders })
  if (draft.emailVerifiedAt) {
    return NextResponse.json({ emailVerified: true, message: '邮箱已验证' }, { headers: noStoreHeaders })
  }

  const now = new Date()
  const expectedHash = hashRegistrationCode(registrationToken, 'EMAIL', code)
  const matches = draft.emailCodeHash === expectedHash && Boolean(draft.emailCodeExpiresAt && draft.emailCodeExpiresAt > now)
  if (!matches) return NextResponse.json({ message: '验证码错误或已过期', code: 'VERIFICATION_CODE_INVALID' }, { status: 400, headers: noStoreHeaders })

  const updated = await prisma.registrationDraft.update({
    where: { id: draft.id },
    data: { emailVerifiedAt: now, emailCodeHash: null, emailCodeExpiresAt: null },
  })
  return NextResponse.json({
    emailVerified: Boolean(updated.emailVerifiedAt),
    message: '邮箱验证通过',
  }, { headers: noStoreHeaders })
}
