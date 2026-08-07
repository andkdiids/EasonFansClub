import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (path: string) => readFileSync(path, 'utf8')

test('表情上传改用 sharp 解码真实格式，不再信任浏览器 MIME，不再误报「图片内容格式无效」', () => {
  const lib = read('lib/sticker-upload.ts')

  // 旧 bug：用 sharp.metadata().format（真实格式如 'jpeg'）去比对 MIME 字符串（'image/jpeg'），永远不匹配。
  assert.doesNotMatch(lib, /STICKER_STATIC_MIME_TYPES\.includes\(metadata\.format/)
  assert.doesNotMatch(lib, /'图片内容格式无效'/)
  // 旧逻辑依赖浏览器 MIME 做硬拒。
  assert.doesNotMatch(lib, /uploadStickerImage\(\{[^}]*mime:/)
  assert.doesNotMatch(lib, /uploadStickerPackCover\(\{[^}]*mime:/)

  // 新逻辑：用 sharp 解码真实格式 + 真实格式白名单。
  assert.match(lib, /new Set\(\['jpeg', 'jpg', 'png', 'webp', 'avif'\]\)/)
  assert.match(lib, /async function decodeImageFormat\(input: Buffer\): Promise<string>/)
  assert.match(lib, /sharp\(input, \{ failOn: 'none', limitInputPixels: 20_000_000 \}\)/)
  assert.match(lib, /metadata\.format/)
  assert.match(lib, /图片格式错误，仅支持 JPG \/ PNG \/ WebP \/ AVIF 静态图/)
  assert.match(lib, /不支持 SVG 格式/)
})

test('表情上传接口不再用浏览器 MIME 做硬拒，统一交给 sharp 解码校验', () => {
  const uploadPack = read('app/api/stickers/upload-pack/route.ts')
  const upload = read('app/api/stickers/upload/route.ts')
  const admin = read('app/api/admin/stickers/route.ts')

  for (const route of [uploadPack, upload, admin]) {
    assert.doesNotMatch(route, /isStickerMimeAllowed\(/)
    assert.doesNotMatch(route, /mime:/)
  }
  // 但仍保留尺寸上限等不依赖 MIME 的硬校验。
  assert.match(uploadPack, /STICKER_MAX_FILE_SIZE/)
  assert.match(upload, /STICKER_MAX_FILE_SIZE/)
  assert.match(admin, /STICKER_MAX_FILE_SIZE/)
})
