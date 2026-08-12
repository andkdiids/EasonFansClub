import assert from 'node:assert/strict'
import test from 'node:test'
import sharp from 'sharp'
import {
  imageOriginalObjectPath,
  imageVariantObjectPath,
  publicImageOriginalUrl,
  publicHeroVariantUrl,
  publicImageVariantUrl,
  toImageVariantUrl,
} from '@/lib/image-variants'
import { createAnimatedImageVariants, createImageVariants } from '@/lib/image-webp'

function makeAnimatedGif(): Buffer {
  const frame = (color: 0 | 1) => Buffer.from([
    0x21, 0xf9, 0x04, 0x00, 0x05, 0x00, 0x00, 0x00,
    0x2c, 0x00, 0x00, 0x00, 0x00, 0x02, 0x00, 0x02, 0x00, 0x00,
    0x02, 0x03, ...(color === 0 ? [0x04, 0x00, 0x01] : [0x4c, 0x49, 0x05]), 0x00,
  ])
  return Buffer.concat([
    Buffer.from('GIF89a', 'ascii'),
    Buffer.from([0x02, 0x00, 0x02, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff, 0x00, 0x00]),
    frame(0),
    frame(1),
    Buffer.from([0x3b]),
  ])
}

test('image variants resolve only deterministic source families', () => {
  const source = '/cos/content/user-1/post-1/source.webp?v=7'
  assert.equal(toImageVariantUrl(source, 'card'), '/cos/content/user-1/post-1/card.webp?v=7')
  assert.equal(publicImageVariantUrl(source, 'thumb-md'), '/cos/content/user-1/post-1/thumb-md.webp?v=7')
  assert.equal(publicImageOriginalUrl(source), '/cos/content/user-1/post-1/original?v=7')
  assert.equal(toImageVariantUrl('/cos/content/legacy.webp', 'card'), null)
  assert.equal(publicImageVariantUrl('/cos/content/legacy.webp', 'card'), '/cos/content/legacy.webp')
  assert.equal(publicHeroVariantUrl('/cos/page-visuals/home/optimized/family/hero.webp?v=7', 'card'), '/cos/page-visuals/home/optimized/family/card.webp?v=7')
  assert.equal(publicHeroVariantUrl('/cos/page-visuals/legacy.webp', 'card'), '/cos/page-visuals/legacy.webp')
  assert.equal(publicHeroVariantUrl('https://example.com/hero.webp', 'card'), 'https://example.com/hero.webp')
})

test('variant object keys are finite and preserve the source family', () => {
  const source = 'avatars/user-1/family-1/source.webp'
  assert.equal(imageOriginalObjectPath(source), 'avatars/user-1/family-1/original')
  assert.equal(imageVariantObjectPath(source, 'avatar-sm'), 'avatars/user-1/family-1/avatar-sm.webp')
  assert.equal(imageVariantObjectPath(source, 'hero'), 'avatars/user-1/family-1/hero.webp')
})

test('static variants preserve transparency and do not enlarge small inputs', async () => {
  const input = await sharp({
    create: {
      width: 320,
      height: 180,
      channels: 4,
      background: { r: 0, g: 120, b: 255, alpha: 0.5 },
    },
  }).png().toBuffer()
  const generated = await createImageVariants(input, { variants: ['thumb-sm', 'large'] })
  const sourceMetadata = await sharp(generated.source).metadata()
  const thumbMetadata = await sharp(generated.variants['thumb-sm']!).metadata()
  const largeMetadata = await sharp(generated.variants.large!).metadata()
  assert.equal(sourceMetadata.width, 320)
  assert.equal(sourceMetadata.hasAlpha, true)
  assert.equal(thumbMetadata.width, 240)
  assert.equal(largeMetadata.width, 320)
})

test('animated variants remain multi-frame WebP', async () => {
  const animatedInput = makeAnimatedGif()
  const generated = await createAnimatedImageVariants(animatedInput, { variants: ['thumb-sm'] })
  const metadata = await sharp(generated.variants['thumb-sm']!, { animated: true }).metadata()
  assert.ok((metadata.pages || 0) > 1)
})
