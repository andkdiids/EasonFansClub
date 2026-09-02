import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  getDefaultPageLayoutConfig,
  getPageLayoutRegistry,
  isEditablePageLayoutPageKey,
  PAGE_LAYOUT_REGISTRY,
  PAGE_MODULE_REGISTRY,
} from '../lib/page-layout/registry'
import { compactPageLayoutItems } from '../lib/page-layout/normalize'
import {
  collectPageLayoutWarnings,
  PageLayoutValidationError,
  repairPageLayoutConfig,
  validatePageLayoutConfig,
} from '../lib/page-layout/validation'
import { pageLayoutPageKeys, type PageLayoutConfig, type PageLayoutDevice, type PageLayoutGridItem } from '../lib/page-layout/types'

function cloneConfig(config: PageLayoutConfig): PageLayoutConfig {
  return JSON.parse(JSON.stringify(config)) as PageLayoutConfig
}

function overlaps(a: PageLayoutGridItem, b: PageLayoutGridItem) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function assertNoVisibleOverlap(config: PageLayoutConfig, device: PageLayoutDevice) {
  const visible = config[device].filter((item) => item.visible && !item.isHidden)
  for (let index = 0; index < visible.length; index += 1) {
    for (const other of visible.slice(index + 1)) {
      assert.equal(overlaps(visible[index].grid[device], other.grid[device]), false, `${device}: ${visible[index].key} overlaps ${other.key}`)
    }
  }
}

test('页面与模块只由共享 Registry 驱动', () => {
  assert.deepEqual(PAGE_LAYOUT_REGISTRY.map((page) => page.key), pageLayoutPageKeys.filter((page) => page !== 'home'))
  assert.equal(isEditablePageLayoutPageKey('home'), false)
  assert.equal(isEditablePageLayoutPageKey('checkin'), true)
  assert.equal(new Set(PAGE_LAYOUT_REGISTRY.map((page) => page.key)).size, PAGE_LAYOUT_REGISTRY.length)
  assert.equal(new Set(PAGE_MODULE_REGISTRY.map((module) => module.key)).size, PAGE_MODULE_REGISTRY.length)

  for (const definition of PAGE_MODULE_REGISTRY) {
    assert.ok(definition.page === 'home' || PAGE_LAYOUT_REGISTRY.some((page) => page.key === definition.page), `${definition.key} references an unregistered page`)
    assert.ok(definition.componentKey, `${definition.key} has no component identity`)
    assert.ok(definition.name, `${definition.key} has no administrator-facing name`)
    assert.ok(definition.category, `${definition.key} has no category`)
    assert.ok(definition.heightMode === 'AUTO' || definition.heightMode === 'FIXED', `${definition.key} has no height mode`)
  }
})

test('默认布局在每个设备上覆盖 Registry 且没有可见重叠', () => {
  for (const page of PAGE_LAYOUT_REGISTRY) {
    const config = getDefaultPageLayoutConfig(page.key)
    for (const device of pageLayoutPageKeys.length ? (['desktop', 'tablet', 'mobile'] as const) : []) {
      const supported = getPageLayoutRegistry(page.key).filter((module) => (
        device === 'desktop' ? module.supportsDesktop : device === 'tablet' ? module.supportsTablet : module.supportsMobile
      ))
      assert.deepEqual(config[device].map((item) => item.key), supported.map((module) => module.key), `${page.key}/${device} registry mismatch`)
      assertNoVisibleOverlap(config, device)
    }
  }
})

test('严格保存拒绝可见模块重叠，读取旧布局时使用同一整理规则修复', () => {
  const broken = cloneConfig(getDefaultPageLayoutConfig('home'))
  const first = broken.desktop[0]
  const second = broken.desktop[1]
  second.grid.desktop = { ...first.grid.desktop }

  assert.throws(() => validatePageLayoutConfig('home', broken), PageLayoutValidationError)

  const legacy = cloneConfig(broken)
  legacy.desktop.push({
    ...legacy.desktop[0],
    key: 'home.deleted-module',
  })
  legacy.desktop.push({
    ...legacy.desktop[0],
    key: 'home.featuredPosts',
  })
  const repaired = repairPageLayoutConfig('home', legacy)
  assert.equal(repaired.desktop.some((item) => item.key === 'home.deleted-module' || item.key === 'home.featuredPosts'), false)
  assertNoVisibleOverlap(repaired, 'desktop')
  assert.deepEqual(compactPageLayoutItems(repaired.desktop, 'desktop'), repaired.desktop)
  assert.equal(repaired.desktop.some((item) => item.key === 'home.stats'), true)
  const warnings = collectPageLayoutWarnings('home', legacy)
  assert.equal(warnings.some((warning) => warning.key === 'home.deleted-module' && warning.kind === 'UNKNOWN'), true)
  assert.equal(warnings.some((warning) => warning.key === 'home.featuredPosts' && warning.kind === 'DEPRECATED'), true)
})

test('首页使用固定结构，其他页面继续使用真实 PageLayout Renderer', () => {
  const home = readFileSync('components/HomeLayoutSurface.tsx', 'utf8')
  const communityPage = readFileSync('app/community/page.tsx', 'utf8')
  const editor = readFileSync('app/admin/layout-editor/LayoutEditorClient.tsx', 'utf8')
  const renderer = readFileSync('components/page-layout/PageLayoutRenderer.tsx', 'utf8')

  assert.match(home, /<HomeHero/)
  assert.match(home, /home-first-row-data/)
  assert.match(home, /home-secondary-columns/)
  assert.doesNotMatch(home, /PageLayoutConfig|PageLayoutDevice|getPageLayoutModules|layoutConfig|layoutModule|visible\(/)
  assert.doesNotMatch(communityPage, /getPublishedPageLayoutConfig|layoutConfig/)
  assert.doesNotMatch(editor, /HomeLayoutSurface|homeSurface|pageKey === 'home'/)
  assert.match(editor, /<PageLayoutRenderer[\s\S]*mode="editor"/)
  assert.match(renderer, /data-layout-mode="editor"/)
  assert.match(renderer, /data-layout-mode="live"/)
  assert.doesNotMatch(editor, /renderPreviewContent|AdminCanvasRenderer|预览数据已加载/)
})

test('所有支持布局的前台页面都经过共享 PageLayoutRenderer', () => {
  const files = [
    'components/CheckInLayoutSurface.tsx',
    'app/forum/page.tsx',
    'app/music/page.tsx',
    'app/notifications/page.tsx',
    'app/profile/page.tsx',
    'app/admin/page.tsx',
  ]
  for (const file of files) assert.match(readFileSync(file, 'utf8'), /PageLayoutRenderer/)
  assert.doesNotMatch(readFileSync('components/HomeLayoutSurface.tsx', 'utf8'), /PageLayoutRenderer/)
})
