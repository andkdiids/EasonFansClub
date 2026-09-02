import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { STUDIO_TOOLS, getAvailableStudioTools, getVisibleStudioTools } from '../lib/studio/tools'
import { applyFloydSteinberg, deltaE2000, quantizeColors, rgbToLab } from '../lib/studio/beads/color'
import { getDefaultPalette } from '../lib/studio/beads/palette'
import { calculateMaterialList, createDemoPattern, floodFill, removeTinyColorRegions, replaceColor, splitIntoBoards } from '../lib/studio/beads/grid'
import { isTrustedShareCardDataUrl, shareCardApiPath } from '../lib/share-card'

const read = (path: string) => readFileSync(path, 'utf8')

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

test('量化和 Floyd–Steinberg 输出受当前色板约束', () => {
  const palette = getDefaultPalette()
  const colors = Array.from({ length: 64 }, (_, index) => ({ r: (index * 41) % 256, g: (index * 83) % 256, b: (index * 127) % 256 }))
  assert.ok(quantizeColors(colors, 8).length <= 8)
  const indexes = applyFloydSteinberg(colors, 8, 8, palette, 'precise')
  assert.equal(indexes.length, colors.length)
  assert.equal(indexes.every((index) => index >= 0 && index < palette.length), true)
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
  assert.match(read('lib/studio/beads/image.ts'), /EMPTY_CELL/)
})

test('P3 公开广场、互动、审核和统一分享能力保持在 Studio 层', () => {
  const schema = read('prisma/schema.prisma')
  const gallery = read('components/studio/StudioGallery.tsx')
  const publicProject = read('components/studio/StudioPublicProject.tsx')
  const interactions = read('lib/studio/interactions.ts')
  const shareService = read('lib/share-card-service.ts')
  assert.match(read('app/studio/gallery/page.tsx'), /listPublicStudioProjects/)
  assert.match(read('app/api/studio/gallery/route.ts'), /export async function GET/)
  assert.match(gallery, /最新|热门/)
  assert.match(gallery, /\/api\/studio\/projects\/.*\$\{kind\}/)
  assert.match(publicProject, /<ShareButton data=\{shareCardData\}/)
  assert.match(publicProject, /toggleInteraction/)
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
