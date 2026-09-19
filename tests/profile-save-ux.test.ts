import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const form = readFileSync('app/profile/ProfileSettingsForm.tsx', 'utf8')
const backgroundEditor = readFileSync('components/ProfileBackgroundEditor.tsx', 'utf8')

test('保存资料在没有待提交字段时仍然完成正常退出', () => {
  const saveButton = form.match(/<button type="submit"[\s\S]*?保存资料[\s\S]*?<\/button>/)?.[0]
  assert.ok(saveButton)
  assert.match(saveButton, /disabled=\{isSaving \|\| uploading !== null \|\| backgroundUploading\}/)
  assert.doesNotMatch(saveButton, /isDirty|dirtyFields|hasChanges/)

  const emptyPayloadStart = form.indexOf('if (Object.keys(payload).length === 0)')
  const emptyPayloadEnd = form.indexOf('    setIsSaving(true)', emptyPayloadStart)
  assert.ok(emptyPayloadStart >= 0)
  assert.ok(emptyPayloadEnd > emptyPayloadStart)
  const emptyPayloadBranch = form.slice(emptyPayloadStart, emptyPayloadEnd)
  assert.match(emptyPayloadBranch, /setBirthdayConfirmation\(null\)/)
  assert.match(emptyPayloadBranch, /onSaved\?\.\(\)/)
  assert.doesNotMatch(emptyPayloadBranch, /没有资料更新|没有需要保存的修改/)
})

test('自动保存图片只更新对应图片基线，不覆盖其它资料草稿', () => {
  assert.match(form, /const savedImageUrlsRef = useRef\(\{[\s\S]*avatarUrl: initialProfile\.avatarUrl[\s\S]*backgroundUrl: initialProfile\.backgroundUrl/)
  assert.match(form, /setForm\(\(current\) => \(\{ \.\.\.current, avatarUrl: data\.url \}\)\)\s+savedImageUrlsRef\.current\.avatarUrl = data\.url/)
  assert.match(form, /savedImageUrlsRef\.current\.backgroundUrl/)
  assert.match(form, /if \(form\.avatarUrl !== savedImageUrlsRef\.current\.avatarUrl\) payload\.avatarUrl = form\.avatarUrl/)
  assert.match(form, /if \(form\.backgroundUrl !== savedImageUrlsRef\.current\.backgroundUrl\) payload\.backgroundUrl = form\.backgroundUrl/)
  assert.match(form, /setForm\(\(current\) => \(\{ \.\.\.current, avatarUrl: data\.url \}\)\)/)
})

test('保存期间和上传期间阻止重复提交，且不发送空 profile PATCH', () => {
  assert.match(form, /event\.preventDefault\(\)\s+if \(isSaving \|\| uploading !== null \|\| backgroundUploading\) return/)
  assert.match(form, /onUploadingChange=\{setBackgroundUploading\}/)
  assert.match(backgroundEditor, /onUploadingChange\?\.\(true\)/)
  assert.match(backgroundEditor, /onUploadingChange\?\.\(false\)/)
  const noPayloadIndex = form.indexOf('if (Object.keys(payload).length === 0)')
  const patchRequestIndex = form.indexOf("method: 'PATCH'", noPayloadIndex)
  assert.ok(noPayloadIndex >= 0)
  assert.ok(patchRequestIndex > noPayloadIndex)
})
