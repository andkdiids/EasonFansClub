import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  createInitialImageEditorState,
  imageEditorDimensions,
  rotateImageEditorPoint,
  rotateImageEditorState,
} from '../lib/image-editor'
import { clientPointToImagePoint, getImageEditorCanvasMetrics } from '../lib/image-editor-browser'

const read = (path: string) => readFileSync(path, 'utf8')

test('图片编辑状态只保存可序列化的编辑操作，并能顺时针旋转坐标', () => {
  const state = {
    ...createInitialImageEditorState(),
    annotations: [{ id: 'arrow-1', type: 'arrow' as const, start: { x: 10, y: 20 }, end: { x: 30, y: 40 }, color: '#ef4444', width: 6 }],
    crop: { x: 5, y: 6, width: 20, height: 30 },
  }
  const rotated = rotateImageEditorState(state, 100, 200)
  assert.deepEqual(imageEditorDimensions(100, 200, rotated.rotation), { width: 200, height: 100 })
  assert.deepEqual(rotateImageEditorPoint({ x: 10, y: 20 }, 100, 200), { x: 180, y: 10 })
  const rotatedArrow = rotated.annotations[0]
  assert.equal(rotatedArrow?.type, 'arrow')
  if (rotatedArrow?.type === 'arrow') {
    assert.deepEqual(rotatedArrow.start, { x: 180, y: 10 })
    assert.deepEqual(rotatedArrow.end, { x: 160, y: 30 })
  }
  assert.equal(JSON.parse(JSON.stringify(rotated)).annotations[0].id, 'arrow-1')
})

test('共享编辑器接入主要本地图片上传入口，编辑器不直接上传', () => {
  const editor = read('components/ImageEditor.tsx')
  const browser = read('lib/image-editor-browser.ts')
  for (const path of [
    'components/ContentImageUploader.tsx',
    'components/FeedbackImageUploader.tsx',
    'components/salon/SalonUploadForm.tsx',
    'components/activities/ActivityImageUploader.tsx',
    'components/TodayImageUploader.tsx',
  ]) assert.match(read(path), /ImageEditor/u, path)
  assert.match(editor, /onComplete: \(file: File\) => void/u)
  assert.match(editor, /onCancel: \(\) => void/u)
  assert.doesNotMatch(editor, /fetch\(/u)
  assert.match(browser, /IMAGE_EDITOR_PREVIEW_MAX_EDGE/u)
  assert.match(browser, /IMAGE_EDITOR_EXPORT_MAX_EDGE/u)
  assert.match(browser, /destination-in/u)
  assert.match(browser, /image\/png/u)
})

test('编辑器仍使用既有内容图片压缩限制，而不是另起一条上传规则', () => {
  const browserUpload = read('lib/content-image-browser.ts')
  const contentUpload = read('lib/content-image-upload.ts')
  assert.match(browserUpload, /prepareContentImageFile/u)
  assert.match(browserUpload, /CONTENT_IMAGE_COMPRESSION_THRESHOLD/u)
  assert.match(contentUpload, /CONTENT_IMAGE_MAX_FILE_SIZE/u)
  assert.match(contentUpload, /image\/heic/u)
  assert.match(contentUpload, /image\/heif/u)
})

test('图片编辑器 pointer 坐标以 CSS 画布矩形映射到原图空间，不重复乘 DPR', () => {
  const canvas = {
    width: 1080,
    height: 1920,
    getBoundingClientRect: () => ({ left: 20, top: 30, width: 360, height: 640, right: 380, bottom: 670, x: 20, y: 30, toJSON: () => ({}) }),
  } as unknown as HTMLCanvasElement
  const center = clientPointToImagePoint(200, 350, canvas, { x: 0, y: 0, width: 1080, height: 1920 })
  assert.deepEqual(center, { x: 540, y: 960 })
  const metrics = getImageEditorCanvasMetrics(canvas, { x: 0, y: 0, width: 1080, height: 1920 })
  assert.equal(metrics.backingWidth, 1080)
  assert.equal(metrics.backingHeight, 1920)
  assert.equal(metrics.cssWidth, 360)
  assert.equal(metrics.cssHeight, 640)
})

test('图片编辑器坐标 resolver 正确处理裁剪视口偏移，并拒绝画布外 pointer', () => {
  const canvas = {
    width: 600,
    height: 400,
    getBoundingClientRect: () => ({ left: 100, top: 80, width: 600, height: 400, right: 700, bottom: 480, x: 100, y: 80, toJSON: () => ({}) }),
  } as unknown as HTMLCanvasElement
  const point = clientPointToImagePoint(250, 180, canvas, { x: 300, y: 500, width: 1200, height: 800 })
  assert.deepEqual(point, { x: 600, y: 700 })
  assert.equal(clientPointToImagePoint(99, 180, canvas, { x: 300, y: 500, width: 1200, height: 800 }), null)
  assert.equal(clientPointToImagePoint(250, 481, canvas, { x: 300, y: 500, width: 1200, height: 800 }), null)
})

test('图片编辑器工具控制与移动端事件契约保持隔离', () => {
  const editor = read('components/ImageEditor.tsx')
  const browser = read('lib/image-editor-browser.ts')
  assert.match(editor, /clientPointToImagePoint/u)
  assert.match(editor, /setPointerCapture\(event\.pointerId\)/u)
  assert.match(editor, /onPointerCancel=\{handlePointerCancel\}/u)
  assert.match(editor, /tool === 'mosaic' \?/u)
  assert.match(editor, /tool === 'draw' \|\| tool === 'shape' \|\| tool === 'arrow' \|\| tool === 'text'/u)
  assert.doesNotMatch(editor, /tool === 'draw' \|\| tool === 'shape' \|\| tool === 'arrow' \|\| tool === 'mosaic' \|\| tool === 'text'/u)
  assert.match(browser, /showCropOverlay/u)
  assert.match(browser, /makePixelatedCanvas/u)
})

test('标注管理操作移到选中后的浮动图标，并保留单步历史', () => {
  const editor = read('components/ImageEditor.tsx')
  const icons = read('components/UiIcon.tsx')
  assert.match(editor, /<UiIcon name="undo"/u)
  assert.match(editor, /<UiIcon name="redo"/u)
  assert.match(editor, /data-image-editor-floating-delete/u)
  assert.match(editor, /data-image-editor-floating-copy/u)
  assert.match(editor, /onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/u)
  assert.match(editor, /function duplicateAnnotation/u)
  assert.match(editor, /moveAnnotation\(annotation, \{ x: 20, y: 20 \}\)/u)
  assert.match(editor, /setSelectedId\(copy\.id\)/u)
  assert.match(editor, /commitState\(\{ \.\.\.stateRef\.current, annotations: stateRef\.current\.annotations\.filter/u)
  assert.doesNotMatch(editor, />撤销<\/button>/u)
  assert.doesNotMatch(editor, />重做<\/button>/u)
  assert.doesNotMatch(editor, /删除选中标注/u)
  assert.doesNotMatch(editor, /点击已有标注进行选择/u)
  assert.match(icons, /copy:/u)
})
