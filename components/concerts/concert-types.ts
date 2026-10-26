import type { getPublicConcertEvent } from '@/lib/concert-events'

export type EventView = NonNullable<Awaited<ReturnType<typeof getPublicConcertEvent>>>
