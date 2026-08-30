import { readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

/** Versioned so WeChat can be forced to refetch the repaired thumbnail. */
export const WECHAT_SHARE_IMAGE_PATH = '/api/share/wechat-logo-v2.png'
export const WECHAT_SHARE_IMAGE_MIME_TYPE = 'image/png'
export const WECHAT_SHARE_IMAGE_SIZE = 512
export const WECHAT_SHARE_IMAGE_BACKGROUND = '#f5f5f5'

const LOGO_SIZE = 448
const LOGO_OFFSET = Math.floor((WECHAT_SHARE_IMAGE_SIZE - LOGO_SIZE) / 2)
const OFFICIAL_LOGO_PATH = path.join(process.cwd(), 'app', 'icon.png')

let renderedImagePromise: Promise<Buffer> | null = null

/**
 * Build the WeChat-only logo thumbnail without changing the official logo.
 *
 * The source remains a transparent PNG everywhere else.  This output uses an
 * explicitly opaque, light canvas because some WeChat card renderers ignore
 * transparent pixels and display their RGB fallback (black) instead.
 */
async function createWechatShareImage() {
  const source = await readFile(OFFICIAL_LOGO_PATH)
  const logo = await sharp(source, { failOn: 'error', limitInputPixels: 10_000_000 })
    .resize(LOGO_SIZE, LOGO_SIZE, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer()

  return sharp({
    create: {
      width: WECHAT_SHARE_IMAGE_SIZE,
      height: WECHAT_SHARE_IMAGE_SIZE,
      channels: 4,
      background: WECHAT_SHARE_IMAGE_BACKGROUND,
    },
  })
    .composite([{ input: logo, left: LOGO_OFFSET, top: LOGO_OFFSET, blend: 'over' }])
    .png({ compressionLevel: 9 })
    .toBuffer()
}

/** Generate once per server process; the versioned response is cacheable. */
export function renderWechatShareImage() {
  if (!renderedImagePromise) renderedImagePromise = createWechatShareImage()
  return renderedImagePromise
}

export const wechatShareImageConstants = {
  background: WECHAT_SHARE_IMAGE_BACKGROUND,
  height: WECHAT_SHARE_IMAGE_SIZE,
  logoSize: LOGO_SIZE,
  mimeType: WECHAT_SHARE_IMAGE_MIME_TYPE,
  officialLogoPath: 'app/icon.png',
  path: WECHAT_SHARE_IMAGE_PATH,
  width: WECHAT_SHARE_IMAGE_SIZE,
} as const
