import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { storedTodayImageUrl } from '../lib/today-image-url'

const read = (path: string) => readFileSync(path, 'utf8')

test('今日内容新增和管理编辑都使用图片选择器，不再暴露地址输入', () => {
  const publicPage = read('app/today/TodayPageClient.tsx')
  const adminPage = read('app/admin/today/TodayAdminManager.tsx')
  const uploader = read('components/TodayImageUploader.tsx')

  assert.match(publicPage, /<TodayImageUploader/)
  assert.match(adminPage, /<TodayImageUploader/)
  assert.match(uploader, /URL\.createObjectURL/)
  assert.match(uploader, /删除图片/)
  assert.match(uploader, /重新选择/)
  assert.doesNotMatch(adminPage, /图片 URL|COS WebP 地址|WebP 地址/)
  assert.doesNotMatch(publicPage, /图片 URL|COS WebP 地址|WebP 地址/)
})

test('编辑图片区分保留、删除和替换，保存期间不能重复提交', () => {
  const adminPage = read('app/admin/today/TodayAdminManager.tsx')
  assert.match(adminPage, /selection\.removed/)
  assert.match(adminPage, /selection\.file/)
  assert.match(adminPage, /imagePatch\.imageUrl = null/)
  assert.match(adminPage, /imagePatch\.imageUrl = nextImageUrl/)
  assert.match(adminPage, /if \(savingRef\.current\) return/)
  assert.match(adminPage, /disabled=\{saving\}/)
  assert.match(publicPageSource(), /if \(savingRef\.current\) return/)
})

test('今日图片上传接口要求登录或今日内容管理权限，并复用现有处理和 COS 上传工具', () => {
  const uploadRoute = read('app/api/uploads/today-image/route.ts')
  assert.match(uploadRoute, /scope === 'admin' \? await requireAdmin\('today_manage'\) : await requireUser\(\)/)
  assert.match(uploadRoute, /isTodayImageMimeType\(mimeType\)/)
  assert.match(uploadRoute, /TODAY_IMAGE_MAX_FILE_SIZE/)
  assert.match(uploadRoute, /sharp\(input, \{ animated: true, failOn: 'none', limitInputPixels: 30_000_000 \}/)
  assert.match(uploadRoute, /uploadImageVariantFamily/)
  assert.match(uploadRoute, /uploadSiteImage\(\{ key, body, contentType \}\)/)
  assert.match(uploadRoute, /sourceObjectPath: `today\/\$\{guard\.user\.id\}\/\$\{randomUUID\(\)\}\/source\.webp`/)
})

test('保存接口只接受本站今日图片上传结果，编辑未传图片时保留旧值', () => {
  const submitRoute = read('app/api/today/route.ts')
  const createRoute = read('app/api/admin/today/route.ts')
  const editRoute = read('app/api/admin/today/[eventId]/route.ts')

  assert.match(submitRoute, /parseTodayImageInput\(body\?\.imageUrl, guard\.user\.id\)/)
  assert.match(createRoute, /parseTodayImageInput\(body\?\.imageUrl, guard\.user\.id\)/)
  assert.match(editRoute, /parseTodayImageInput\(body\?\.imageUrl, guard\.user\.id\)/)
  assert.match(editRoute, /imageInput\.provided \? \{ imageUrl: imageInput\.value \} : \{\}/)
  assert.doesNotMatch(submitRoute, /storedImageUrl/)
  assert.doesNotMatch(createRoute, /storedImageUrl/)
  assert.doesNotMatch(editRoute, /storedImageUrl/)
})

test('历史记录的旧图片地址仍按既有展示变体读取，上传地址校验不接受外部地址', () => {
  assert.equal(
    storedTodayImageUrl('/cos/today/user-1/upload-1/source.webp', 'user-1'),
    'https://ecfc-1306412725.cos.ap-guangzhou.myqcloud.com/today/user-1/upload-1/source.webp',
  )
  assert.equal(storedTodayImageUrl('/cos/today/user-1/upload-1/source.webp', 'user-2'), null)
  assert.equal(storedTodayImageUrl('https://example.com/today/user-1/upload-1/source.webp', 'user-1'), null)
  assert.match(read('lib/today-events.ts'), /publicImageVariantUrl\(event\.imageUrl, 'large'\)/)
})

function publicPageSource() {
  return read('app/today/TodayPageClient.tsx')
}
