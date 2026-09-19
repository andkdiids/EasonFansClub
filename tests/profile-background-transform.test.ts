import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  DEFAULT_PROFILE_BACKGROUND_TRANSFORM,
  getProfileBackgroundConstraints,
  getProfileBackgroundDragBounds,
  normalizeProfileBackgroundTransform,
  profileBackgroundTransformFromFields,
  profileBackgroundTransformStyle,
  profileBackgroundTransformToFields,
  resolveProfileBackgroundTransform,
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

test('desktop and mobile can scale below cover while retaining a usable minimum', () => {
  const desktop = getProfileBackgroundConstraints({
    device: 'desktop',
    imageSize: { width: 1600, height: 900 },
    containerSize: { width: 450, height: 100 },
  })
  const mobile = getProfileBackgroundConstraints({
    device: 'mobile',
    imageSize: { width: 1600, height: 900 },
    containerSize: { width: 360, height: 210 },
  })
  assert.ok(desktop.minScale < 1)
  assert.ok(mobile.minScale < 1)
  assert.ok(desktop.minScale >= 0.4 && desktop.minScale <= 0.6)
  assert.ok(mobile.minScale >= 0.4 && mobile.minScale <= 0.6)
  assert.deepEqual(normalizeProfileBackgroundTransform({ scale: 0.2, x: 5, y: -5 }), { scale: 0.4, x: 1, y: -1 })
})

test('black-space composition supports both directions without letting the image fully leave', () => {
  const geometry = {
    device: 'mobile' as const,
    imageSize: { width: 1600, height: 900 },
    containerSize: { width: 360, height: 210 },
  }
  const bounds = getProfileBackgroundDragBounds({ ...geometry, scale: 0.5 })
  assert.ok(bounds.x > 0)
  assert.ok(bounds.y > 0)
  assert.deepEqual(
    updateProfileBackgroundTransformForDrag({ scale: 0.5, x: 0, y: 0 }, 9999, -9999, 360, 210, geometry),
    { scale: 0.5, x: 1, y: -1 },
  )
  const resolved = resolveProfileBackgroundTransform({ scale: 0.5, x: 1, y: -1 }, geometry)
  assert.equal(resolved.translateUnit, 'px')
  assert.ok(resolved.translateX > 0)
  assert.ok(resolved.translateY < 0)
  assert.match(profileBackgroundTransformStyle({ scale: 0.5, x: 0.2, y: -0.2 }, geometry).transform, /scale\(0\.5000\)/)
})

test('editor and real profile rendering both use the shared transform helper and one source URL', () => {
  const editor = readFileSync('components/ProfileBackgroundEditor.tsx', 'utf8')
  const image = readFileSync('components/ProfileBackgroundImage.tsx', 'utf8')
  assert.match(editor, /profileBackgroundTransformStyle/)
  assert.match(image, /profileBackgroundTransformStyle/)
  assert.equal((image.match(/<ProfileBackgroundLayer/g) || []).length, 2)
  assert.match(image, /device="mobile"/)
  assert.match(image, /device="desktop"/)
})
