import { requireAdminPage } from '@/components/AdminAccess'
import { getLivePhotoConfig } from '@/lib/live-photo-config-store'
import { publicLivePhotoConfig } from '@/lib/live-photo-config'
import { getLivePhotoStats, listLivePhotoAssetsForAdmin } from '@/lib/live-photo-service'
import { checkFfmpegAvailability } from '@/lib/live-photo-ffmpeg'
import { LivePhotoAdminPanel } from './LivePhotoAdminPanel'

export const dynamic = 'force-dynamic'

export default async function AdminLivePhotoPage() {
  await requireAdminPage('/admin/live-photo', 'site_config_manage')
  const [config, stats, assets, mediaTools] = await Promise.all([
    getLivePhotoConfig(),
    getLivePhotoStats(),
    listLivePhotoAssetsForAdmin(),
    checkFfmpegAvailability(),
  ])
  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <LivePhotoAdminPanel
        initialConfig={config}
        initialPublicConfig={publicLivePhotoConfig(config)}
        stats={stats}
        assets={assets.map((asset) => ({ ...asset, createdAt: asset.createdAt.toISOString() }))}
        mediaTools={mediaTools}
      />
    </main>
  )
}
