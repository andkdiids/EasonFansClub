import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { STUDIO_TOOLS, getAvailableStudioTools, getVisibleStudioTools } from '../lib/studio/tools'
import { applyFloydSteinberg, deltaE2000, findNearestBeadColor, hexToRgb, quantizeColors, rgbToLab } from '../lib/studio/beads/color'
import { defaultBeadSettings, createDefaultLayerStack, isValidBeadDimensions, normalizeBeadProjectData } from '../lib/studio/beads/compat'
import { findPaletteColorByCode, getDefaultPalette, getPalette, getPaletteCoverage, getPaletteModeDefinition, MARD_221_PALETTE_REGISTRY, MARD_221_SOURCE, MARD_221_SOURCE_EXCEPTIONS, normalizePaletteCode, PALETTE_MODES, PALETTE_REGISTRY, PALETTE_SOURCE } from '../lib/studio/beads/palette'
import { generatePatternFromPixels } from '../lib/studio/beads/image'
import { EMPTY_CELL } from '../lib/studio/beads/types'
import { calculateMaterialList, createDemoPattern, floodFill, removeTinyColorRegions, replaceColor, splitIntoBoards } from '../lib/studio/beads/grid'
import { createBeadPatternPdf } from '../lib/studio/beads/pdf'
import { patternCellColor, renderPatternToDataUrl } from '../lib/studio/beads/renderer'
import { isTrustedShareCardDataUrl, shareCardApiPath } from '../lib/share-card'

const read = (path: string) => readFileSync(path, 'utf8')

function paletteRegistryId(color: { brand: string; series: string; code: string }) {
  return `${color.brand}:${color.series}:${color.code}`
}

function pdfRgbCommand(hex: string) {
  const value = Number.parseInt(hex.slice(1), 16)
  const r = ((value >> 16) & 255) / 255
  const g = ((value >> 8) & 255) / 255
  const b = (value & 255) / 255
  return `${r.toFixed(4)} ${g.toFixed(4)} ${b.toFixed(4)} rg`
}

test('贝多芬与我平台入口和工具注册表集中且可扩展', () => {
  const beads = STUDIO_TOOLS.find((tool) => tool.slug === 'beads')
  assert.equal(beads?.name, '拼豆图纸')
  assert.equal(beads?.route, '/studio/beads')
  assert.equal(beads?.requiresLogin, false)
  assert.equal(getVisibleStudioTools().some((tool) => tool.status === 'DISABLED'), false)
  assert.equal(getAvailableStudioTools().some((tool) => tool.slug === 'beads'), true)
  assert.match(read('app/studio/page.tsx'), /贝多芬与我/)
  assert.match(read('components/studio/StudioToolShell.tsx'), /导出/)
  assert.doesNotMatch(read('components/studio/StudioHome.tsx'), /创意工坊|Creative Studio|AI 创作中心|AI 工坊/)
})

test('颜色空间和 CIEDE2000 标准样例正确', () => {
  const first = { L: 50, a: 2.6772, b: -79.7751 }
  const second = { L: 50, a: 0, b: -82.7485 }
  assert.ok(Math.abs(deltaE2000(first, second) - 2.0425) < 0.0002)
  const white = rgbToLab({ r: 255, g: 255, b: 255 })
  assert.ok(Math.abs(white.L - 100) < 0.01)
  assert.ok(Math.abs(white.a) < 0.02)
  assert.ok(Math.abs(white.b) < 0.02)
})

