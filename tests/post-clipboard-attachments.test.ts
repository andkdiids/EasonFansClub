import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { clipboardImageFilesFromPaste } from '../lib/content-image-browser'
import { MAX_CONTENT_IMAGES } from '../lib/content-images'

const read = (path: string) => readFileSync(path, 'utf8')
const editor = read('components/posts/RichTextEditor.tsx')
const uploader = read('components/ContentImageUploader.tsx')
const createForm = read('components/PostCreateForm.tsx')
const editForm = read('components/PostEditForm.tsx')

test('帖子剪贴板图片进入附件队列而不是正文图片队列', () => {
  assert.equal(MAX_CONTENT_IMAGES, 9)
  assert.match(editor, /pasteImagesToAttachments\?: boolean/u)
  assert.match(editor, /onPasteImagesToAttachments\?: \(files: File\[\]\) => void/u)
  assert.match(editor, /pasteImagesToAttachments = false/u)

  const pasteBranch = editor.slice(editor.indexOf('const imageFiles = clipboardImageFilesFromPaste(event)'))
  assert.ok(pasteBranch.indexOf('onPasteImagesToAttachmentsRef.current(imageFiles)') < pasteBranch.indexOf('enqueueImageUploadsRef.current?.('))
  assert.match(pasteBranch, /event\.preventDefault\(\)/u)
})

test('发布和编辑表单都把剪贴板图片交给同一个附件上传器', () => {
  for (const form of [createForm, editForm]) {
    assert.match(form, /ContentImageUploaderHandle/u)
    assert.match(form, /ref=\{imagesUploaderRef\}/u)
    assert.match(form, /pasteImagesToAttachments/u)
    assert.match(form, /onPasteImagesToAttachments=\{addPastedImagesToAttachments\}/u)
  }
  assert.match(createForm, /onBusyChange=\{setImagesUploading\}/u)
  assert.match(editForm, /onBusyChange=\{setImagesUploading\}/u)
})

test('附件上传器复用 addFiles 队列并在失败时不占用 9 张名额', () => {
  assert.match(uploader, /export type ContentImageUploaderHandle/u)
  assert.match(uploader, /addFiles: \(files: File\[\]\) => void/u)
  assert.match(uploader, /useImperativeHandle\(ref, \(\) => \(\{ addFiles \}\)\)/u)
  assert.match(uploader, /const pendingCount = pendingUploadsRef\.current\.filter\(\(item\) => isBusyPhase\(item\.phase\)\)\.length/u)
  assert.match(uploader, /最多只能添加 \$\{MAX_CONTENT_IMAGES\} 张图片。/u)
  assert.match(uploader, /readClipboardImageFiles\(\)/u)
  assert.match(uploader, /从剪贴板添加/u)
  assert.match(uploader, /uploadContentImage\(item\.file/u)
})

test('原生 paste 只把真实 image File 识别为图片，网页文字仍不受影响', () => {
  const textItem = {
    kind: 'string',
    type: 'text/html',
    getAsFile: () => null,
  }
  const imageItem = {
    kind: 'file',
    type: 'image/png',
    getAsFile: () => new File([new Blob(['png'])], 'screen.png', { type: 'image/png' }),
  }
  const event = { clipboardData: { items: [textItem, imageItem] } } as unknown as ClipboardEvent
  const files = clipboardImageFilesFromPaste(event)
  assert.equal(files.length, 1)
  assert.equal(files[0]?.type, 'image/png')
  assert.match(files[0]?.name || '', /^clipboard-\d+-1\.png$/u)
  assert.doesNotMatch(editor, /<img[^>]+src=\{[^}]*blob/u)
})

test('其他富文本编辑器默认保留正文图片插入能力', () => {
  assert.match(editor, /if \(pasteImagesToAttachmentsRef\.current && onPasteImagesToAttachmentsRef\.current\)/u)
  assert.match(editor, /enqueueImageUploads\(view, files, bookmark\)/u)
  assert.match(editor, /const imageType = view\.state\.schema\.nodes\.image/u)
})
