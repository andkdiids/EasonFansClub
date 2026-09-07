import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { moveHeroSlide, type HeroMoveDirection } from '@/lib/hero-order'
import { clearSiteAppearanceCache, defaultSiteAppearance, mergeSiteAppearanceConfig, toPublicSiteAppearance } from '@/lib/site-config'
import { prisma } from '@/lib/prisma'
import { requireAdmin } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const noStoreHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }

function isDirection(value: unknown): value is HeroMoveDirection {
  return value === 'up' || value === 'down'
}

function parseStoredAppearance(value: string | undefined) {
  if (!value) return defaultSiteAppearance
  try {
    return mergeSiteAppearanceConfig(JSON.parse(value))
  } catch {
    return defaultSiteAppearance
  }
}

export async function POST(request: Request) {
  const guard = await requireAdmin('home_manage')
  if (!guard.user) return guard.response

  const body = await request.json().catch(() => null)
  const index = typeof body?.index === 'number' ? body.index : Number(body?.index)
  const direction = body?.direction
  if (!Number.isInteger(index) || index < 0 || !isDirection(direction)) {
    return NextResponse.json({ message: 'Hero 移动参数不正确' }, { status: 400 })
  }

  const result = await prisma.$transaction(async (tx) => {
    // SiteSetting stores the complete appearance JSON. Lock the row so two
    // rapid move requests cannot read the same old order and overwrite one
    // another with conflicting swaps.
    const locked = await tx.$queryRaw<Array<{ value: string }>>`
      SELECT \`value\` FROM \`SiteSetting\` WHERE \`key\` = ${'site.appearance'} FOR UPDATE
    `
    const current = parseStoredAppearance(locked[0]?.value)
    const moved = moveHeroSlide(current.heroSlides, index, direction)
    if (!moved.moved) {
      return { config: current, moved: false }
    }

    const config = mergeSiteAppearanceConfig({ ...current, heroSlides: moved.slides })
    await tx.siteSetting.upsert({
      where: { key: 'site.appearance' },
      update: { value: JSON.stringify(config), valueType: 'JSON', group: 'appearance', label: '首页 Hero 配置' },
      create: { key: 'site.appearance', value: JSON.stringify(config), valueType: 'JSON', group: 'appearance', label: '首页 Hero 配置' },
    })
    return { config, moved: true }
  })

  if (result.moved) {
    clearSiteAppearanceCache()
    revalidatePath('/community')
    revalidatePath('/welcome')
    revalidatePath('/admin/home')
    revalidatePath('/admin/visuals/home')
  }

  const publicConfig = toPublicSiteAppearance(result.config)
  return NextResponse.json({
    slides: publicConfig.heroSlides,
    moved: result.moved,
    message: result.moved ? 'Hero 顺序已更新' : 'Hero 已经在该方向的边界位置',
  }, { headers: noStoreHeaders })
}
