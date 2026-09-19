import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  DEFAULT_PROFILE_BACKGROUND_TRANSFORM,
  normalizeProfileBackgroundTransform,
  profileBackgroundTransformFromFields,
  profileBackgroundTransformStyle,
  profileBackgroundTransformToFields,
  updateProfileBackgroundTransformForDrag,
} from '../lib/profile-background'

test('legacy background rows resolve to cover-centered defaults', () => {
  assert.deepEqual(normalizeProfileBackgroundTransform(null), DEFAULT_PROFILE_BACKGROUND_TRANSFORM)
  assert.equal(profileBackgroundTransformFromFields({}, 'desktop'), null)
  assert.deepEqual(
    profileBackgroundTransformFromFields({ backgroundMobileScale: 1.8, backgroundMobileX: 0.25, backgroundMobileY: -0.4 }, 'mobile'),
    { scale: 1.8, x: 0.25, y: -0.4 },
  )
})

test('desktop and mobile fields round-trip independently', () => {
  const desktop = { scale: 1.2, x: -0.2, y: 0.1 }
  const mobile = { scale: 1.8, x: 0.35, y: -0.45 }
  const fields = {
    ...profileBackgroundTransformToFields('desktop', desktop),
    ...profileBackgroundTransformToFields('mobile', mobile),
  }
  assert.deepEqual(profileBackgroundTransformFromFields(fields, 'desktop'), desktop)
  assert.deepEqual(profileBackgroundTransformFromFields(fields, 'mobile'), mobile)
})

test('scale and drag are bounded so the cover frame cannot expose blank edges', () => {
  assert.deepEqual(normalizeProfileBackgroundTransform({ scale: 0.2, x: 5, y: -5 }), { scale: 1, x: 1, y: -1 })
  assert.deepEqual(
    updateProfileBackgroundTransformForDrag({ scale: 2, x: 0, y: 0 }, 9999, -9999, 450, 100),
    { scale: 2, x: 1, y: -1 },
  )
  assert.match(profileBackgroundTransformStyle({ scale: 1.5, x: 0.2, y: -0.2 }).transform, /scale\(1\.5000\)/)
})

test('editor and real profile rendering both use the shared transform helper and one source URL', () => {
  const editor = readFileSync('components/ProfileBackgroundEditor.tsx', 'utf8')
  const image = readFileSync('components/ProfileBackgroundImage.tsx', 'utf8')
  assert.match(editor, /profileBackgroundTransformStyle/)
  assert.match(image, /profileBackgroundTransformStyle/)
  assert.equal((image.match(/src=\{sourceUrl\}/g) || []).length, 2)
})
