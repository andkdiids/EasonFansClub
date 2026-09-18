import type { BadgeVisibility } from '@/lib/badge-types'

export type BadgeVisibilityContext =
  | 'GALLERY'
  | 'PROFILE'
  | 'SOCIAL'
  | 'BADGE_DETAIL'
  | 'BADGE_PROGRESS'
  | 'ANGEL_GIFT'
  | 'ACTIVITY'
  | 'GAME'
  | 'SHARE'
  | 'ADMIN'

export type BadgeVisibilityViewerRole = 'ADMIN' | 'SELF' | 'OTHER' | 'ANONYMOUS'
export type BadgeVisibilityRenderMode = 'FULL' | 'PLACEHOLDER' | 'HIDDEN'

export type BadgeVisibilityResolution = {
  viewerRole: BadgeVisibilityViewerRole
  canSeeExistence: boolean
  canSeeMetadata: boolean
  canSeeOwnership: boolean
  canSeeProgress: boolean
  canSeeAcquisition: boolean
  canShare: boolean
  renderMode: BadgeVisibilityRenderMode
}

export type BadgeVisibilityResolverInput = {
  viewerId?: string | null
  ownerId?: string | null
  viewerRole?: BadgeVisibilityViewerRole
  isAdmin?: boolean
  badge: { visibility: BadgeVisibility | string }
  userBadge?: { isHidden?: boolean | null } | null
  context: BadgeVisibilityContext
  angelGiftReveal?: { isHidden: boolean; revealed: boolean } | null
}

function fullResolution(viewerRole: BadgeVisibilityViewerRole, hasOwnership: boolean, visibility: string): BadgeVisibilityResolution {
  return {
    viewerRole,
    canSeeExistence: true,
    canSeeMetadata: true,
    canSeeOwnership: hasOwnership && (viewerRole === 'SELF' || viewerRole === 'ADMIN'),
    canSeeProgress: visibility === 'PUBLIC',
    canSeeAcquisition: true,
    canShare: hasOwnership && visibility !== 'SECRET' && (viewerRole === 'SELF' || viewerRole === 'ADMIN'),
    renderMode: 'FULL',
  }
}

function withOwnership(result: BadgeVisibilityResolution, viewerRole: BadgeVisibilityViewerRole, hasOwnership: boolean, canSeeOwnership: boolean) {
  return {
    ...result,
    viewerRole,
    canSeeOwnership: hasOwnership && canSeeOwnership,
  }
}

function hiddenResolution(viewerRole: BadgeVisibilityViewerRole): BadgeVisibilityResolution {
  return {
    viewerRole,
    canSeeExistence: false,
    canSeeMetadata: false,
    canSeeOwnership: false,
    canSeeProgress: false,
    canSeeAcquisition: false,
    canShare: false,
    renderMode: 'HIDDEN',
  }
}

function placeholderResolution(viewerRole: BadgeVisibilityViewerRole): BadgeVisibilityResolution {
  return {
    viewerRole,
    canSeeExistence: true,
    canSeeMetadata: false,
    canSeeOwnership: false,
    canSeeProgress: false,
    canSeeAcquisition: false,
    canShare: false,
    renderMode: 'PLACEHOLDER',
  }
}

function resolveViewerRole(input: BadgeVisibilityResolverInput): BadgeVisibilityViewerRole {
  if (input.isAdmin || input.viewerRole === 'ADMIN') return 'ADMIN'
  if (input.viewerRole) return input.viewerRole
  if (input.viewerId && input.ownerId && input.viewerId === input.ownerId) return 'SELF'
  return input.viewerId ? 'OTHER' : 'ANONYMOUS'
}

/**
 * Canonical server-side Badge visibility policy.
 *
 * Badge.visibility is global, UserBadge.isHidden is ownership privacy, and
 * PharmacyPrize.isHidden is only meaningful inside the Angel Gift context.
 * This function intentionally contains no database access so every projection
 * can apply the same decision before serializing metadata.
 */
export function resolveBadgeVisibility(input: BadgeVisibilityResolverInput): BadgeVisibilityResolution {
  const viewerRole = resolveViewerRole(input)
  const visibility = input.badge.visibility
  const hasOwnership = Boolean(input.userBadge)
  const userBadgeIsHidden = Boolean(input.userBadge?.isHidden)
  const angelGift = input.context === 'ANGEL_GIFT' ? input.angelGiftReveal : null

  if (viewerRole === 'ADMIN') {
    return {
      viewerRole,
      canSeeExistence: true,
      canSeeMetadata: true,
      canSeeOwnership: hasOwnership,
      canSeeProgress: visibility === 'PUBLIC',
      canSeeAcquisition: true,
      canShare: false,
      renderMode: 'FULL',
    }
  }

  // SECRET is a global privacy boundary. Angel Gift history and
  // UserBadge.isHidden never make an unowned or other-user SECRET public.
  if (visibility === 'SECRET') {
    if (viewerRole === 'SELF' && hasOwnership) return fullResolution(viewerRole, true, visibility)
    return hiddenResolution(viewerRole)
  }

  // In Angel Gift context, relation-hidden badges stay out of the collection
  // until revealed. The regular gallery keeps ordinary HIDDEN placeholder
  // semantics and is intentionally not filtered by PharmacyPrize.isHidden.
  if (angelGift?.isHidden && !angelGift.revealed && !(viewerRole === 'SELF' && hasOwnership)) {
    return hiddenResolution(viewerRole)
  }

  // Angel Gift reveals are durable for PUBLIC/HIDDEN relation badges. HIDDEN
  // is therefore full in that context after reveal, even without current
  // ownership. SECRET was handled above and cannot use this escape hatch.
  if (input.context === 'ANGEL_GIFT' && visibility === 'HIDDEN' && angelGift?.revealed && !hasOwnership) {
    return withOwnership(fullResolution(viewerRole, false, visibility), viewerRole, false, false)
  }

  if (hasOwnership) {
    if (viewerRole === 'SELF') return fullResolution(viewerRole, true, visibility)
    if (userBadgeIsHidden) return hiddenResolution(viewerRole)
    return withOwnership(fullResolution(viewerRole, true, visibility), viewerRole, true, true)
  }

  if (visibility === 'PUBLIC') return fullResolution(viewerRole, false, visibility)

  // Angel Gift treats an unowned global HIDDEN as undisclosed rather than as
  // the ordinary gallery placeholder. This prevents relation collections
  // from exposing a placeholder before their reveal event.
  if (visibility === 'HIDDEN' && input.context === 'ANGEL_GIFT') return hiddenResolution(viewerRole)
  if (visibility === 'HIDDEN') return placeholderResolution(viewerRole)
  return hiddenResolution(viewerRole)
}
