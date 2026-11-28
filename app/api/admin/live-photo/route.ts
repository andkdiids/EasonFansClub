import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { requireRequestAdmin } from '@/lib/security'
import { getLivePhotoConfig } from '@/lib/live-photo-config-store'
import { normalizeLivePhotoConfig, publicLivePhotoConfig } from '@/lib/live-photo-config'
import { getLivePhotoStats, listLivePhotoAssetsForAdmin } from '@/lib/live-photo-service'
import { checkFfmpegAvailability } from '@/lib/live-photo-ffmpeg'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function GET(request: Request) {
  const guard = await requireRequestAdmin(request, 'site_config_manage')
  if (!guard.user) return guard.response
  const [config, stats, assets, mediaTools] = await Promise.all([
    getLivePhotoConfig(),
    getLivePhotoStats(),
    listLivePhotoAssetsForAdmin(),
    checkFfmpegAvailability(),
  ])
  return NextResponse.json({ config, publicConfig: publicLivePhotoConfig(config), stats, assets, mediaTools }, { headers: noStore })
}

export async function PATCH(request: Request) {
  const guard = await requireRequestAdmin(request, 'site_config_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ message: '配置格式不正确' }, { status: 400 })
  }
  const { saveLivePhotoConfig } = await import('@/lib/live-photo-config-store')
  const next = body.reset ? undefined : normalizeLivePhotoConfig(body.config)
  const config = await saveLivePhotoConfig(next ?? normalizeLivePhotoConfig({}), guard.user.id, body.reset ? '恢复默认配置' : '更新实况照片配置')
  revalidatePath('/admin/live-photo')
  revalidatePath('/posts/new')
  return NextResponse.json({ config: publicLivePhotoConfig(config), message: '实况照片配置已保存' }, { headers: noStore })
}
