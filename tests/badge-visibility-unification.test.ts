import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveBadgeVisibility } from '../lib/badge-visibility'

const publicBadge = { visibility: 'PUBLIC' as const }
const hiddenBadge = { visibility: 'HIDDEN' as const }
const secretBadge = { visibility: 'SECRET' as const }

test('PUBLIC matrix exposes the catalog but respects ownership privacy', () => {
  const unowned = resolveBadgeVisibility({ badge: publicBadge, context: 'GALLERY' })
  assert.equal(unowned.renderMode, 'FULL')
  assert.equal(unowned.canSeeMetadata, true)
  assert.equal(unowned.canSeeOwnership, false)
  assert.equal(unowned.canSeeProgress, true)

  const publicOwned = resolveBadgeVisibility({
    viewerId: 'viewer',
    ownerId: 'owner',
    badge: publicBadge,
    userBadge: { isHidden: false },
    context: 'SOCIAL',
  })
  assert.equal(publicOwned.renderMode, 'FULL')
  assert.equal(publicOwned.canSeeOwnership, true)

  const userHidden = resolveBadgeVisibility({
    viewerId: 'viewer',
    ownerId: 'owner',
    badge: publicBadge,
    userBadge: { isHidden: true },
    context: 'SOCIAL',
  })
  assert.equal(userHidden.renderMode, 'HIDDEN')
  assert.equal(userHidden.canSeeMetadata, false)
  assert.equal(userHidden.canSeeOwnership, false)
})
test('HIDDEN matrix uses a safe placeholder until ownership, and still respects UserBadge.isHidden', () => {
  const unowned = resolveBadgeVisibility({ badge: hiddenBadge, context: 'GALLERY' })
  assert.equal(unowned.renderMode, 'PLACEHOLDER')
  assert.equal(unowned.canSeeExistence, true)
  assert.equal(unowned.canSeeMetadata, false)
  assert.equal(unowned.canSeeProgress, false)

  const selfOwned = resolveBadgeVisibility({
    viewerId: 'owner',
    ownerId: 'owner',
    badge: hiddenBadge,
    userBadge: { isHidden: true },
    context: 'GALLERY',
  })
  assert.equal(selfOwned.renderMode, 'FULL')
  assert.equal(selfOwned.canSeeMetadata, true)
  assert.equal(selfOwned.canSeeOwnership, true)

  const otherOwned = resolveBadgeVisibility({
    viewerId: 'viewer',
    ownerId: 'owner',
    badge: hiddenBadge,
    userBadge: { isHidden: false },
    context: 'SOCIAL',
  })
  assert.equal(otherOwned.renderMode, 'FULL')
  assert.equal(otherOwned.canSeeOwnership, true)

  const otherHidden = resolveBadgeVisibility({
    viewerId: 'viewer',
    ownerId: 'owner',
    badge: hiddenBadge,
    userBadge: { isHidden: true },
    context: 'SOCIAL',
  })
  assert.equal(otherHidden.renderMode, 'HIDDEN')
  assert.equal(otherHidden.canSeeMetadata, false)
})

test('SECRET is hidden from every ordinary viewer and overrides UserBadge.isHidden', () => {
  const unowned = resolveBadgeVisibility({ badge: secretBadge, context: 'BADGE_DETAIL' })
  assert.equal(unowned.renderMode, 'HIDDEN')
  assert.equal(unowned.canSeeExistence, false)
  assert.equal(unowned.canSeeMetadata, false)

  const selfOwned = resolveBadgeVisibility({
    viewerId: 'owner',
    ownerId: 'owner',
    badge: secretBadge,
    userBadge: { isHidden: false },
    context: 'BADGE_DETAIL',
  })
  assert.equal(selfOwned.renderMode, 'FULL')
  assert.equal(selfOwned.canSeeMetadata, true)
  assert.equal(selfOwned.canShare, false)

  const otherOwned = resolveBadgeVisibility({
    viewerId: 'viewer',
    ownerId: 'owner',
    badge: secretBadge,
    userBadge: { isHidden: false },
    context: 'SOCIAL',
  })
  assert.equal(otherOwned.renderMode, 'HIDDEN')
  assert.equal(otherOwned.canSeeOwnership, false)

  const revoked = resolveBadgeVisibility({
    viewerId: 'owner',
    ownerId: 'owner',
    badge: secretBadge,
    context: 'BADGE_DETAIL',
  })
  assert.equal(revoked.renderMode, 'HIDDEN')
  assert.equal(revoked.canSeeExistence, false)
})

test('Angel Gift relation hiding is context-scoped and cannot bypass SECRET', () => {
  const publicRelationHidden = resolveBadgeVisibility({
    badge: publicBadge,
    context: 'ANGEL_GIFT',
    angelGiftReveal: { isHidden: true, revealed: false },
  })
  assert.equal(publicRelationHidden.renderMode, 'HIDDEN')

  const publicRelationRevealed = resolveBadgeVisibility({
    badge: publicBadge,
    context: 'ANGEL_GIFT',
    angelGiftReveal: { isHidden: true, revealed: true },
  })
  assert.equal(publicRelationRevealed.renderMode, 'FULL')

  const ordinaryGallery = resolveBadgeVisibility({
    badge: hiddenBadge,
    context: 'GALLERY',
    angelGiftReveal: { isHidden: true, revealed: false },
  })
  assert.equal(ordinaryGallery.renderMode, 'PLACEHOLDER')

  const hiddenRelationRevealed = resolveBadgeVisibility({
    badge: hiddenBadge,
    context: 'ANGEL_GIFT',
    angelGiftReveal: { isHidden: true, revealed: true },
  })
  assert.equal(hiddenRelationRevealed.renderMode, 'FULL')

  const secretRelationRevealed = resolveBadgeVisibility({
    badge: secretBadge,
    context: 'ANGEL_GIFT',
    angelGiftReveal: { isHidden: true, revealed: true },
  })
  assert.equal(secretRelationRevealed.renderMode, 'HIDDEN')
  assert.equal(secretRelationRevealed.canSeeMetadata, false)

  const currentSecretOwner = resolveBadgeVisibility({
    viewerRole: 'SELF',
    badge: secretBadge,
    userBadge: { isHidden: false },
    context: 'ANGEL_GIFT',
    angelGiftReveal: { isHidden: true, revealed: true },
  })
  assert.equal(currentSecretOwner.renderMode, 'FULL')
})

test('ADMIN can inspect every visibility, while progress remains PUBLIC-only', () => {
  const adminSecret = resolveBadgeVisibility({
    viewerRole: 'ADMIN',
    badge: secretBadge,
    context: 'ADMIN',
  })
  assert.equal(adminSecret.renderMode, 'FULL')
  assert.equal(adminSecret.canSeeMetadata, true)
  assert.equal(adminSecret.canSeeProgress, false)

  const publicSelf = resolveBadgeVisibility({
    viewerRole: 'SELF',
    badge: publicBadge,
    userBadge: { isHidden: false },
    context: 'SHARE',
  })
  assert.equal(publicSelf.canShare, true)
})
