export type HomeDailyPrescriptionDisplay =
  | { status: 'unclaimed'; points: null }
  | { status: 'claimed'; points: number }

/** Convert the read-only home payload into the two states the card displays. */
export function getHomeDailyPrescriptionDisplay(points: number | null | undefined): HomeDailyPrescriptionDisplay {
  return typeof points === 'number' && Number.isInteger(points) && points > 0
    ? { status: 'claimed', points }
    : { status: 'unclaimed', points: null }
}
