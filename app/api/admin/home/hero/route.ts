import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { clearSiteAppearanceCache, getSiteAppearance, mergeSiteAppearanceConfig, type SiteHeroSlide } from '@/lib/site-config'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

function normalizeSlides(value: unknown): SiteHeroSlide[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 20).map((item, index) => {
    const row = item && typeof item === 'object' ? item as Partial<SiteHeroSlide> : {}
    return {
      title: sanitizeText(row.title, 160),
      subtitle: sanitizeText(row.subtitle, 300),
      buttonText: sanitizeText(row.buttonText, 80),
      href: sanitizeText(row.href, 500) || '#community-content',
      imageUrl: sanitizeText(row.imageUrl, 1000),
      isVisible: Boolean(row.isVisible),
      sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : index + 1,
    }
  })
}

export async function GET() {
  const guard = await requireAdmin('home_manage')
  if (!guard.user) return guard.response
  const config = await getSiteAppearance()
  return NextResponse.json({ slides: [...config.heroSlides].sort((a, b) => a.sortOrder - b.sortOrder) })
}

export async function PATCH(request: Request) {
  const guard = await requireAdmin('home_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  const slides = normalizeSlides(body?.slides)
  if (!slides.length) return NextResponse.json({ message: '至少保留一张 Hero 配置' }, { status: 400 })
  const current = await getSiteAppearance()
  const config = mergeSiteAppearanceConfig({ ...current, heroSlides: slides })
  await prisma.siteSetting.upsert({
    where: { key: 'site.appearance' },
    update: { value: JSON.stringify(config), valueType: 'JSON', group: 'appearance', label: '首页 Hero 配置' },
    create: { key: 'site.appearance', value: JSON.stringify(config), valueType: 'JSON', group: 'appearance', label: '首页 Hero 配置' },
  })
  clearSiteAppearanceCache()
  revalidatePath('/community')
  revalidatePath('/welcome')
  return NextResponse.json({ slides: config.heroSlides, message: '首页 Hero 已保存' })
}
