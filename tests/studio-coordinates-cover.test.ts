import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { coordinateValues } from '../lib/studio/beads/renderer'
import { parseStudioPhysicalCover } from '../lib/studio/physical-cover'

const read = (path: string) => readFileSync(path, 'utf8')

test('拼豆坐标尺从 1 开始并随尺寸和缩放密度变化', () => {
  assert.deepEqual(coordinateValues(29, 24), Array.from({ length: 29 }, (_, index) => index + 1))
  assert.deepEqual(coordinateValues(50, 12), [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50])
  assert.deepEqual(coordinateValues(40, 7), [1, 10, 20, 30, 40])
  assert.equal(coordinateValues(29, 5)[0], 1)
  assert.equal(coordinateValues(29, 5).includes(0), false)
})

test('坐标尺是编辑器覆盖层而不是图纸数据或普通导出内容', () => {
  const editor = read('components/studio/StudioBeadsTool.tsx')
  const renderer = read('lib/studio/beads/renderer.ts')
  const styles = read('components/studio/studio.module.css')
  assert.match(editor, /useState\(true\)/)
  assert.match(editor, /rulerOverlay/)
  assert.match(styles, /\.rulerOverlay[^\n]*pointer-events: none/)
  assert.doesNotMatch(renderer, /fillText\(String\(x \+ 1\)/)
})

test('实物封面允许空值清除但拒绝未授权外部图片地址', () => {
  assert.deepEqual(parseStudioPhysicalCover(undefined), { valid: true })
  assert.deepEqual(parseStudioPhysicalCover(null), { valid: true, value: null })
  assert.equal(parseStudioPhysicalCover('/cos/studio/physical-covers/user/cover.webp').valid, true)
  assert.equal(parseStudioPhysicalCover('https://example.com/not-owned.webp').valid, false)
  assert.match(read('prisma/schema.prisma'), /physicalCoverImage\s+String\?\s+@db\.Text/)
  assert.match(read('app/api/uploads/studio-physical-cover/route.ts'), /uploadSiteImage/)
  assert.match(read('components/studio/StudioPublicProject.tsx'), /实物封面/)
})
