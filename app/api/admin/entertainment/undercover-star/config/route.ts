import { rejectInvalidRequestOrigin, requireAdmin } from '@/lib/security'
import { getUndercoverAdminOverview, getUndercoverConfig, saveUndercoverConfig } from '@/lib/undercover-star'
import { undercoverError, undercoverOk } from '@/lib/undercover-star-api'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return guard.response
  try {
    const [config, overview] = await Promise.all([getUndercoverConfig(), getUndercoverAdminOverview()])
    return undercoverOk({ config, overview })
  } catch (error) {
    return undercoverError(error, '暂时无法加载卧底巨星后台数据。')
  }
}

export async function PUT(request: Request) {
  const originError = rejectInvalidRequestOrigin(request)
  if (originError) return originError
  const guard = await requireAdmin('entertainment_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null) as { enabled?: unknown } | null
  try {
    const current = await getUndercoverConfig()
    const config = await saveUndercoverConfig({ enabled: typeof body?.enabled === 'boolean' ? body.enabled : current.enabled })
    return undercoverOk({ config, overview: await getUndercoverAdminOverview() })
  } catch (error) {
    return undercoverError(error, '保存卧底巨星设置失败。')
  }
}
