import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { clearSiteAppearanceCache, getSiteAppearance, mergeSiteAppearanceConfig, heroFitModes, heroMediaTypes, type HeroFitMode, type HeroMediaType, type SiteHeroSlide } from '@/lib/site-config'
import { normalizeHeroScale } from '@/lib/hero-visuals'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

function normalizeSlides(value: unknown): SiteHeroSlide[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 20).map((item, index) => {
    const row = item && typeof item === 'object' ? item as Partial<SiteHeroSlide> : {}
    const mediaType = typeof row.mediaType === 'string' && heroMediaTypes.includes(row.mediaType as HeroMediaType)
      ? row.mediaType as HeroMediaType
      : 'IMAGE'
    const imageUrl = sanitizeText(row.imageUrl, 1000)
    const mediaUrl = sanitizeText(row.mediaUrl, 1000) || (mediaType === 'IMAGE' ? imageUrl : '')
    const optionalPercentage = (input: unknown) => {
      if (input === undefined || input === null || input === '') return undefined
      const numeric = Number(input)
      return Number.isFinite(numeric) ? Math.max(0, Math.min(100, Math.round(numeric))) : undefined
    }
    const optionalScale = (input: unknown) => {
      if (input === undefined || input === null || input === '') return undefined
      return normalizeHeroScale(input)
    }
    const desktopPositionX = optionalPercentage(row.desktopPositionX)
    const desktopPositionY = optionalPercentage(row.desktopPositionY)
    const mobilePositionX = optionalPercentage(row.mobilePositionX)
    const mobilePositionY = optionalPercentage(row.mobilePositionY)
    const desktopScale = optionalScale(row.desktopScale)
    const mobileScale = optionalScale(row.mobileScale)
    const desktopFitMode = typeof row.desktopFitMode === 'string' && heroFitModes.includes(row.desktopFitMode as HeroFitMode)
      ? row.desktopFitMode as HeroFitMode
      : undefined
    const mobileFitMode = typeof row.mobileFitMode === 'string' && heroFitModes.includes(row.mobileFitMode as HeroFitMode)
      ? row.mobileFitMode as HeroFitMode
      : undefined
    return {
      title: sanitizeText(row.title, 160),
      subtitle: sanitizeText(row.subtitle, 300),
      buttonText: sanitizeText(row.buttonText, 80),
      href: sanitizeText(row.href, 500) || '#community-content',
      imageUrl,
      mediaType,
      mediaUrl,
      posterUrl: sanitizeText(row.posterUrl, 1000),
      sourceUrl: sanitizeText(row.sourceUrl, 1000),
      posterSourceUrl: sanitizeText(row.posterSourceUrl, 1000),
      showTitle: row.showTitle !== false,
      showSubtitle: row.showSubtitle !== false,
      showButton: row.showButton !== false,
      ...(desktopPositionX === undefined ? {} : { desktopPositionX }),
      ...(desktopPositionY === undefined ? {} : { desktopPositionY }),
      ...(mobilePositionX === undefined ? {} : { mobilePositionX }),
      ...(mobilePositionY === undefined ? {} : { mobilePositionY }),
      ...(desktopScale === undefined ? {} : { desktopScale }),
      ...(mobileScale === undefined ? {} : { mobileScale }),
      ...(desktopFitMode === undefined ? {} : { desktopFitMode }),
      ...(mobileFitMode === undefined ? {} : { mobileFitMode }),
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
