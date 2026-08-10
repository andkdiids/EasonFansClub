import { revalidatePath } from 'next/cache'
import { NextResponse } from 'next/server'
import { clearSiteAppearanceCache, getSiteAppearance, mergeSiteAppearanceConfig, normalizeHeroMediaAsset, heroFitModes, type HeroFitMode, type HeroMediaAsset, type SiteHeroSlide } from '@/lib/site-config'
import { normalizeHeroMediaType, normalizeHeroScale } from '@/lib/hero-visuals'
import { prisma } from '@/lib/prisma'
import { requireAdmin, sanitizeText } from '@/lib/security'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const noStoreHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }

function normalizeSlides(value: unknown): SiteHeroSlide[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, 20).map((item, index) => {
    const row = item && typeof item === 'object' ? item as Partial<SiteHeroSlide> : {}
    const mediaType = normalizeHeroMediaType(row.mediaType)
    const imageUrl = sanitizeText(row.imageUrl, 1000)
    const mediaUrl = sanitizeText(row.mediaUrl, 1000) || (mediaType === 'STATIC_IMAGE' ? imageUrl : '')
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
    const normalizeAsset = (value: unknown): HeroMediaAsset | null | undefined => {
      if (value === undefined) return undefined
      if (value === null) return null
      const asset = value && typeof value === 'object' ? value as Partial<HeroMediaAsset> : {}
      return normalizeHeroMediaAsset({
        mediaType: asset.mediaType,
        imageUrl: sanitizeText(asset.imageUrl, 1000),
        mediaUrl: sanitizeText(asset.mediaUrl, 1000),
        posterUrl: sanitizeText(asset.posterUrl, 1000),
        sourceUrl: sanitizeText(asset.sourceUrl, 1000),
        posterSourceUrl: sanitizeText(asset.posterSourceUrl, 1000),
      }, null)
    }
    const desktopHeroMedia = normalizeAsset(row.desktopHeroMedia)
    const mobileHeroMedia = normalizeAsset(row.mobileHeroMedia)
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
      ...(desktopHeroMedia === undefined ? {} : { desktopHeroMedia }),
      ...(mobileHeroMedia === undefined ? {} : { mobileHeroMedia }),
      isVisible: Boolean(row.isVisible),
      sortOrder: Number.isFinite(Number(row.sortOrder)) ? Number(row.sortOrder) : index + 1,
    }
  })
}

export async function GET() {
  const guard = await requireAdmin('home_manage')
  if (!guard.user) return guard.response
  const config = await getSiteAppearance({ cache: 'no-store' })
  return NextResponse.json({ slides: [...config.heroSlides].sort((a, b) => a.sortOrder - b.sortOrder) }, { headers: noStoreHeaders })
}

export async function PATCH(request: Request) {
  const guard = await requireAdmin('home_manage')
  if (!guard.user) return guard.response
  const body = await request.json().catch(() => null)
  const slides = normalizeSlides(body?.slides)
  if (!slides.length) return NextResponse.json({ message: '至少保留一张 Hero 配置' }, { status: 400 })
  const current = await getSiteAppearance({ cache: 'no-store' })
  const config = mergeSiteAppearanceConfig({ ...current, heroSlides: slides })
  await prisma.siteSetting.upsert({
    where: { key: 'site.appearance' },
    update: { value: JSON.stringify(config), valueType: 'JSON', group: 'appearance', label: '首页 Hero 配置' },
    create: { key: 'site.appearance', value: JSON.stringify(config), valueType: 'JSON', group: 'appearance', label: '首页 Hero 配置' },
  })
  clearSiteAppearanceCache()
  revalidatePath('/community')
  revalidatePath('/welcome')
  revalidatePath('/admin/home')
  revalidatePath('/admin/visuals/home')
  return NextResponse.json({ slides: config.heroSlides, message: '首页 Hero 已保存' })
}
