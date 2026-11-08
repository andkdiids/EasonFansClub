export type MobilePublicActivityWinner = {
  nickname: string
  uid: number | null
  avatarUrl: string | null
  tierName: string
  prizeName: string
  wonAt: string
  rewardStatus: string
  rewardAt: string | null
}
export type MobilePublicActivityLottery = {
  status: 'SCHEDULED' | 'DRAWN' | 'RESULTS_UNAVAILABLE'
  prizes: Array<{ winners: MobilePublicActivityWinner[] }>
}
export type MobilePublicActivityWinnersPage = {
  status: MobilePublicActivityLottery['status']
  winners: MobilePublicActivityWinner[]
  page: number
  pageSize: number
  total: number
  totalPages: number
}
function positiveQuery(value: string | null, fallback: number, maximum: number) {
  if (value === null || !/^\d+$/.test(value)) return fallback
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback
}
/** Copies only public fields after the lottery service confirms a complete draw. */
export function buildMobilePublicActivityWinnersPage(lottery: MobilePublicActivityLottery, pageValue: string | null, pageSizeValue: string | null): MobilePublicActivityWinnersPage {
  const pageSize = positiveQuery(pageSizeValue, 20, 50)
  const allWinners = lottery.status === 'DRAWN'
    ? lottery.prizes.flatMap((prize) => prize.winners).map((winner) => ({
        nickname: winner.nickname, uid: winner.uid, avatarUrl: winner.avatarUrl, tierName: winner.tierName,
        prizeName: winner.prizeName, wonAt: winner.wonAt, rewardStatus: winner.rewardStatus, rewardAt: winner.rewardAt,
      })).sort((left, right) => left.wonAt.localeCompare(right.wonAt) || left.nickname.localeCompare(right.nickname))
    : []
  const total = allWinners.length
  const totalPages = Math.ceil(total / pageSize)
  const requestedPage = positiveQuery(pageValue, 1, 100_000)
  const page = Math.min(requestedPage, Math.max(1, totalPages))
  const start = (page - 1) * pageSize
  return { status: lottery.status, winners: allWinners.slice(start, start + pageSize), page, pageSize, total, totalPages }
}
