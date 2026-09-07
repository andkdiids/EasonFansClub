import type { Prisma } from '@prisma/client'
import { createMySqlAdvisoryLockName, withMySqlAdvisoryLocks } from '@/lib/mysql-advisory-lock'
import { buildAdminUserContactUpdate } from '@/lib/admin-user-contact'
import {
  canonicalEmailValue,
  canonicalPhoneValue,
  getUserContactAdvisoryLockNames,
  maskContactValue,
  type UserContactPatch,
} from '@/lib/user-contact'
import { getPhoneLookupVariants } from '@/lib/phone-number'
import { maskLoginAccount } from '@/lib/login-account'
import { updateUserBirthdate, type UpdateUserBirthdateOptions } from '@/lib/birthday-immutability'
import type { BirthdayParts } from '@/lib/zodiac'
import type { UserLocation } from '@/lib/user-location'

export type AdminUserProfilePatch = {
  username?: { account: string; usernameNormalized: string }
  nickname?: string
  email?: string | null
  phone?: string | null
  phoneCountry?: UserContactPatch['phoneCountry']
  bio?: string
  avatarUrl?: string | null
  backgroundUrl?: string | null
  birthday?: BirthdayParts | null
  birthdayPublic?: boolean
  showBadgeActivity?: boolean
  showBadgeProgressNotifications?: boolean
  location?: UserLocation | null
  wallVisibility?: 'PUBLIC' | 'FRIENDS' | 'CLOSED'
}

const adminUserProfileSelect = {
  id: true,
  uid: true,
  username: true,
  usernameNormalized: true,
  nickname: true,
  email: true,
  phone: true,
  emailVerifiedAt: true,
  phoneVerifiedAt: true,
  verificationStatus: true,
  avatarUrl: true,
  backgroundUrl: true,
  bio: true,
  nicknameModerationStatus: true,
  nicknameViolationDisplay: true,
  birthMonth: true,
  birthDay: true,
  birthdaySetAt: true,
  birthdateSelfEditCount: true,
  birthdayPublic: true,
  showBadgeActivity: true,
  showBadgeProgressNotifications: true,
  Profile: {
    select: {
      displayName: true,
      avatarUrl: true,
      backgroundUrl: true,
      bio: true,
      locationCountryCode: true,
      locationCountry: true,
      locationRegionCode: true,
      locationRegion: true,
      wallVisibility: true,
    },
  },
} satisfies Prisma.UserSelect

export type AdminUserProfileRecord = Prisma.UserGetPayload<{ select: typeof adminUserProfileSelect }>

export type UpdateAdminUserProfileOptions = {
  userId: string
  adminId: string
  patch: AdminUserProfilePatch
  reason: string
}

