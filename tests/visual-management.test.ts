import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolveHeroMediaLayout } from '../lib/hero-visuals'
import { defaultSiteAppearance, getHeroMediaForDevice, mergeSiteAppearanceConfig } from '../lib/site-config'

const read = (path: string) => readFileSync(path, 'utf8')

test('页面视觉配置使用 site.appearance JSON，并包含活动中心独立页面键', () => {
  const config = mergeSiteAppearanceConfig({})
  assert.deepEqual(Object.keys(config.heroVisuals), ['login', 'register', 'welcome', 'home', 'activities', 'birthday', 'music'])
  for (const visual of Object.values(config.heroVisuals)) {
    if (visual.key === 'welcome') {
      assert.equal(visual.desktopPositionX, 68)
      assert.equal(visual.desktopPositionY, 33)
      assert.equal(visual.mobilePositionX, 65)
      assert.equal(visual.mobilePositionY, 50)
    } else {
      assert.equal(visual.desktopPositionX, 50)
      assert.equal(visual.desktopPositionY, 50)
      assert.equal(visual.mobilePositionX, 50)
      assert.equal(visual.mobilePositionY, 50)
    }
    assert.equal(visual.desktopScale, 100)
    assert.equal(visual.mobileScale, 100)
    assert.equal(visual.desktopFitMode, 'COVER')
    assert.equal(visual.mobileFitMode, 'COVER')
    assert.equal(visual.focusPoint, null)
  }
  assert.match(read('app/api/admin/appearance/route.ts'), /key: 'site\.appearance'/)
  assert.match(read('app/api/admin/appearance/route.ts'), /requireAdmin\('site_config_manage'\)/)
  assert.ok(defaultSiteAppearance.heroVisuals.login.enabled)
  assert.ok(defaultSiteAppearance.heroVisuals.register.enabled)
  assert.ok(defaultSiteAppearance.heroVisuals.welcome.enabled)
})

test('旧配置会为欢迎页生成一次独立快照，之后不再跟随首页轮播变化', () => {
  const legacy = mergeSiteAppearanceConfig({
    heroSlides: [{ title: '旧首页', subtitle: '', buttonText: '', href: '/', imageUrl: 'old-home', isVisible: true, sortOrder: 1 }],
  })
  assert.equal(legacy.heroVisuals.welcome.imageUrl, 'old-home')

  const afterHomeChange = mergeSiteAppearanceConfig({
    ...legacy,
    heroSlides: [{ title: '新首页', subtitle: '', buttonText: '', href: '/', imageUrl: 'new-home', isVisible: true, sortOrder: 1 }],
  })
  assert.equal(afterHomeChange.heroSlides[0].imageUrl, 'new-home')
  assert.equal(afterHomeChange.heroVisuals.welcome.imageUrl, 'old-home')
})

test('登录、注册和欢迎页分别读取各自视觉配置', () => {
  assert.match(read('app/login/page.tsx'), /heroVisual=\{config\.heroVisuals\.login\}/)
  assert.match(read('app/register/page.tsx'), /heroVisual=\{config\.heroVisuals\.register\}/)
  assert.match(read('app/welcome/page.tsx'), /config\.heroVisuals\.welcome/)
  assert.match(read('components/HomeLayoutSurface.tsx'), /siteConfig\.heroVisuals\.home/)
})

test('HeroBackground 和后台预览共用媒体布局 resolver', () => {
  const component = read('components/HeroBackground.tsx')
  const resolver = read('lib/hero-visuals.ts')
  assert.match(component, /resolveHeroMediaLayout/)
  assert.match(component, /resolveHeroMediaSettings/)
  assert.match(resolver, /desktopFitMode/)
  assert.match(resolver, /mobileFitMode/)
  assert.match(resolver, /CONTAIN/)
  assert.match(resolver, /HERO_SCALE_MIN = 40/)
})

test('超宽图片在自定义缩放下不会被 cover 再次强制放大', () => {
  const full = resolveHeroMediaLayout({ width: 390, height: 250 }, { width: 1536, height: 709 }, { positionX: 50, positionY: 50, scale: 100, fitMode: 'CUSTOM' })
  const reduced = resolveHeroMediaLayout({ width: 390, height: 250 }, { width: 1536, height: 709 }, { positionX: 50, positionY: 50, scale: 60, fitMode: 'CUSTOM' })
  assert.ok(full && reduced)
  assert.ok(reduced.width < full.width)
  assert.ok(reduced.height < full.height)
  assert.ok(reduced.width < 390 || reduced.height < 250)
})

test('后台页面视觉入口提供活动中心设置页面和高清媒体上传', () => {
  const page = read('app/admin/visuals/page.tsx')
  const route = read('app/admin/visuals/[visualKey]/page.tsx')
  const manager = read('app/admin/visuals/VisualManager.tsx')
  const upload = read('app/api/uploads/hero-media/route.ts')
  assert.match(page, /页面视觉设置/)
  assert.match(page, /活动中心背景/)
  assert.match(route, /pageVisualKeys/)
  assert.match(manager, /data-visual-preview=\{device\}/)
  assert.match(manager, /type="range"/)
  assert.match(manager, /desktopPositionX/)
  assert.match(manager, /mobilePositionY/)
  assert.match(manager, /desktopFitMode/)
  assert.match(manager, /mobileScale/)
  assert.match(manager, /\/api\/uploads\/hero-media/)
  assert.match(upload, /quality: 94/)
  assert.match(upload, /MAX_IMAGE_EDGE = 2560/)
  assert.match(upload, /sourceUrl/)
})

test('Hero 后台按设备媒体字段显示，不回退旧媒体或另一端媒体', () => {
  const legacySlide = {
    title: '',
    subtitle: '',
    buttonText: '',
    href: '#',
    imageUrl: 'legacy-image',
    mediaType: 'IMAGE' as const,
    mediaUrl: 'legacy-image',
    posterUrl: '',
    sourceUrl: '',
    posterSourceUrl: '',
    isVisible: true,
    sortOrder: 1,
    desktopHeroMedia: { mediaType: 'ANIMATED_IMAGE' as const, imageUrl: '', mediaUrl: '', posterUrl: '', sourceUrl: '', posterSourceUrl: '' },
    mobileHeroMedia: null,
  }
  assert.equal(getHeroMediaForDevice(legacySlide, 'desktop'), null)
  assert.equal(getHeroMediaForDevice(legacySlide, 'mobile'), null)
  assert.match(read('app/admin/home/HomeHeroManager.tsx'), /const desktopMedia = explicitMedia\(slide, 'desktop'\)/)
  assert.match(read('app/admin/home/HomeHeroManager.tsx'), /const current = selectedMedia\(slide, device\) \|\| emptyHeroMedia\('STATIC_IMAGE'\)/)
  assert.match(read('app/admin/visuals/VisualManager.tsx'), /homePreviewVisual\(editingVisual, homeDesktopMedia, homeMobileMedia\)/)
  assert.match(read('app/admin/visuals/VisualManager.tsx'), /暂无媒体，请选择类型后上传/)
})
