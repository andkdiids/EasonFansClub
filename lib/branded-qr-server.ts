import { readFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'
import { createBrandedQrSvg } from '@/lib/branded-qr'

const OFFICIAL_LOGO_PATH = path.join(process.cwd(), 'app', 'icon.png')
let logoDataUrlPromise: Promise<string | null> | null = null

async function officialLogoDataUrl() {
  if (!logoDataUrlPromise) {
    logoDataUrlPromise = readFile(OFFICIAL_LOGO_PATH)
      .then((buffer) => `data:image/png;base64,${buffer.toString('base64')}`)
      .catch((error) => {
        console.error('[branded-qr.logo]', { errorName: error instanceof Error ? error.name : 'unknown' })
        return null
      })
  }
  return logoDataUrlPromise
}

/** Server PNG adapter. The QR matrix and safety settings live in branded-qr.ts. */
export async function createBrandedQrBuffer(payload: string, size: number) {
  const logoHref = await officialLogoDataUrl()
  const svg = createBrandedQrSvg(payload, size, { logoHref: logoHref || null })
  return sharp(Buffer.from(svg, 'utf8')).png().toBuffer()
}
