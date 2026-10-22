import { NextResponse } from 'next/server'
import { getProfileVisibility, isProfileModuleVisible } from '@/lib/user-privacy'
import { getProfileRecordPreferences } from '@/lib/profile-record-preferences'
import { getProfilePostGroupPreviews } from '@/lib/profile-post-group-previews'
import { parseUidParam } from '@/lib/uid'
import { prisma } from '@/lib/prisma'
import { resolveRequestAuth } from '@/lib/security'

type RouteContext = { params: Promise<{ userId: string }> }

export async function GET(request: Request, context: RouteContext) {
  const { userId } = await context.params
  const uid = parseUidParam(userId)
  if (uid === null) return NextResponse.json({ message: '用户不存在' }, { status: 404 })

  const auth = await resolveRequestAuth(request)
  if (auth.response) return auth.response
  const [viewer, target] = await Promise.all([
    Promise.resolve(auth.user),
    prisma.user.findFirst({
      where: { uid, status: 'ACTIVE', isDeleted: false, Profile: { isNot: null } },
      select: { id: true },
    }),
  ])
  if (!target) return NextResponse.json({ message: '用户不存在' }, { status: 404 })

  const visibility = await getProfileVisibility(target.id, viewer?.id)
  try {
    if (!isProfileModuleVisible(visibility.settings, 'posts', visibility.isSelf)) {
      return NextResponse.json({ groups: [], visibility: { visible: false } }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' } })
    }
    if (!visibility.isSelf) {
      const preferences = await getProfileRecordPreferences(target.id)
      if (preferences.find((preference) => preference.key === 'posts')?.visible === false) {
        return NextResponse.json({ groups: [], visibility: { visible: false } }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' } })
      }
    }
    const groups = await getProfilePostGroupPreviews(target.id, viewer?.id === target.id)
    return NextResponse.json({ groups, visibility: { visible: true } }, { headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' } })
  } catch (error) {
    console.error('[userPostGroups.list]', { userId: target.id, error })
    return NextResponse.json({ message: '个人合集暂时无法加载，请稍后重试' }, { status: 503, headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie, Authorization' } })
  }
}