function hasOwn(value: object, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function birthdayFromRecord(value: Pick<AdminUserProfileRecord, 'birthMonth' | 'birthDay'>): BirthdayParts | null {
  return value.birthMonth != null && value.birthDay != null
    ? { month: value.birthMonth, day: value.birthDay }
    : null
}

function birthdayLabel(value: BirthdayParts | null) {
  return value ? `${value.month}月${value.day}日` : null
}

function sameLocation(
  left: AdminUserProfileRecord['Profile'],
  right: UserLocation | null | undefined,
) {
  if (right === undefined) return true
  return (left?.locationCountryCode || null) === (right?.countryCode || null)
    && (left?.locationRegionCode || null) === (right?.regionCode || null)
}

function contactPatchFromProfilePatch(patch: AdminUserProfilePatch): UserContactPatch {
  const contact: UserContactPatch = {}
  if (hasOwn(patch, 'email')) contact.email = patch.email
  if (hasOwn(patch, 'phone')) contact.phone = patch.phone
  if (patch.phoneCountry) contact.phoneCountry = patch.phoneCountry
  return contact
}

function addAuditValue(target: Record<string, unknown>, field: string, value: unknown) {
  target[field] = value
}

/**
 * Update the ordinary, admin-manageable profile surface in one transaction.
 * Security credentials, roles, points/experience and badge ownership are not
 * part of this patch type and therefore cannot be edited through this flow.
 */
export async function updateAdminUserProfile(
  tx: Prisma.TransactionClient,
  options: UpdateAdminUserProfileOptions,
) {
  const contactPatch = contactPatchFromProfilePatch(options.patch)
  const lockNames = [
    ...getUserContactAdvisoryLockNames(options.userId, contactPatch),
    ...(options.patch.username
      ? [createMySqlAdvisoryLockName('user-profile-username', options.patch.username.usernameNormalized)]
      : []),
  ]

  return withMySqlAdvisoryLocks(tx, lockNames, async () => {
    const target = await tx.user.findUnique({
      where: { id: options.userId },
      select: adminUserProfileSelect,
    })
    if (!target) throw new Error('USER_NOT_FOUND')

    const builtContact = (hasOwn(contactPatch, 'email') || hasOwn(contactPatch, 'phone'))
      ? buildAdminUserContactUpdate(target, contactPatch)
      : null
    const contactFilters = builtContact ? [
      ...(builtContact.emailChanged && builtContact.canonicalNextEmail
        ? [{ email: builtContact.canonicalNextEmail }]
        : []),
      ...(builtContact.phoneChanged
        ? builtContact.phoneVariants.map((phone) => ({ phone }))
        : []),
    ] : []

    if (contactFilters.length) {
      const conflict = await tx.user.findFirst({
        where: { isDeleted: false, NOT: { id: options.userId }, OR: contactFilters },
        select: { email: true, phone: true },
      })
      if (conflict) {
        if (builtContact?.canonicalNextEmail && canonicalEmailValue(conflict.email) === builtContact.canonicalNextEmail) {
          throw new Error('EMAIL_ALREADY_EXISTS')
        }
        if (builtContact?.canonicalNextPhone && builtContact.phoneVariants.includes(canonicalPhoneValue(conflict.phone, contactPatch.phoneCountry) || '')) {
          throw new Error('PHONE_ALREADY_EXISTS')
        }
      }
    }

    if (options.patch.username && options.patch.username.usernameNormalized !== target.usernameNormalized) {
      const conflict = await tx.user.findUnique({
        where: { usernameNormalized: options.patch.username.usernameNormalized },
        select: { id: true },
      })
      if (conflict && conflict.id !== options.userId) throw new Error('USERNAME_ALREADY_EXISTS')
    }

    const now = new Date()
    if (builtContact?.emailChanged) {
      await tx.emailVerification.updateMany({
        where: { userId: options.userId, usedAt: null },
        data: { usedAt: now },
      })
      if (builtContact.canonicalNextEmail) {
        await tx.emailVerification.updateMany({
          where: { email: builtContact.canonicalNextEmail, usedAt: null },
          data: { usedAt: now },
        })
      }
    }
    if (builtContact?.phoneChanged) {
      const invalidatedPhones = new Set<string>([
        ...getPhoneLookupVariants(target.phone, contactPatch.phoneCountry),
        ...builtContact.phoneVariants,
      ])
      if (invalidatedPhones.size) {
        await tx.smsCode.updateMany({
          where: { phone: { in: [...invalidatedPhones] }, usedAt: null },
          data: { usedAt: now },
        })
      }
    }

    const oldBirthday = birthdayFromRecord(target)
    let birthdayResult: Awaited<ReturnType<typeof updateUserBirthdate>> | null = null
    if (hasOwn(options.patch, 'birthday')) {
      const birthdayOptions: UpdateUserBirthdateOptions = {
        targetUserId: options.userId,
        birthdate: options.patch.birthday || null,
        actor: 'ADMIN',
        now,
      }
      birthdayResult = await updateUserBirthdate(tx, birthdayOptions)
    }

    const userData: Prisma.UserUpdateInput = {}
    if (options.patch.username && options.patch.username.usernameNormalized !== target.usernameNormalized) {
      userData.username = options.patch.username.account
      userData.usernameNormalized = options.patch.username.usernameNormalized
      userData.usernameModerationStatus = 'NORMAL'
    }
    if (hasOwn(options.patch, 'nickname') && options.patch.nickname !== target.nickname) {
      userData.nickname = options.patch.nickname
      userData.nicknameModerationStatus = 'NORMAL'
      userData.nicknameViolationDisplay = null
    }
    if (builtContact) Object.assign(userData, builtContact.data)
    if (hasOwn(options.patch, 'bio')) {
      userData.bio = options.patch.bio
      userData.bioModerationStatus = 'NORMAL'
    }
    if (hasOwn(options.patch, 'avatarUrl')) userData.avatarUrl = options.patch.avatarUrl
    if (hasOwn(options.patch, 'backgroundUrl')) userData.backgroundUrl = options.patch.backgroundUrl
    if (options.patch.birthdayPublic !== undefined) userData.birthdayPublic = options.patch.birthdayPublic
    if (options.patch.showBadgeActivity !== undefined) userData.showBadgeActivity = options.patch.showBadgeActivity
    if (options.patch.showBadgeProgressNotifications !== undefined) userData.showBadgeProgressNotifications = options.patch.showBadgeProgressNotifications

    if (Object.keys(userData).length) {
      await tx.user.update({ where: { id: options.userId }, data: userData, select: { id: true } })
    }

    const shouldTouchProfile = hasOwn(options.patch, 'nickname')
      || hasOwn(options.patch, 'bio')
      || hasOwn(options.patch, 'avatarUrl')
      || hasOwn(options.patch, 'backgroundUrl')
      || hasOwn(options.patch, 'location')
      || options.patch.wallVisibility !== undefined
    if (shouldTouchProfile) {
      const displayName = options.patch.nickname ?? target.Profile?.displayName ?? target.nickname
      const profileUpdate: Prisma.ProfileUpdateInput = {}
      if (hasOwn(options.patch, 'nickname')) {
        profileUpdate.displayName = displayName
        profileUpdate.displayNameModerationStatus = 'NORMAL'
      }
      if (hasOwn(options.patch, 'bio')) {
        profileUpdate.bio = options.patch.bio
        profileUpdate.bioModerationStatus = 'NORMAL'
      }
      if (hasOwn(options.patch, 'avatarUrl')) profileUpdate.avatarUrl = options.patch.avatarUrl
      if (hasOwn(options.patch, 'backgroundUrl')) profileUpdate.backgroundUrl = options.patch.backgroundUrl
      if (options.patch.wallVisibility !== undefined) profileUpdate.wallVisibility = options.patch.wallVisibility
      if (options.patch.location !== undefined) {
        profileUpdate.locationCountryCode = options.patch.location?.countryCode || null
        profileUpdate.locationCountry = options.patch.location?.countryName || null
        profileUpdate.locationRegionCode = options.patch.location?.regionCode || null
        profileUpdate.locationRegion = options.patch.location?.regionName || null
      }
      await tx.profile.upsert({
        where: { userId: options.userId },
        update: profileUpdate,
        create: {
          userId: options.userId,
          displayName,
          avatarUrl: options.patch.avatarUrl ?? target.Profile?.avatarUrl ?? target.avatarUrl,
          backgroundUrl: options.patch.backgroundUrl ?? target.Profile?.backgroundUrl ?? target.backgroundUrl,
          bio: options.patch.bio ?? target.Profile?.bio ?? target.bio,
          wallVisibility: options.patch.wallVisibility ?? target.Profile?.wallVisibility ?? 'PUBLIC',
          ...(options.patch.location ? {
            locationCountryCode: options.patch.location.countryCode,
            locationCountry: options.patch.location.countryName,
            locationRegionCode: options.patch.location.regionCode,
            locationRegion: options.patch.location.regionName,
          } : {}),
        },
      })
    }

    const updated = await tx.user.findUnique({
      where: { id: options.userId },
      select: adminUserProfileSelect,
    })
    if (!updated) throw new Error('USER_NOT_FOUND')

    const changedFields: string[] = []
    const oldValue: Record<string, unknown> = {}
    const newValue: Record<string, unknown> = {}
    const recordChange = (field: string, before: unknown, after: unknown, changed = before !== after) => {
      if (!changed) return
      changedFields.push(field)
      addAuditValue(oldValue, field, before)
      addAuditValue(newValue, field, after)
    }

    recordChange('username', maskLoginAccount(target.username), maskLoginAccount(updated.username), target.username !== updated.username)
    recordChange('nickname', target.nickname, updated.nickname)
    recordChange('email', maskContactValue(target.email), maskContactValue(updated.email), target.email !== updated.email)
    recordChange('phone', maskContactValue(target.phone), maskContactValue(updated.phone), target.phone !== updated.phone)
    recordChange('bio', target.bio, updated.bio)
    recordChange('avatarUrl', target.avatarUrl, updated.avatarUrl)
    recordChange('backgroundUrl', target.backgroundUrl, updated.backgroundUrl)
    recordChange('birthday', birthdayLabel(oldBirthday), birthdayLabel(birthdayFromRecord(updated)))
    recordChange('birthdayPublic', target.birthdayPublic, updated.birthdayPublic)
    recordChange('showBadgeActivity', target.showBadgeActivity, updated.showBadgeActivity)
    recordChange('showBadgeProgressNotifications', target.showBadgeProgressNotifications, updated.showBadgeProgressNotifications)
    if (!sameLocation(target.Profile, options.patch.location)) {
      recordChange('location', target.Profile ? {
        countryCode: target.Profile.locationCountryCode,
        regionCode: target.Profile.locationRegionCode,
      } : null, options.patch.location ? {
        countryCode: options.patch.location.countryCode,
        regionCode: options.patch.location.regionCode,
      } : null)
    }
    if (options.patch.wallVisibility !== undefined) {
      recordChange('wallVisibility', target.Profile?.wallVisibility || 'PUBLIC', updated.Profile?.wallVisibility || 'PUBLIC')
    }

    // `birthdayResult.changed` is the source of truth for badge triggering;
    // the audit comparison also catches a repaired historical partial value.
    const birthdayChanged = Boolean(birthdayResult?.changed)
    if (changedFields.length) {
      await tx.adminActionLog.create({
        data: {
          adminId: options.adminId,
          targetUserId: options.userId,
          action: 'UPDATE_USER_PROFILE',
          detail: {
            changedFields,
            oldValue,
            newValue,
            birthdayChanged,
            reason: options.reason,
          } as Prisma.InputJsonValue,
        },
      })
    }

    return {
      changed: changedFields.length > 0,
      changedFields,
      birthdayChanged,
      user: updated,
    }
  })
}
