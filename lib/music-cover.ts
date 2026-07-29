import sharp from 'sharp'
import {
  MUSIC_COVER_MAX_FILE_SIZE,
  MUSIC_COVER_TYPES,
} from '@/lib/music-upload-constraints'

export const MUSIC_COVER_MAX_WIDTH = 2000
export const MUSIC_COVER_QUALITY = 82
export { MUSIC_COVER_MAX_FILE_SIZE, MUSIC_COVER_TYPES }

export async function convertMusicCoverToWebp(input: Buffer) {
  const image = sharp(input, { failOn: 'error', limitInputPixels: 40_000_000 })
  const metadata = await image.metadata()
  if (!metadata.format || !['jpeg', 'png', 'webp'].includes(metadata.format)) {
    throw new Error('图片内容格式无效')
  }
  return image
    .rotate()
    .resize({ width: MUSIC_COVER_MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: MUSIC_COVER_QUALITY })
    .toBuffer()
}
