export const ALLOWED_PHARMACY_DRAW_COUNTS = [1, 5, 10] as const

export type PharmacyDrawCount = (typeof ALLOWED_PHARMACY_DRAW_COUNTS)[number]

export function calculateAvailablePharmacyDraws(input: {
  balance: number
  cost: number
  todayCount: number
  dailyLimit: number | null
  totalCount: number
  totalLimit: number | null
}) {
  const affordable = input.cost > 0 ? Math.floor(Math.max(0, input.balance) / input.cost) : 0
  const dailyRemaining = input.dailyLimit === null ? Number.POSITIVE_INFINITY : Math.max(0, input.dailyLimit - input.todayCount)
  const totalRemaining = input.totalLimit === null ? Number.POSITIVE_INFINITY : Math.max(0, input.totalLimit - input.totalCount)
  return Math.max(0, Math.min(affordable, dailyRemaining, totalRemaining))
}
