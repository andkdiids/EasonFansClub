import { prisma } from '@/lib/prisma'
import { homepageConcertStatuses, resolveHomepageFeaturedConcert } from '@/lib/homepage-featured-concert'

/** The current admin-controlled event is optional: invalid or unavailable data falls back to the configured Hero carousel. */
export async function getHomepageFeaturedConcert() {
  const event = await prisma.concertEvent.findFirst({
    where: { homepageFeatured: true, status: { in: [...homepageConcertStatuses] } },
    orderBy: { updatedAt: 'desc' },
    select: {
      homepageFeatured: true,
      status: true,
      title: true,
      subtitle: true,
      slug: true,
      backgroundImageUrl: true,
      startDate: true,
      endDate: true,
    },
  })
  return resolveHomepageFeaturedConcert(event)
}
