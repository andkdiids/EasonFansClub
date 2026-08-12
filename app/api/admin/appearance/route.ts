import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { clearSiteAppearanceCache, defaultSiteAppearance, getSiteAppearance, mergeSiteAppearanceConfig, toPublicSiteAppearance } from '@/lib/site-config'
import { requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const noStoreHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }

const revalidateTargets = [
  '/',
  '/login',
  '/register',
  '/checkin',
  '/music',
  '/activities',
  '/achievements',
  '/culture',
  '/notifications',
  '/friends',
  '/profile',
  '/trending',
  '/search',
  '/admin',
  '/admin/appearance',
  '/admin/visuals',
]

export async function GET() {
  const guard = await requireAdmin('site_config_manage')
  if (!guard.user) return guard.response

  return NextResponse.json({
    config: await getSiteAppearance({ cache: 'no-store' }),
  }, { headers: noStoreHeaders })
}

export async function PATCH(request: Request) {
  const guard = await requireAdmin('site_config_manage')
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  const rawConfig = body?.reset ? defaultSiteAppearance : body?.config
  if (!rawConfig || typeof rawConfig !== 'object') {
    return NextResponse.json({ message: '配置格式不正确' }, { status: 400 })
  }
  let config = mergeSiteAppearanceConfig(rawConfig)

  await prisma.siteSetting.upsert({
    where: { key: 'site.appearance' },
    update: {
      value: JSON.stringify(config),
      valueType: 'JSON',
      group: 'appearance',
      label: '网站外观配置',
    },
    create: {
      key: 'site.appearance',
      value: JSON.stringify(config),
      valueType: 'JSON',
      group: 'appearance',
      label: '网站外观配置',
    },
  })

  config = toPublicSiteAppearance(config)
  clearSiteAppearanceCache()
  revalidatePath('/', 'layout')
  revalidateTargets.forEach((path) => revalidatePath(path, 'page'))

  return NextResponse.json({ config, message: '配置已保存' })
}
