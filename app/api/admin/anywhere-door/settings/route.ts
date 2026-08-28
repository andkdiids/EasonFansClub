import { NextResponse } from 'next/server'
import { getInstagramProviderStatus } from '@/lib/instagram/factory'
import { requireAdmin } from '@/lib/security'

export async function GET() {
  const guard = await requireAdmin('social_manage')
  if (!guard.user) return guard.response
  const status = getInstagramProviderStatus()
  return NextResponse.json({
    settings: {
      provider: status.provider,
      target: status.target,
      browserEnabled: status.browserEnabled,
      directFallback: status.directFallback,
      proxyConfigured: status.proxyConfigured,
      mediaProxyConfigured: status.mediaProxyConfigured,
      mediaProxyType: status.mediaProxyType,
      externalProviderCredentialsConfigured: status.brightDataConfigured || status.apifyConfigured,
      mediaHostAllowlistConfigured: Boolean(process.env.IG_ALLOWED_MEDIA_HOSTS?.trim()),
      maxImageMb: Number(process.env.IG_MAX_IMAGE_MB || 20),
      maxVideoMb: Number(process.env.IG_MAX_VIDEO_MB || 500),
      editableAtRuntime: false,
    },
  }, { headers: { 'Cache-Control': 'private, no-store, max-age=0' } })
}
