import type { Prisma } from '@prisma/client'
import { getPhoneLookupVariants } from '@/lib/phone-number'
import { withMySqlAdvisoryLocks } from '@/lib/mysql-advisory-lock'
import {
  canonicalEmailValue,
  canonicalPhoneValue,
  getUserContactAdvisoryLockNames,
  maskContactValue,
  type UserContactPatch,
} from '@/lib/user-contact'

/**
 * The Prisma model calls the admin-facing internal account `username`.
 * Contact updates are intentionally limited to `email` and `phone`; they
 * must never write this identity field or `nickname`.
 */
export const ADMIN_USER_FIELD_MAP = {
  phone: 'phone',
  email: 'email',
  internalAccount: 'username',
  username: 'username',
  nickname: 'nickname',
} as const

export const adminUserContactSelect = {
  id: true,
  uid: true,
  username: true,
  email: true,
  phone: true,
  emailVerifiedAt: true,
  phoneVerifiedAt: true,
  verificationStatus: true,
  updatedAt: true,
} satisfies Prisma.UserSelect

export type AdminUserContactRecord = Prisma.UserGetPayload<{ select: typeof adminUserContactSelect }>

type ContactUpdateTarget = Pick<AdminUserContactRecord, 'email' | 'phone'>

export type BuiltAdminUserContactUpdate = {
  data: Prisma.UserUpdateInput
  nextEmail: string | null
  nextPhone: string | null
  canonicalNextEmail: string | null
  canonicalNextPhone: string | null
  phoneVariants: string[]
  emailChanged: boolean
  phoneChanged: boolean
  storedValueChanged: boolean
}

/**
 * Build the only Prisma update data allowed by the admin contact editor.
 * Keeping this pure makes the field boundary easy to regression-test.
 */
export function buildAdminUserContactUpdate(
  target: ContactUpdateTarget,
  patch: UserContactPatch,
): BuiltAdminUserContactUpdate {
  const emailProvided = patch.email !== undefined
  const phoneProvided = patch.phone !== undefined
  const nextEmail = emailProvided ? patch.email ?? null : target.email
  const nextPhone = phoneProvided ? patch.phone ?? null : target.phone
  const canonicalNextEmail = canonicalEmailValue(nextEmail)
  const canonicalNextPhone = canonicalPhoneValue(nextPhone, patch.phoneCountry)
  const emailChanged = emailProvided && canonicalNextEmail !== canonicalEmailValue(target.email)
  const phoneChanged = phoneProvided && canonicalNextPhone !== canonicalPhoneValue(target.phone, patch.phoneCountry)
  const phoneVariants = phoneProvided && canonicalNextPhone
    ? getPhoneLookupVariants(canonicalNextPhone, patch.phoneCountry)
    : []

  const data: Prisma.UserUpdateInput = {}
  if (emailProvided) {
    data.email = nextEmail
    if (emailChanged) {
      data.emailVerifiedAt = null
      data.verificationStatus = nextEmail ? 'PENDING' : 'NONE'
    }
  }
  if (phoneProvided) {
    data.phone = nextPhone
    if (phoneChanged) data.phoneVerifiedAt = null
  }

  return {
    data,
    nextEmail,
    nextPhone,
    canonicalNextEmail,
    canonicalNextPhone,
    phoneVariants,
    emailChanged,
    phoneChanged,
    storedValueChanged: (emailProvided && target.email !== nextEmail) || (phoneProvided && target.phone !== nextPhone),
  }
}

export type UpdateAdminUserContactOptions = {
  userId: string
  adminId: string
  patch: UserContactPatch
  reason: string
}

export async function updateAdminUserContact(
  tx: Prisma.TransactionClient,
  options: UpdateAdminUserContactOptions,
) {
  return withMySqlAdvisoryLocks(
    tx,
    getUserContactAdvisoryLockNames(options.userId, options.patch),
    async () => {
      const target = await tx.user.findUnique({
        where: { id: options.userId },
        select: adminUserContactSelect,
      })
      if (!target) throw new Error('USER_NOT_FOUND')

      const built = buildAdminUserContactUpdate(target, options.patch)
      const contactFilters = [
        ...(built.emailChanged && built.canonicalNextEmail
          ? [{ email: built.canonicalNextEmail }]
          : []),
        ...(built.phoneChanged
          ? built.phoneVariants.map((phone) => ({ phone }))
          : []),
      ]

      if (contactFilters.length) {
        const conflict = await tx.user.findFirst({
          where: { isDeleted: false, NOT: { id: options.userId }, OR: contactFilters },
          select: { id: true, email: true, phone: true },
        })
        if (conflict) {
          if (built.canonicalNextEmail && canonicalEmailValue(conflict.email) === built.canonicalNextEmail) {
            throw new Error('EMAIL_ALREADY_EXISTS')
          }
          if (built.canonicalNextPhone && built.phoneVariants.includes(canonicalPhoneValue(conflict.phone, options.patch.phoneCountry) || '')) {
            throw new Error('PHONE_ALREADY_EXISTS')
          }
        }
      }

      if (built.emailChanged) {
        const now = new Date()
        await tx.emailVerification.updateMany({
          where: { userId: options.userId, usedAt: null },
          data: { usedAt: now },
        })
        if (built.canonicalNextEmail) {
          await tx.emailVerification.updateMany({
            where: { email: built.canonicalNextEmail, usedAt: null },
            data: { usedAt: now },
          })
        }
      }

      if (built.phoneChanged) {
        const invalidatedPhones = new Set<string>([
          ...getPhoneLookupVariants(target.phone, options.patch.phoneCountry),
          ...built.phoneVariants,
        ])
        if (invalidatedPhones.size) {
          await tx.smsCode.updateMany({
            where: { phone: { in: [...invalidatedPhones] }, usedAt: null },
            data: { usedAt: new Date() },
          })
        }
      }

      const user = await tx.user.update({
        where: { id: options.userId },
        data: built.data,
        select: adminUserContactSelect,
      })

      if (built.storedValueChanged || built.emailChanged || built.phoneChanged) {
        await tx.adminActionLog.create({
          data: {
            adminId: options.adminId,
            targetUserId: options.userId,
            action: 'UPDATE_USER_CONTACT',
            detail: {
              previousPhone: maskContactValue(target.phone),
              newPhone: maskContactValue(user.phone),
              previousEmail: maskContactValue(target.email),
              newEmail: maskContactValue(user.email),
              phoneChanged: built.phoneChanged,
              emailChanged: built.emailChanged,
              reason: options.reason,
            },
          },
        })
      }

      return {
        changed: built.storedValueChanged || built.emailChanged || built.phoneChanged,
        user,
      }
    },
  )
}