test('Palette Registry 提供 48 / 96 / 221 档位并保留旧 MARD/291 数据', () => {
  assert.deepEqual(PALETTE_MODES.map((mode) => [mode.id, mode.targetCount]), [['standard', 48], ['expert', 96], ['complete', 221]])
  assert.equal(PALETTE_SOURCE, 'EXISTING')
  assert.equal(PALETTE_REGISTRY.length, 245)
  assert.equal(MARD_221_PALETTE_REGISTRY.length, 221)
  assert.equal(MARD_221_SOURCE, 'VERIFIED')
  assert.ok(PALETTE_REGISTRY.every((color) => color.code && color.name && /^#[0-9A-F]{6}$/.test(color.hex) && color.rgb && color.lab && typeof color.enabled === 'boolean' && Array.isArray(color.groups)))
  assert.equal(new Set(MARD_221_PALETTE_REGISTRY.map((color) => color.code)).size, 221)
  assert.deepEqual(Object.fromEntries([...new Set(MARD_221_PALETTE_REGISTRY.map((color) => color.originalCode?.[0]))].map((series) => [series, MARD_221_PALETTE_REGISTRY.filter((color) => color.originalCode?.startsWith(series || '')).length])), { A: 26, B: 32, C: 29, D: 26, E: 24, F: 25, G: 21, H: 23, M: 15 })
  const mard221 = getPalette('MARD', '221', 'complete')
  for (const [code, hex, rgb] of [['A1', '#FAF5CD', { r: 250, g: 245, b: 205 }], ['B1', '#DFF139', { r: 223, g: 241, b: 57 }], ['C1', '#FFFEE4', { r: 255, g: 254, b: 228 }], ['D1', '#ACB7EF', { r: 172, g: 183, b: 239 }], ['E1', '#F6D4CB', { r: 246, g: 212, b: 203 }], ['F1', '#FF9280', { r: 255, g: 146, b: 128 }], ['G1', '#FFEAD3', { r: 255, g: 234, b: 211 }], ['H1', '#FBFBFB', { r: 251, g: 251, b: 251 }], ['M1', '#BBC6B6', { r: 187, g: 198, b: 182 }]] as const) {
    const color = findPaletteColorByCode(mard221, code)
    assert.equal(color?.hex, hex)
    assert.deepEqual(color?.rgb, rgb)
  }
  for (const color of MARD_221_PALETTE_REGISTRY) {
    assert.deepEqual(color.rgb, hexToRgb(color.hex))
    const expectedLab = rgbToLab(color.rgb)
    assert.ok(Math.abs(color.lab.L - expectedLab.L) < 0.00001)
    assert.ok(Math.abs(color.lab.a - expectedLab.a) < 0.00001)
    assert.ok(Math.abs(color.lab.b - expectedLab.b) < 0.00001)
  }
  assert.ok(MARD_221_PALETTE_REGISTRY.every((color) => color.originalCode && color.displayCode === color.code && color.brandCode === color.originalCode && color.source === 'verified'))
  for (const exception of MARD_221_SOURCE_EXCEPTIONS) assert.deepEqual(findPaletteColorByCode(mard221, exception.code)?.rgb, exception.canonicalRgb)
  assert.equal(getPaletteModeDefinition('standard').targetCount, 48)
  assert.equal(getPaletteModeDefinition('expert').targetCount, 96)
  assert.equal(getPaletteModeDefinition('complete').targetCount, 221)
  assert.equal(getPaletteCoverage('standard').requested, 48)
  assert.equal(getPaletteCoverage('standard', 'MARD', '221').available, 48)
  assert.equal(getPaletteCoverage('complete', 'MARD', '221').available, 221)
  assert.equal(getPaletteCoverage('complete', 'MARD', '221').source, 'VERIFIED')
  assert.equal(getPalette('MARD', '291', 'standard').length, 24)
  assert.equal(getPalette('MARD', '291', 'expert').length, 24)
  assert.equal(getPalette('MARD', '291', 'complete').length, 24)
  assert.equal(getPalette('MARD', '221', 'standard').length, 48)
  assert.equal(getPalette('MARD', '221', 'expert').length, 96)
  assert.equal(getPalette('MARD', '221', 'complete').length, 221)
})

test('MARD 221 的 brand+series+code ID 唯一且 A1/A01 只做输入兼容', () => {
  const registryIds = PALETTE_REGISTRY.map(paletteRegistryId)
  assert.equal(new Set(registryIds).size, registryIds.length)

  const mard221 = getPalette('MARD', '221', 'complete')
  const mard291 = getPalette('MARD', '291', 'complete')
  const mard221A1 = findPaletteColorByCode(mard221, ' A1 ')
  const mard221A01 = findPaletteColorByCode(mard221, 'A01')
  const mard291A01 = findPaletteColorByCode(mard291, 'A01')
  assert.ok(mard221A1)
  assert.equal(mard221A1, mard221A01)
  assert.equal(mard221A1?.code, 'A01')
  assert.equal(mard221A1?.originalCode, 'A1')
  assert.equal(paletteRegistryId(mard221A1!), 'MARD:221:A01')
  assert.equal(paletteRegistryId(mard291A01!), 'MARD:291:A01')
  assert.notEqual(paletteRegistryId(mard221A1!), paletteRegistryId(mard291A01!))
  assert.equal(normalizePaletteCode(' A1 '), 'A1')
  assert.equal(normalizePaletteCode(' a01 '), 'A01')

  const pickerSearch = (query: string) => {
    const normalizedQuery = normalizePaletteCode(query)
    return mard221.filter((color) => [color.code, color.brandCode || '', color.originalCode || '', color.displayCode || '', color.name, color.hex, `${color.rgb.r} ${color.rgb.g} ${color.rgb.b}`, ...color.groups]
      .some((value) => normalizePaletteCode(value).includes(normalizedQuery)))
  }
  assert.ok(pickerSearch('A1').some((color) => color.code === 'A01'))
  assert.ok(pickerSearch('A01').some((color) => color.code === 'A01'))
  assert.equal(mard221.every((color) => color.brand === 'MARD' && color.series === '221'), true)
  assert.equal(mard221.length, 221)

  const picker = read('components/studio/BeadPalettePicker.tsx')
  const editor = read('components/studio/StudioBeadsTool.tsx')
  assert.match(picker, /color\.brandCode/)
  assert.match(picker, /color\.originalCode/)
  assert.match(picker, /color\.displayCode/)
  assert.match(picker, /color\.hex/)
  assert.match(picker, /color\.rgb\.r/)
  assert.match(editor, /value=\{settings\.brand\}/)
  assert.match(editor, /value=\{settings\.series\}/)
  assert.match(editor, /<BeadPalettePicker palette=\{palette\}/)
})

test('手动色号输入 trim / 大小写归一化且非法色号不 fallback', () => {
  const palette = getDefaultPalette()
  assert.equal(normalizePaletteCode('  a04  '), 'A04')
  assert.equal(findPaletteColorByCode(palette, '  a04  ')?.code, 'A04')
  assert.equal(findPaletteColorByCode(palette, 'A99'), null)
  const mard221 = getPalette('MARD', '221', 'complete')
  assert.equal(findPaletteColorByCode(mard221, ' a1 ')?.code, 'A01')
  assert.equal(findPaletteColorByCode(mard221, 'A01')?.originalCode, 'A1')
  assert.equal(findPaletteColorByCode(mard221, 'm15')?.code, 'M15')
  assert.equal(findPaletteColorByCode(mard221, 'A99'), null)
  const perler = getPalette('Perler', 'Standard', 'standard')
  assert.equal(findPaletteColorByCode(perler, 'A04')?.code, 'A04')
})

test('选择 MARD 221 后生成、匹配和材料统计均限制在当前 221 色板', () => {
  const palette = getPalette('MARD', '221', 'complete')
  const sourceIndexes = [0, 25, 47, 95, 120, 150, 180, 220]
  const samples = sourceIndexes.map((index) => ({ ...palette[index].rgb }))
  const transparent = new Array<boolean>(samples.length).fill(false)
  const settings = { ...defaultBeadSettings, brand: 'MARD' as const, series: '221', width: 4, height: 2, maxColors: 0 as const, cleanupThreshold: 0 as const }
  for (const matchingMode of ['fast', 'balanced', 'precise'] as const) {
    const pattern = generatePatternFromPixels(samples, transparent, { ...settings, matchingMode }, palette)
    assert.deepEqual(pattern.palette, palette)
    assert.equal(pattern.cells.length, samples.length)
    assert.equal(pattern.cells.every((index) => sourceIndexes.includes(index)), true)
    const summary = calculateMaterialList(pattern)
    assert.equal(summary.totalBeads, samples.length)
    assert.equal(summary.materials.every((material) => material.brand === 'MARD' && material.series === '221' && palette.some((color) => color.code === material.code)), true)
  }
})

test('MARD 221 真实像素图生成后的 PNG / PDF 颜色一致', async () => {
  const palette = getPalette('MARD', '221', 'complete')
  const sourceIndexes = [0, 25, 47, 95, 120, 150, 180, 220]
  const samples = sourceIndexes.map((index) => ({ ...palette[index].rgb }))
  const transparent = new Array<boolean>(samples.length).fill(false)
  const settings = { ...defaultBeadSettings, brand: 'MARD' as const, series: '221', width: 4, height: 2, maxColors: 0 as const, cleanupThreshold: 0 as const, matchingMode: 'balanced' as const }
  const pattern = generatePatternFromPixels(samples, transparent, settings, palette)
  const expectedColors = pattern.cells.map((index) => patternCellColor(pattern, index)).filter((color): color is string => Boolean(color))

  const fills: string[] = []
  const context = {
    fillStyle: '',
    globalAlpha: 1,
    clearRect() {},
    fillRect() { fills.push(context.fillStyle) },
  }
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => context,
    toDataURL: () => 'data:image/png;base64,MARD221-validation',
  } as unknown as HTMLCanvasElement
  const renderOptions = { transparentBackground: true, displayGrid: false, displayBoardLines: false }
  const globalWithDocument = globalThis as typeof globalThis & { document?: unknown }
  const hadDocument = Object.prototype.hasOwnProperty.call(globalWithDocument, 'document')
  const previousDocument = globalWithDocument.document
  Object.defineProperty(globalWithDocument, 'document', { configurable: true, value: { createElement: () => canvas } })
  try {
    assert.equal(renderPatternToDataUrl(pattern, renderOptions), 'data:image/png;base64,MARD221-validation')
  } finally {
    if (hadDocument) Object.defineProperty(globalWithDocument, 'document', { configurable: true, value: previousDocument })
    else Reflect.deleteProperty(globalWithDocument, 'document')
  }
  assert.deepEqual(fills, expectedColors)

  const pdf = createBeadPatternPdf(pattern, 'MARD 221 validation')
  const pdfText = new TextDecoder().decode(new Uint8Array(await pdf.arrayBuffer()))
  for (const hex of new Set(expectedColors)) assert.ok(pdfText.includes(pdfRgbCommand(hex)), `PDF 未包含 ${hex} 的颜色命令`)
})

test('量化和 Floyd–Steinberg 输出受当前色板约束', () => {
  const palette = getDefaultPalette()
  const colors = Array.from({ length: 64 }, (_, index) => ({ r: (index * 41) % 256, g: (index * 83) % 256, b: (index * 127) % 256 }))
  assert.ok(quantizeColors(colors, 8).length <= 8)
  const indexes = applyFloydSteinberg(colors, 8, 8, palette, 'precise')
  assert.equal(indexes.length, colors.length)
  assert.equal(indexes.every((index) => index >= 0 && index < palette.length), true)
})

test('LAB 最近色 deterministic，图片转图纸只输出当前 Palette 索引', () => {
  const palette = getDefaultPalette()
  const settings = { ...defaultBeadSettings, width: 8, height: 8, maxColors: 8 as const, cleanupThreshold: 0 as const }
  const samples = Array.from({ length: 64 }, (_, index) => ({ r: (index * 37) % 256, g: (index * 71) % 256, b: (index * 113) % 256 }))
  const transparent = new Array<boolean>(samples.length).fill(false)
  const first = generatePatternFromPixels(samples, transparent, settings, palette)
  const second = generatePatternFromPixels(samples, transparent, settings, palette)
  assert.deepEqual(first.cells, second.cells)
  assert.ok(first.cells.every((index) => index === EMPTY_CELL || (index >= 0 && index < palette.length)))
  assert.equal(findNearestBeadColor({ r: 34, g: 87, b: 145 }, palette, 'balanced'), findNearestBeadColor({ r: 34, g: 87, b: 145 }, palette, 'balanced'))
})

test('102×102 尺寸边界和 legacy → current 兼容归一化', () => {
  assert.equal(isValidBeadDimensions(102, 102), true)
  assert.equal(isValidBeadDimensions(103, 102), false)
  const palette = getDefaultPalette()
  const legacy = {
    version: 1,
    tool: 'beads' as const,
    settings: { ...defaultBeadSettings },
    pattern: { width: 29, height: 29, palette: palette.map(({ code, name, hex }) => ({ code, name, hex })), cells: new Array(29 * 29).fill(0) },
    completed: [],
  }
  const normalized = normalizeBeadProjectData(legacy)
  assert.equal(normalized?.version, 2)
  assert.deepEqual(normalized?.layers.layers.map((layer) => layer.id), ['beads', 'reference'])
  assert.equal(normalizeBeadProjectData({ ...legacy, version: 2, pattern: { ...legacy.pattern, width: 103, cells: new Array(103 * 29).fill(0) } }), null)
  const legacyOversize = normalizeBeadProjectData({ ...legacy, pattern: { ...legacy.pattern, width: 103, cells: new Array(103 * 29).fill(0) } })
  assert.equal(legacyOversize?.legacyOversize, true)
  assert.equal(normalizeBeadProjectData(legacyOversize)?.legacyOversize, true)
})

test('参考图层独立于材料统计，默认隐藏配置不影响网格', () => {
  const stack = createDefaultLayerStack()
  assert.equal(stack.activeLayerId, 'beads')
  assert.equal(stack.layers.find((layer) => layer.id === 'reference')?.kind, 'reference-image')
  assert.equal(stack.layers.find((layer) => layer.id === 'reference' && layer.kind === 'reference-image')?.opacity, 40)
  const pattern = createDemoPattern(getDefaultPalette(), 102, 102)
  const summary = calculateMaterialList(pattern)
  assert.equal(summary.totalCells, 102 * 102)
  assert.equal(summary.totalBeads + summary.emptyCells, 102 * 102)
})

test('Pattern Grid、材料统计、换色、填充和零碎颜色清理保持同步', () => {
  const palette = getDefaultPalette()
  const pattern = createDemoPattern(palette, 29, 29)
  const summary = calculateMaterialList(pattern, 500)
  assert.equal(summary.totalBeads + summary.emptyCells, 29 * 29)
  assert.equal(summary.boardCount, 1)
  const filled = floodFill([0, 0, 1, 0, 0, 1, 1, 1], 4, 2, 0, 2)
  assert.deepEqual(filled, [2, 2, 1, 0, 2, 1, 1, 1])
  assert.deepEqual(replaceColor([0, 1, 0, -1], 0, 3), [3, 1, 3, -1])
  assert.deepEqual(removeTinyColorRegions([1, 1, 2, 1], 4, 1, 1), [1, 1, 1, 1])
})

test('29×29 底板拆分覆盖标准尺寸和全局坐标范围', () => {
  const palette = getDefaultPalette()
  for (const [width, height, count] of [[29, 29, 1], [58, 29, 2], [58, 58, 4], [87, 58, 6], [87, 87, 9]] as const) {
    const pattern = { width, height, palette, cells: new Array(width * height).fill(0) }
    assert.equal(calculateMaterialList(pattern).boardCount, count)
    const boards = splitIntoBoards(pattern)
    assert.equal(boards.length, count)
    assert.equal(boards.at(-1)?.xEnd, width)
    assert.equal(boards.at(-1)?.yEnd, height)
  }
})

test('制作模式、导出、移动端和错误提示均由工作台接线', () => {
  const editor = read('components/studio/StudioBeadsTool.tsx')
  const renderer = read('lib/studio/beads/renderer.ts')
  const pdf = read('lib/studio/beads/pdf.ts')
  const css = read('components/studio/studio.module.css')
  assert.match(editor, /setCompleted/)
  assert.match(editor, /project_publish/)
  assert.match(editor, /onClick=\{undo\}/)
  assert.match(editor, /onClick=\{redo\}/)
  assert.match(editor, /toggleFullscreen/)
  assert.match(editor, /requestFullscreen/)
  assert.match(editor, /MAX_BEAD_DIMENSION/)
  assert.match(editor, /passive: false/)
  assert.match(editor, /BeadPalettePicker/)
  assert.match(editor, /<UiIcon name="grid" className={styles\.generateButtonIcon}/)
  assert.match(editor, /generateButtonText/)
  assert.match(editor, /generateHint/)
  assert.match(editor, /onClick={generate}/)
  assert.match(editor, /openReplaceDialog/)
  assert.match(editor, /toolButtonText/)
  assert.match(read('app/api/studio/projects/[projectId]/download/route.ts'), /downloadCount: \{ increment: 1 \}/)
  assert.match(read('app/api/uploads/studio-reference/route.ts'), /uploadSiteImage/)
  assert.match(editor, /transparentBackground/)
  assert.match(editor, /resetCropSettings/)
  assert.match(editor, /rotation/)
  assert.match(editor, /gestureCellsRef/)
  assert.match(editor, /kind: 'craft'/)
  assert.match(editor, /applyCraftSelection/)
  assert.match(renderer, /patternCellColor/)
  assert.match(renderer, /selection/)
  assert.match(renderer, /coordinateStep/)
  assert.match(pdf, /patternCellColor/)
  assert.match(pdf, /startxref/)
  assert.match(css, /env\(safe-area-inset-bottom\)/)
  assert.match(css, /@media \(max-width: 767px\)/)
  assert.match(css, /\.generateButton \{[^}]*height: 52px/)
  assert.match(css, /\.generateButton \{[^}]*max-height: 56px/)
  assert.match(css, /\.generateButtonIcon \{[^}]*width: 20px/)
  assert.match(css, /\.generateHint \{[^}]*margin-top: 10px[^}]*font-size: 12px/)
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*\.generateButton \{[^}]*height: 48px/)
  assert.match(read('lib/studio/beads/image.ts'), /EMPTY_CELL/)
})

