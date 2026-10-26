import type { Prisma } from '@prisma/client'

export const publicConcertMarkUserWhere = {
  status: 'ACTIVE',
  isDeleted: false,
  Profile: { is: { wallVisibility: 'PUBLIC' } },
  OR: [
    { UserPrivacySetting: { is: null } },
    { UserPrivacySetting: { is: { showConcertHistory: true } } },
  ],
} satisfies Prisma.UserWhereInput

export function isConcertMarkVisible(mark: {
  isPublic: boolean
  user: { status: string; isDeleted: boolean; Profile?: { wallVisibility: string } | null; UserPrivacySetting?: { showConcertHistory: boolean } | null }
}) {
  return mark.isPublic && mark.user.status === 'ACTIVE' && !mark.user.isDeleted && mark.user.Profile?.wallVisibility === 'PUBLIC' && mark.user.UserPrivacySetting?.showConcertHistory !== false
}
