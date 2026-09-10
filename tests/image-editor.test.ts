import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  createInitialImageEditorState,
  imageEditorDimensions,
  rotateImageEditorPoint,
  rotateImageEditorState,
} from '../lib/image-editor'

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
