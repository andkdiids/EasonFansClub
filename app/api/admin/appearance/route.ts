import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { clearSiteAppearanceCache, defaultSiteAppearance, getSiteAppearance, mergeSiteAppearanceConfig } from '@/lib/site-config'
import { requireAdmin } from '@/lib/security'

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
    config: await getSiteAppearance(),
  })
}

export async function PATCH(request: Request) {
  const guard = await requireAdmin('site_config_manage')
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  const rawConfig = body?.reset ? defaultSiteAppearance : body?.config
  if (!rawConfig || typeof rawConfig !== 'object') {
    return NextResponse.json({ message: '配置格式不正确' }, { status: 400 })
  }
  const config = mergeSiteAppearanceConfig(rawConfig)

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

  clearSiteAppearanceCache()
  revalidatePath('/', 'layout')
  revalidateTargets.forEach((path) => revalidatePath(path, 'page'))

  return NextResponse.json({ config, message: '配置已保存' })
}