test('P3 公开广场、互动、审核和统一分享能力保持在 Studio 层', () => {
  const schema = read('prisma/schema.prisma')
  const gallery = read('components/studio/StudioGallery.tsx')
  const publicProject = read('components/studio/StudioPublicProject.tsx')
  const publicPage = read('app/studio/project/[projectId]/page.tsx')
  const downloadRoute = read('app/api/studio/projects/[projectId]/download/route.ts')
  const interactions = read('lib/studio/interactions.ts')
  const shareService = read('lib/share-card-service.ts')
  assert.match(read('app/studio/gallery/page.tsx'), /listPublicStudioProjects/)
  assert.match(read('app/api/studio/gallery/route.ts'), /export async function GET/)
  assert.match(gallery, /最新|热门/)
  assert.match(gallery, /\/api\/studio\/projects\/.*\$\{kind\}/)
  assert.match(publicProject, /<ShareButton data=\{shareCardData\}/)
  assert.match(publicProject, /toggleInteraction/)
  assert.match(publicProject, /downloadPattern/)
  assert.match(publicProject, /api\/studio\/projects\/.*download/)
  assert.match(publicProject, /createBeadPatternPdf/)
  assert.match(schema, /downloadCount\s+Int\s+@default\(0\)/)
  assert.match(downloadRoute, /downloadCount: \{ increment: 1 \}/)
  assert.match(publicPage, /viewCount: \{ increment: 1 \}/)
  assert.doesNotMatch(publicPage, /downloadCount: \{ increment: 1 \}/)
  assert.match(interactions, /studioProjectLike/)
  assert.match(interactions, /studioProjectFavorite/)
  assert.match(schema, /model StudioProjectLike/)
  assert.match(schema, /model StudioProjectFavorite/)
  assert.match(read('app/admin/studio/page.tsx'), /点赞/)
  assert.match(shareService, /loadStudioShareCardData/)
  assert.equal(shareCardApiPath({ type: 'studio', contentId: 'studio-project-1' }), '/api/studio/projects/studio-project-1/share-card')
  assert.equal(isTrustedShareCardDataUrl('data:image/png;base64,AAAA'), true)
  assert.equal(isTrustedShareCardDataUrl('data:text/html;base64,AAAA'), false)
})
