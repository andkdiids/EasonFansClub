import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { defaultSiteAppearance } from '@/lib/site-config'
import { requireAdmin } from '@/lib/security'

const revalidateTargets = ['/', '/login', '/register', '/checkin', '/music', '/activities', '/achievements', '/culture', '/admin', '/admin/appearance']

export async function GET() {
  const guard = await requireAdmin('site_config_manage')
  if (!guard.user) return guard.response

  const setting = await prisma.siteSetting.findUnique({
    where: { key: 'site.appearance' },
    select: { value: true },
  })

  return NextResponse.json({
    config: setting?.value ? JSON.parse(setting.value) : defaultSiteAppearance,
  })
}

export async function PATCH(request: Request) {
  const guard = await requireAdmin('site_config_manage')
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  const config = body?.reset ? defaultSiteAppearance : body?.config
  if (!config || typeof config !== 'object') {
    return NextResponse.json({ message: '配置格式不正确' }, { status: 400 })
  }

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

  revalidateTargets.forEach((path) => revalidatePath(path))

  return NextResponse.json({ config, message: '配置已保存' })
}
