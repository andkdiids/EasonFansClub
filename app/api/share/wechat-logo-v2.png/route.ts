import { renderWechatShareImage, WECHAT_SHARE_IMAGE_MIME_TYPE } from '@/lib/wechat-share-image'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const cacheControl = 'public, max-age=31536000, immutable'

export async function GET() {
  try {
    const image = await renderWechatShareImage()
    const body = new ArrayBuffer(image.byteLength)
    new Uint8Array(body).set(image)
    return new Response(body, {
      status: 200,
      headers: {
        'Cache-Control': cacheControl,
        'Content-Type': WECHAT_SHARE_IMAGE_MIME_TYPE,
        'Content-Length': String(image.byteLength),
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    console.error('[share.wechat-logo]', { errorName: error instanceof Error ? error.name : 'unknown' })
    return new Response('微信分享图片暂时无法生成', {
      status: 503,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/plain; charset=utf-8',
      },
    })
  }
}
