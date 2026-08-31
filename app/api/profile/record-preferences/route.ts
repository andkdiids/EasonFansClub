import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { getProfileRecordPreferences } from '@/lib/profile-record-preferences'
import {
  normalizeProfileRecordPreferences,
  PROFILE_RECORD_SECTION_KEYS,
  isProfileRecordSectionKey,
} from '@/lib/profile-record-sections'

const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' }

function invalidPreferences() {
  return NextResponse.json({ message: '个人记录设置参数无效' }, { status: 400, headers: PRIVATE_HEADERS })
}

export async function GET() {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  try {
    return NextResponse.json({ sections: await getProfileRecordPreferences(guard.user.id) }, { headers: PRIVATE_HEADERS })
  } catch (error) {
    console.error('[profile-record-preferences.api.read]', { userId: guard.user.id, error })
    return NextResponse.json({ message: '个人记录设置暂时无法加载，请稍后重试' }, { status: 503, headers: PRIVATE_HEADERS })
  }
}

export async function PATCH(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null) as { sections?: unknown } | null
  if (!body || !Array.isArray(body.sections) || body.sections.length !== PROFILE_RECORD_SECTION_KEYS.length) return invalidPreferences()

  const submitted = body.sections.map((item) => {
    if (!item || typeof item !== 'object') return null
    const row = item as { key?: unknown; order?: unknown; visible?: unknown }
    return typeof row.key === 'string' && Number.isInteger(row.order) && typeof row.visible === 'boolean'
      ? { key: row.key, order: row.order as number, visible: row.visible }
      : null
  })
  if (submitted.some((item) => !item)) return invalidPreferences()

  const validRows = submitted as Array<{ key: string; order: number; visible: boolean }>
  const keys = new Set(validRows.map((item) => item.key))
  const orders = new Set(validRows.map((item) => item.order))
  if (keys.size !== PROFILE_RECORD_SECTION_KEYS.length || orders.size !== PROFILE_RECORD_SECTION_KEYS.length || validRows.some((item) => !isProfileRecordSectionKey(item.key) || item.order < 1 || item.order > PROFILE_RECORD_SECTION_KEYS.length)) return invalidPreferences()

  const preferences = normalizeProfileRecordPreferences(validRows.map((item) => ({ section: item.key, sortOrder: item.order, isVisible: item.visible })))
  try {
    await prisma.$transaction(
      preferences.map((preference) => prisma.profileRecordPreference.upsert({
        where: { userId_section: { userId: guard.user.id, section: preference.key } },
        update: { sortOrder: preference.order, isVisible: preference.visible },
        create: { userId: guard.user.id, section: preference.key, sortOrder: preference.order, isVisible: preference.visible },
      })),
    )
    return NextResponse.json({ sections: preferences, message: '个人记录设置已更新' }, { headers: PRIVATE_HEADERS })
  } catch (error) {
    console.error('[profile-record-preferences.api.update]', { userId: guard.user.id, error })
    return NextResponse.json({ message: '个人记录设置暂时无法保存，请稍后重试' }, { status: 503, headers: PRIVATE_HEADERS })
  }
}
