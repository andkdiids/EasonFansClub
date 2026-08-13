import { NextResponse } from 'next/server'
import { getAccountSecuritySettings, parseAccountSecuritySettings, setAccountSecuritySettings } from '@/lib/account-security'
import { prisma } from '@/lib/prisma'
import {
  getRegistrationControlSettings,
  getRegistrationPolicy,
  parseRegistrationControlInput,
  REGISTRATION_DAILY_SCHEDULE_VALIDATION_MESSAGE,
  REGISTRATION_ONE_TIME_VALIDATION_MESSAGE,
  serializeRegistrationAvailability,
  serializeRegistrationControlSettings,
  setRegistrationControlSettings,
  validateRegistrationControlSettings,
} from '@/lib/registration'
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

  if (body && typeof body === 'object' && body.registrationControlAction) {
    const action = body.registrationControlAction
    if (action !== 'OPEN_NOW' && action !== 'CLOSE_NOW' && action !== 'STOP_SCHEDULED') {
      return NextResponse.json({ message: '注册开放操作不正确' }, { status: 400 })
    }

    const before = await getRegistrationControlSettings()
    if (before.mode === 'DAILY_SCHEDULE' && action !== 'STOP_SCHEDULED') {
      return NextResponse.json({ message: '每日定时模式请通过时间段自动控制；如需手动操作，请先切换为手动控制' }, { status: 400 })
    }
    const next = action === 'OPEN_NOW'
      ? { ...before, override: 'OPEN' as const }
      : action === 'CLOSE_NOW'
        ? { ...before, override: 'CLOSED' as const }
        : { ...before, mode: 'MANUAL' as const, override: 'NONE' as const }
    const reason = action === 'OPEN_NOW' ? '立即开放注册' : action === 'CLOSE_NOW' ? '立即关闭注册' : '停止限时开放注册'

    await prisma.$transaction(async (tx) => {
      await setRegistrationControlSettings(next, tx)
      await tx.adminAction.create({
        data: {
          adminId: guard.user.id,
          action: 'UPDATE_SETTING',
          reason,
          metadata: {
            before: serializeRegistrationControlSettings(before),
            after: serializeRegistrationControlSettings(next),
          },
        },
      })
    })

    const policy = await getRegistrationPolicy()
    return NextResponse.json({
      message: `${reason}已生效`,
      registrationControl: serializeRegistrationControlSettings(policy.registrationControl),
      availability: serializeRegistrationAvailability(policy.registrationAvailability),
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
  }

  if (body && typeof body === 'object' && body.registrationControl) {
    const parsed = parseRegistrationControlInput(body.registrationControl)
    if (!parsed) {
      const mode = typeof body.registrationControl.mode === 'string' ? body.registrationControl.mode : ''
      const message = mode === 'DAILY_SCHEDULE'
        ? REGISTRATION_DAILY_SCHEDULE_VALIDATION_MESSAGE
        : mode === 'ONE_TIME' || mode === 'SCHEDULED'
          ? REGISTRATION_ONE_TIME_VALIDATION_MESSAGE
          : '注册开放模式不正确'
      return NextResponse.json({ message }, { status: 400 })
    }
    const validationError = validateRegistrationControlSettings(parsed)
    if (validationError) return NextResponse.json({ message: validationError }, { status: 400 })
    if (parsed.mode === 'ONE_TIME' && parsed.closesAt && parsed.closesAt <= new Date() && body.confirmEnded !== true) {
      return NextResponse.json({ message: '该注册时间段已经结束，请确认是否仍要保存', code: 'REGISTRATION_WINDOW_ALREADY_ENDED' }, { status: 400 })
    }

    const before = await getRegistrationControlSettings()
    const next = {
      ...parsed,
      // Saving an automatic schedule deliberately clears an old emergency
      // override so the new window is evaluated immediately.
      override: parsed.mode === 'MANUAL' ? before.override : 'NONE' as const,
    }
    await prisma.$transaction(async (tx) => {
      await setRegistrationControlSettings(next, tx)
      await tx.adminAction.create({
        data: {
          adminId: guard.user.id,
          action: 'UPDATE_SETTING',
          reason: '更新注册开放控制',
          metadata: {
            before: serializeRegistrationControlSettings(before),
            after: serializeRegistrationControlSettings(next),
          },
        },
      })
    })

    const policy = await getRegistrationPolicy()
    return NextResponse.json({
      message: '注册开放设置已保存并立即生效',
      registrationControl: serializeRegistrationControlSettings(policy.registrationControl),
      availability: serializeRegistrationAvailability(policy.registrationAvailability),
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
  }

  const settings = parseAccountSecuritySettings(body)
  if (!settings) return NextResponse.json({ message: '账户安全设置格式不正确' }, { status: 400 })
  const before = await getAccountSecuritySettings()
  await prisma.$transaction(async (tx) => {
    await setAccountSecuritySettings(settings, tx)
    await tx.adminAction.create({ data: { adminId: guard.user.id, action: 'UPDATE_SETTING', reason: '更新账户安全设置', metadata: { before, after: settings } } })
  })
  return NextResponse.json({ message: '账户安全设置已保存并立即生效', settings })
}
