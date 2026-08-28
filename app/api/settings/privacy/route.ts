import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import {
  DEFAULT_USER_PRIVACY_SETTINGS,
  USER_PRIVACY_KEYS,
  USER_PRIVACY_SELECT,
  getUserPrivacySettings,
  normalizeUserPrivacySettings,
  type UserPrivacyKey,
  type UserPrivacySettings,
} from '@/lib/user-privacy'

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function errorResponse(message: string) {
  return NextResponse.json({ message }, { status: 503, headers: PRIVATE_HEADERS })
}

export async function GET() {
  const guard = await requireUser()
  if (!guard.user) return guard.response
  try {
    return NextResponse.json({ privacy: await getUserPrivacySettings(guard.user.id), defaults: DEFAULT_USER_PRIVACY_SETTINGS }, { headers: PRIVATE_HEADERS })
  } catch (error) {
    console.error('[user-privacy.api.read]', { userId: guard.user.id, error })
    return errorResponse('隐私设置暂时无法加载，请稍后重试')
  }
}

export async function PATCH(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null) as unknown
  if (!isRecord(body)) return NextResponse.json({ message: '隐私设置参数无效' }, { status: 400, headers: PRIVATE_HEADERS })

  const updates: Partial<UserPrivacySettings> = {}
  for (const [key, value] of Object.entries(body)) {
    if (!(USER_PRIVACY_KEYS as readonly string[]).includes(key) || typeof value !== 'boolean') {
      return NextResponse.json({ message: '隐私设置参数无效' }, { status: 400, headers: PRIVATE_HEADERS })
    }
    updates[key as UserPrivacyKey] = value
  }
  if (!Object.keys(updates).length) return NextResponse.json({ message: '至少需要修改一项隐私设置' }, { status: 400, headers: PRIVATE_HEADERS })

  try {
    const saved = await prisma.userPrivacySetting.upsert({
      where: { userId: guard.user.id },
      update: updates,
      create: { userId: guard.user.id, ...DEFAULT_USER_PRIVACY_SETTINGS, ...updates },
      select: USER_PRIVACY_SELECT,
    })
    return NextResponse.json({ privacy: normalizeUserPrivacySettings(saved), message: '隐私设置已更新' }, { headers: PRIVATE_HEADERS })
  } catch (error) {
    console.error('[user-privacy.api.update]', { userId: guard.user.id, error })
    return errorResponse('隐私设置暂时无法保存，请稍后重试')
  }
}
