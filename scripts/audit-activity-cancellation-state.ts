import { prisma } from '@/lib/prisma'

/**
 * Read-only audit for historical cancellation drift.
 *
 * This script intentionally never updates Activity or ActivityRegistration.
 * Review its report before running any separately approved production repair.
 */
async function main() {
  const [rows, cancelledVerifiedRegistrations] = await prisma.$transaction([
    prisma.activity.findMany({
    where: {
      status: 'CANCELLED',
      ActivityRegistration: { some: { status: 'ACTIVE' } },
    },
    orderBy: { id: 'asc' },
    select: {
      id: true,
      title: true,
      signupCount: true,
      ActivityRegistration: {
        where: { status: 'ACTIVE' },
        orderBy: { id: 'asc' },
        select: { id: true, userId: true, paidRegistrationFee: true, verifiedAt: true, checkedInAt: true, checkInSource: true },
      },
    },
    }),
    prisma.activityRegistration.findMany({
      where: { status: 'CANCELLED', verifiedAt: { not: null } },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        activityId: true,
        userId: true,
        verifiedAt: true,
        checkedInAt: true,
        checkInSource: true,
        cancelledAt: true,
        Activity: { select: { title: true, status: true } },
      },
    }),
  ])

  const activities = rows.map((activity) => ({
    id: activity.id,
    title: activity.title,
    signupCount: activity.signupCount,
    activeRegistrationCount: activity.ActivityRegistration.length,
    activeUnverifiedRegistrationCount: activity.ActivityRegistration.filter((registration) => !registration.verifiedAt).length,
    activeVerifiedRegistrationCount: activity.ActivityRegistration.filter((registration) => Boolean(registration.verifiedAt)).length,
    activePaidRegistrationFeeTotal: activity.ActivityRegistration.reduce((total, registration) => total + Math.max(0, registration.paidRegistrationFee), 0),
    registrationIds: activity.ActivityRegistration.map((registration) => registration.id),
  }))

  console.log(JSON.stringify({
    readOnly: true,
    cancelledActivitiesWithActiveRegistrations: activities.length,
    activeRegistrationCount: activities.reduce((total, activity) => total + activity.activeRegistrationCount, 0),
    activePaidRegistrationFeeTotal: activities.reduce((total, activity) => total + activity.activePaidRegistrationFeeTotal, 0),
    cancelledVerifiedRegistrationCount: cancelledVerifiedRegistrations.length,
    cancelledVerifiedRegistrations: cancelledVerifiedRegistrations.map((registration) => ({
      id: registration.id,
      activityId: registration.activityId,
      activityTitle: registration.Activity.title,
      activityStatus: registration.Activity.status,
      userId: registration.userId,
      verifiedAt: registration.verifiedAt?.toISOString() || null,
      checkedInAt: registration.checkedInAt?.toISOString() || null,
      checkInSource: registration.checkInSource,
      cancelledAt: registration.cancelledAt?.toISOString() || null,
    })),
    activities,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error('[audit.activity-cancellation-state]', error)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
