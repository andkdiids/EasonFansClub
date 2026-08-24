import { NextResponse } from 'next/server'
import {
  getEcenterFeatureEditorState,
  validateEcenterShortcutPreferences,
} from '@/lib/ecenter-features'
import { prisma } from '@/lib/prisma'
import { rejectInvalidRequestOrigin, requireUser } from '@/lib/security'
import { hasAdminPermission } from '@/lib/admin-permissions'

export const dynamic = 'force-dynamic'

function serializeFeatures(features: Awaited<ReturnType<typeof getEcenterFeatureEditorState>>) {
  return features.map((feature) => ({
    featureKey: feature.featureKey,
    label: feature.label,
    href: feature.href,
    icon: feature.icon,
    title: feature.title,
    defaultSortOrder: feature.defaultSortOrder,
    defaultEnabled: feature.defaultEnabled,
    sortOrder: feature.sortOrder,
    isEnabled: feature.isEnabled,
    isManageable: feature.isManageable,
    showInCenter: feature.showInCenter,
    showInQuickNavigation: feature.showInQuickNavigation,
    activePrefixes: feature.activePrefixes,
    hidden: feature.hidden,
    showsUnread: feature.showsUnread,
    requiresAdmin: feature.requiresAdmin,
  }))
}

async function canAccessAdmin(user: Awaited<ReturnType<typeof requireUser>>['user']) {
  if (!user) return false
  return hasAdminPermission(user).catch(() => false)
}

export async function GET() {
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const state = await getEcenterFeatureEditorState(guard.user.id, await canAccessAdmin(guard.user))
  return NextResponse.json({ features: serializeFeatures(state) }, {
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  })
}

export async function PATCH(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireUser()
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!body || typeof body !== 'object') return NextResponse.json({ message: 'E院中心个性化设置格式不正确' }, { status: 400 })

  const reset = body.reset === true
  const validation = validateEcenterShortcutPreferences(body.preferences)
  if (!reset && 'error' in validation) return NextResponse.json({ message: validation.error }, { status: 400 })

  try {
    await prisma.$transaction(async (tx) => {
      await tx.userCenterShortcutPreference.deleteMany({ where: { userId: guard.user!.id } })
      if (!reset && 'preferences' in validation && validation.preferences.length > 0) {
        await tx.userCenterShortcutPreference.createMany({
          data: validation.preferences.map((preference) => ({
            userId: guard.user!.id,
            itemKey: preference.itemKey,
            sortOrder: preference.sortOrder,
            hidden: preference.hidden,
          })),
        })
      }
    })

    const state = await getEcenterFeatureEditorState(guard.user.id, await canAccessAdmin(guard.user))
    return NextResponse.json({
      message: reset ? 'E院中心已恢复默认布局' : 'E院中心设置已保存',
      features: serializeFeatures(state),
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } })
  } catch (error) {
    console.error('[user.ecenter-preferences.update]', error)
    return NextResponse.json({ message: 'E院中心设置暂时无法保存，请稍后重试' }, { status: 503 })
  }
}
